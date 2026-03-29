import OpenAI from "openai";
import { createAppointment, handoffToHuman } from "./tools.js";
import { isWithinBusinessHours, getBusinessHoursText } from "./bizHours.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function mustHaveEnv(name) {
	if (!process.env[name]) throw new Error(`Eksik ortam değişkeni: ${name}`);
}

function businessContext(tenant) {
	return {
		name: tenant?.company_name || process.env.BUSINESS_NAME || "İşletmemiz",
		phone: process.env.BUSINESS_PHONE || "N/A",
		address: process.env.BUSINESS_ADDRESS || "N/A",
		tz: tenant?.timezone || process.env.BUSINESS_TIMEZONE || "Europe/Istanbul",
		sector: tenant?.sector || process.env.BUSINESS_SECTOR || "health",
		services: tenant?.services || process.env.BUSINESS_SERVICES || "Genel Hizmet"
	};
}

// --- Sektör bazlı kişilik ---

const SECTOR_PERSONALITIES = {
	health: `Sen profesyonel ve güven veren bir sağlık asistanısın. 
Hastanın endişelerini anlayışla karşıla. Tıbbi teşhis veya tedavi önerisi YAPMA — sadece randevu yönlendirmesi yap.
Acil durumlarda 112'yi aramaları gerektiğini belirt.`,
	health_beauty: `Sen samimi ve profesyonel bir güzellik merkezi asistanısın.
Müşterinin güzellik ve bakım ihtiyaçlarını anlayışla dinle.
Hizmetler hakkında genel bilgi ver ama uzmanlık gerektiren sorularda randevu yönlendir.`,
	education: `Sen yardımsever ve sabırlı bir eğitim kurumu asistanısın.
Öğrencilerin ve velilerin sorularını anlaşılır şekilde yanıtla.
Kayıt ve ders programları hakkında yönlendirme yap.`,
	home_services: `Sen güvenilir ve pratik bir ev hizmetleri asistanısın.
Müşterinin ihtiyacını hızlıca anla ve uygun hizmete yönlendir.`,
	real_estate: `Sen profesyonel bir emlak danışmanı asistanısın.
Müşterinin gayrimenkul ihtiyaçlarını dinle ve uygun görüşme randevusu oluştur.`,
	hospitality: `Sen misafirperver ve sıcak bir konaklama asistanısın.
Konukların rezervasyon ve bilgi taleplerine hızlı ve nazik yanıt ver.`
};

// --- Eksik randevu alanları ---

function missingAppointmentFields(draft) {
	const missing = [];
	if (!draft.service) missing.push("service");
	if (!draft.date) missing.push("date");
	if (!draft.time) missing.push("time");
	if (!draft.name) missing.push("name");
	return missing;
}

function nextAppointmentQuestion(missing, info) {
	const field = missing[0];

	switch (field) {
		case "service":
			return `Hangi hizmet için randevu almak istiyorsunuz?\n\n📋 Hizmetlerimiz:\n${info.services.split(",").map((s) => `• ${s.trim()}`).join("\n")}`;
		case "date":
			return "📅 Hangi gün için randevu almak istiyorsunuz? (Örn: bugün, yarın, 2 Nisan)";
		case "time":
			return "⏰ Saat kaçı tercih edersiniz? (Örn: 14:00, öğleden sonra 3)";
		case "name":
			return "👤 Randevuyu hangi isimle oluşturmamı istersiniz?";
		default:
			return "Başka bilgiye ihtiyacım var — lütfen detay verin.";
	}
}

// --- AI ile randevu bilgisi çıkarma ---

async function extractAppointmentFields({ model, userText, services }) {
	const tz = process.env.BUSINESS_TIMEZONE || "Europe/Istanbul";
	const now = new Date().toLocaleString("tr-TR", { timeZone: tz });

	const extractorSystem = `
Kullanıcının mesajından randevu bilgilerini çıkar.
SADECE JSON döndür:
{
  "service": string|null,
  "date": "YYYY-MM-DD"|null,
  "time": "HH:mm"|null,
  "name": string|null,
  "phone": string|null,
  "email": string|null,
  "notes": string|null,
  "cancel": boolean
}
Kurallar:
- Kullanıcı iptal etmek istiyorsa cancel=true yap.
- Değer yoksa null kullan.
- "bugün", "yarın", "bu akşam", "haftaya" gibi göreceli tarihleri timezone (${tz}) ile yorumla.
- Şu anki tarih/saat: ${now}
- "3'te", "üçte", "saat 3" gibi ifadeleri 24 saat formatına çevir (bağlama göre öğleden sonra varsay).
- "öğleden sonra" → 14:00-17:00 arası, "akşam" → 18:00-20:00 arası.
- Sunulan hizmetler: ${services}. Kullanıcının yazdığı hizmeti en yakın eşleşmeyle eşle.
`;

	const extraction = await openai.chat.completions.create({
		model,
		messages: [
			{ role: "system", content: extractorSystem.trim() },
			{ role: "user", content: userText }
		],
		response_format: { type: "json_object" }
	});

	try {
		return JSON.parse(extraction.choices[0].message.content);
	} catch {
		return {};
	}
}

function mergeDraft(draft, parsed) {
	const next = { ...draft };
	for (const key of ["service", "date", "time", "name", "phone", "email", "notes"]) {
		const v = parsed?.[key];
		if (v !== null && v !== undefined && v !== "") next[key] = v;
	}
	return next;
}

// --- Ana Agent Fonksiyonu ---

export async function runAgent({ from, userText, session, tenant }) {
	mustHaveEnv("OPENAI_API_KEY");
	const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
	const info = businessContext(tenant);

	// --- Randevu akışı modu ---
	if (session.flow === "RANDEVU") {
		const parsed = await extractAppointmentFields({
			model,
			userText,
			services: info.services
		});

		if (parsed.cancel) {
			session.flow = null;
			session.appointmentDraft = {};
			return {
				reply: "👌 Tamam, randevu talebini iptal ettim. Başka bir konuda yardımcı olabilir miyim?",
				newSession: session,
				intent: "RANDEVU_IPTAL",
				sentiment: "neutral",
				booking_probability: 0
			};
		}

		session.appointmentDraft = mergeDraft(session.appointmentDraft, parsed);

		const missing = missingAppointmentFields(session.appointmentDraft);
		if (missing.length > 0) {
			return { 
				reply: nextAppointmentQuestion(missing, info), 
				newSession: session,
				intent: "RANDEVU_DEVAM",
				sentiment: "positive",
				booking_probability: 50 + (10 * (Object.keys(session.appointmentDraft).length))
			};
		}

		// Tüm bilgiler tamam — randevu oluştur
		const result = await createAppointment({
			from,
			draft: session.appointmentDraft,
			tenant
		});

		session.flow = null;
		const completedDraft = { ...session.appointmentDraft };
		session.appointmentDraft = {};

		const msg =
			`✅ Randevunuz oluşturuldu!\n\n` +
			`📋 Hizmet: ${completedDraft.service}\n` +
			`📅 Tarih: ${completedDraft.date}\n` +
			`⏰ Saat: ${completedDraft.time}\n` +
			`👤 İsim: ${completedDraft.name}\n` +
			`🔖 Referans: ${result.referenceId}\n\n` +
			`İptal veya değişiklik için referans numaranızı saklayın.\n` +
			`Başka bir şey sormak ister misiniz?`;

		session.history = [
			...session.history.slice(-8),
			{ role: "user", content: userText },
			{ role: "assistant", content: msg }
		];

		return { 
			reply: msg, 
			newSession: session,
			intent: "RANDEVU_TAMAM",
			sentiment: "positive",
			booking_probability: 100
		};
	}

	// --- Normal mod: niyeti belirle ---
	const withinHours = isWithinBusinessHours(tenant);
	const history = session.history.slice(-10);
	const sectorPersonality = SECTOR_PERSONALITIES[info.sector] || SECTOR_PERSONALITIES.health;

	const system = `
Sen "${info.name}" işletmesinin WhatsApp asistanısın.
Kişiliğin ve Tonun: ${tenant?.ai_personality || sectorPersonality}

--- [BİLGİ BANKASI / SSS] ---
Aşağıdakiler işletme hakkında sabit bilgilerdir. Soruları bunlara dayanarak yanıtla.
${tenant?.faq_text || "Özel bir detay girilmemiştir."}
------------------------------

Görevlerin:
1) Yukarıdaki BİLGİ BANKASI'nı kullanarak soruları yanıtlamak
2) Randevu oluşturma akışını başlatma
3) İnsan temsilciye yönlendirme

Kurallar:
- HER ZAMAN Türkçe yanıt ver.
- Mesajları kısa ve samimi tut.
- Sadece bilgi bankasında varsa kesin bilgiler ver.
- Sunulan hizmetler: ${info.services}
- Çalışma saatleri: ${getBusinessHoursText(tenant)}
- Şu an mesai ${withinHours ? "saatleri İÇİNDE" : "saatleri DIŞINDA"}.

SADECE JSON döndür:
{
  "intent": "SSS"|"RANDEVU"|"TEMSILCI"|"GENEL",
  "startAppointment": boolean,
  "startHandoff": boolean,
  "handoffSummary": string|null,
  "sentiment": "positive"|"neutral"|"negative",
  "booking_probability": number, // 0-100 arası
  "reply": string
}
`;

	const decision = await openai.chat.completions.create({
		model,
		messages: [
			{ role: "system", content: system.trim() },
			...history,
			{ role: "user", content: userText }
		],
		response_format: { type: "json_object" }
	});

	let plan;
	try {
		plan = JSON.parse(decision.choices[0].message.content);
	} catch {
		plan = {
			intent: "GENEL",
			startAppointment: false,
			startHandoff: false,
			faqQuery: null,
			handoffSummary: null,
			reply: "Anlayamadım, tekrar yazar mısınız? 🤔"
		};
	}

	// SSS ve Genel Yanıtlar AI tarafından "reply" parametresinde otomatik oluşturuldu.
	// Eğer müşteri direkt SSS soruyorsa ve randevu amacı yoksa direkt cevapla.
	if (plan.intent === "SSS" && !plan.startAppointment && !plan.startHandoff) {
		const answer = plan.reply || "Bu konuda emin değilim.";
		session.history = [
			...history,
			{ role: "user", content: userText },
			{ role: "assistant", content: answer }
		];
		return { 
			reply: answer, 
			newSession: session,
			intent: plan.intent,
			sentiment: plan.sentiment || "neutral",
			booking_probability: plan.booking_probability || 0
		};
	}

	// Randevu akışı başlat
	if (plan.startAppointment || plan.intent === "RANDEVU") {
		session.flow = "RANDEVU";

		const initialParsed = await extractAppointmentFields({
			model,
			userText,
			services: info.services
		});

		if (initialParsed.cancel) {
			session.flow = null;
			session.appointmentDraft = {};
			const msg = "👌 Tamam, randevu talebi yok. Başka nasıl yardımcı olabilirim?";
			session.history = [...history, { role: "user", content: userText }, { role: "assistant", content: msg }];
			return { 
				reply: msg, 
				newSession: session,
				intent: "RANDEVU_IPTAL",
				sentiment: "neutral",
				booking_probability: 0
			};
		}

		session.appointmentDraft = mergeDraft({}, initialParsed);

		const missing = missingAppointmentFields(session.appointmentDraft);

		// Eğer tüm bilgiler ilk mesajda verilmişse direkt oluştur
		if (missing.length === 0) {
			const result = await createAppointment({
				from,
				draft: session.appointmentDraft,
				tenant
			});

			session.flow = null;
			const completedDraft = { ...session.appointmentDraft };
			session.appointmentDraft = {};

			const msg =
				`✅ Randevunuz oluşturuldu!\n\n` +
				`📋 Hizmet: ${completedDraft.service}\n` +
				`📅 Tarih: ${completedDraft.date}\n` +
				`⏰ Saat: ${completedDraft.time}\n` +
				`👤 İsim: ${completedDraft.name}\n` +
				`🔖 Referans: ${result.referenceId}\n\n` +
				`Başka bir konuda yardımcı olabilir miyim?`;

			session.history = [...history, { role: "user", content: userText }, { role: "assistant", content: msg }];
			return { 
				reply: msg, 
				newSession: session,
				intent: "RANDEVU_TAMAM",
				sentiment: "positive",
				booking_probability: 100
			};
		}

		const reply = nextAppointmentQuestion(missing, info);
		session.history = [
			...history,
			{ role: "user", content: userText },
			{ role: "assistant", content: reply }
		];
		return { 
			reply, 
			newSession: session,
			intent: "RANDEVU_BASLA",
			sentiment: plan.sentiment || "neutral",
			booking_probability: plan.booking_probability || 50
		};
	}

	// Temsilciye yönlendirme
	if (plan.startHandoff || plan.intent === "TEMSILCI") {
		const summary = plan.handoffSummary || userText;
		const result = await handoffToHuman({ from, summary, tenant });

		const reply = result.available
			? `👤 Sizi bir temsilciye bağlıyorum. Lütfen konunuzu detaylandırın, en kısa sürede yanıt alacaksınız.\n🔖 Referans: ${result.handoffId}`
			: `⏰ Şu an mesai saatleri dışındayız. Mesajınızı aldık, mesai saatleri içinde size dönüş yapılacaktır.\n🔖 Referans: ${result.handoffId}\n\nÇalışma saatlerimiz:\n${getBusinessHoursText(tenant)}`;

		session.history = [
			...history,
			{ role: "user", content: userText },
			{ role: "assistant", content: reply }
		];

		return { 
			reply, 
			newSession: session,
			intent: "TEMSILCI",
			sentiment: plan.sentiment || "neutral",
			booking_probability: 10
		};
	}

	// Varsayılan yanıt
	const reply =
		typeof plan.reply === "string" && plan.reply.trim()
			? plan.reply.trim()
			: `Merhaba! 👋 Size nasıl yardımcı olabilirim?\n\n📅 Randevu almak\n❓ Soru sormak\n👤 Temsilciye bağlanmak`;

	session.history = [
		...history,
		{ role: "user", content: userText },
		{ role: "assistant", content: reply }
	];

	return { 
		reply, 
		newSession: session,
		intent: plan.intent || "GENEL",
		sentiment: plan.sentiment || "neutral",
		booking_probability: plan.booking_probability || 10
	};
}
