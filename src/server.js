import "dotenv/config";
import express from "express";
import morgan from "morgan";

import { validateTwilioWebhook, sendWhatsAppMessage } from "./twilio.js";
import { hasProcessed, markProcessed, getSession, setSession } from "./store.js";
import { runAgent } from "./agent.js";
import { checkRateLimit } from "./rateLimit.js";
import { detectCommand, getResponse } from "./commands.js";
import { getDefaultTenant, findTenantByNumber, incrementTenantUsage, checkUsageLimit, updateSessionStatus, logMessage } from "./db.js";
import adminRoutes from "./adminRoutes.js";
import authRoutes from "./authRoutes.js";
import onboardingRoutes from "./onboardingRoutes.js";

const app = express();
app.use(morgan("dev"));

app.use(express.json()); // API istekleri için JSON desteği
app.use(express.urlencoded({ extended: false }));

// Arayüz Statik Dosyaları (Vitrin / Landing Page / Auth)
app.use(express.static("public", { index: "index.html" }));

// Genel API Rotaları (Kayıt, Giriş, Müşteri Paneli)
app.use(authRoutes);
app.use(onboardingRoutes);

// Admin Panelini ve Rotalarını bağla
app.use("/admin", adminRoutes);

// RandevuAl Sağlık Taraması
app.get("/health", (req, res) => {
	res.json({ status: "ok", uptime: process.uptime() });
});

app.post("/twilio/whatsapp", async (req, res) => {
	try {
		console.log("\n=============================================");
		console.log("🔔 [TWILIO] Yeni istek geldi!");
		console.log("=============================================");

		const publicUrl = process.env.PUBLIC_WEBHOOK_URL;
		if (!publicUrl) return res.status(500).send("PUBLIC_WEBHOOK_URL eksik");

		const valid = validateTwilioWebhook({ req, publicUrl });
		if (!valid) {
			console.log("🚫 [HATA] Twilio imzası geçersiz! Lütfen TWILIO_AUTH_TOKEN ayarınızı kontrol edin.");
			return res.status(403).send("Geçersiz Twilio imzası");
		}
		console.log("✅ [BAŞARILI] Twilio imzası doğrulandı.");

		const messageSid = req.body.MessageSid;
		const from = req.body.From; // "whatsapp:+90..."
		const body = (req.body.Body || "").trim();
		const toNumber = req.body.To; // Twilio numarası

		if (!messageSid || !from) return res.status(400).send("Hatalı istek");

		// Tekrar engelleme
		if (hasProcessed(messageSid)) return res.status(200).send("duplicate");
		markProcessed(messageSid);

		// Tenant tespit
		let tenant;
		try {
			tenant = findTenantByNumber(toNumber) || getDefaultTenant();
		} catch {
			tenant = null;
		}

		// Rate limiting
		const rateCheck = checkRateLimit(from);
		if (!rateCheck.allowed) {
			await sendWhatsAppMessage({ to: from, body: getResponse("RATE_LIMITED") });
			return res.status(200).send("rate_limited");
		}

		// Log incoming message
		if (tenant) {
			try {
				logMessage({
					tenantId: tenant.id,
					customerPhone: from,
					body: body,
					direction: 'incoming',
					source: 'user'
				});
			} catch (e) { console.error("Log error:", e); }
		}

		// Boş mesaj kontrolü
		if (!body) {
			await sendWhatsAppMessage({
				to: from,
				body: "Merhaba! 👋 Bir mesaj gönderin, size yardımcı olayım.\n\n📅 Randevu almak\n❓ Soru sormak\n👤 Temsilciye bağlanmak"
			});
			return res.status(200).send("ok");
		}

		// Komut kontrolü (STOP, SİL, DEVAM)
		const { command, response: cmdResponse } = detectCommand(body);
		if (command) {
			if (command === "STOP" && tenant) {
				try { updateSessionStatus(from, tenant.id, "STOP"); } catch {}
			}
			if (command === "DELETE" && tenant) {
				try { updateSessionStatus(from, tenant.id, "DELETED"); } catch {}
			}
			await sendWhatsAppMessage({ to: from, body: cmdResponse });
			return res.status(200).send("command");
		}

		// Kullanım limiti kontrolü
		if (tenant && !checkUsageLimit(tenant)) {
			await sendWhatsAppMessage({ to: from, body: getResponse("USAGE_EXCEEDED") });
			return res.status(200).send("usage_exceeded");
		}

		// Oturum al ve Agent'ı çalıştır
		const session = getSession(from, tenant?.id);
		const { reply, newSession, intent, sentiment, booking_probability } = await runAgent({
			from,
			userText: body,
			session,
			tenant
		});

		setSession(from, newSession, tenant?.id);

		// Log outgoing message with stats
		if (tenant) {
			try {
				logMessage({
					tenantId: tenant.id,
					customerPhone: from,
					body: reply,
					direction: 'outgoing',
					source: 'ai',
					intent,
					sentiment,
					booking_probability
				});
			} catch (e) { console.error("Log error:", e); }
		}

		await sendWhatsAppMessage({ to: from, body: reply });
		res.status(200).send("ok");
	} catch (err) {
		console.error("❌ Sunucu hatası:", err);
		res.status(500).send("sunucu hatası");
	}
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
	console.log(`\n🚀 RandevuAl WhatsApp AI Agent`);
	console.log(`📡 Port: ${port}`);
	console.log(`🏥 İşletme: ${process.env.BUSINESS_NAME || "Yapılandırılmamış"}`);
	console.log(`🌍 Timezone: ${process.env.BUSINESS_TIMEZONE || "Europe/Istanbul"}`);
	console.log(`🤖 AI Model: ${process.env.OPENAI_MODEL || "gpt-4o-mini"}`);
	console.log(`\n📌 Webhook: POST /twilio/whatsapp`);
	console.log(`📌 Sağlık: GET /health\n`);
});
