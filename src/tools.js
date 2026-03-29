import { loadFaq } from "./faq.js";
import { isWithinBusinessHours, getBusinessHoursText } from "./bizHours.js";
import { createBooking, checkAvailability, cancelBooking, isCalConfigured } from "./calcom.js";
import { createAppointmentRecord, findAppointmentsByPhone, cancelAppointmentByRef } from "./db.js";

function templateEnvVars(text) {
	if (!text) return text;

	return text.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => {
		if (!(key in process.env)) {
			console.warn(`Eksik env değişkeni (FAQ şablonu): ${key}`);
			return "";
		}
		return process.env[key] ?? "";
	});
}

/**
 * FAQ arama — Türkçe pattern eşleştirme
 */
export async function lookupFaq({ question }) {
	const q = question || "";
	const faq = loadFaq();

	const hit = faq.entries.find((e) => e._regexes.some((r) => r.test(q)));
	if (!hit) return null;

	return templateEnvVars(hit.answer);
}

/**
 * Randevu oluştur — Cal.com veya stub
 * @param {Object} params
 * @param {string} params.from - WhatsApp numarası
 * @param {Object} params.draft - Randevu taslağı
 * @param {Object} [params.tenant] - Tenant bilgisi
 */
export async function createAppointment({ from, draft, tenant }) {
	const referenceId = `RDV-${Math.floor(Math.random() * 900000 + 100000)}`;
	const phone = from.replace("whatsapp:", "");

	// Cal.com entegrasyonu varsa gerçek randevu oluştur
	if (isCalConfigured(tenant)) {
		try {
			const startTime = `${draft.date}T${draft.time}:00`;
			const apiKey = tenant?.cal_api_key || process.env.CAL_API_KEY;
			const eventTypeId = tenant?.cal_event_type_id || process.env.CAL_EVENT_TYPE_ID;

			const booking = await createBooking({
				name: draft.name,
				email: draft.email || `${phone}@randevual.app`,
				startTime,
				notes: `Hizmet: ${draft.service || "Belirtilmedi"}\n${draft.notes || ""}`,
				eventTypeId,
				apiKey
			});

			// Veritabanına kaydet
			try {
				createAppointmentRecord({
					session_id: from,
					tenant_id: tenant?.id || null,
					customer_name: draft.name,
					customer_phone: phone,
					customer_email: draft.email || null,
					service: draft.service || "Genel",
					date: draft.date,
					time: draft.time,
					cal_booking_uid: booking.uid,
					notes: draft.notes || null
				});
			} catch (dbErr) {
				console.warn("DB kayıt hatası (randevu):", dbErr.message);
			}

			return {
				referenceId,
				calBookingUid: booking.uid,
				from,
				...draft,
				phone,
				status: "ONAYLANDI"
			};
		} catch (calErr) {
			console.error("Cal.com randevu hatası:", calErr.message);
			// Cal.com başarısız olursa stub olarak devam et
		}
	}

	// Stub modu — Cal.com yapılandırılmamış veya başarısız
	try {
		createAppointmentRecord({
			session_id: from,
			tenant_id: tenant?.id || null,
			customer_name: draft.name,
			customer_phone: phone,
			customer_email: draft.email || null,
			service: draft.service || "Genel",
			date: draft.date,
			time: draft.time,
			cal_booking_uid: null,
			notes: draft.notes || null
		});
	} catch (dbErr) {
		console.warn("DB kayıt hatası (stub randevu):", dbErr.message);
	}

	return {
		referenceId,
		from,
		...draft,
		phone,
		status: "ONAYLANDI"
	};
}

/**
 * Randevu iptal et
 */
export async function cancelAppointmentFlow({ from, referenceId, tenant }) {
	try {
		cancelAppointmentByRef(referenceId);
	} catch (err) {
		console.warn("DB iptal hatası:", err.message);
	}
	return { cancelled: true, referenceId };
}

/**
 * İnsan temsilciye yönlendirme
 */
export async function handoffToHuman({ from, summary, tenant }) {
	const available = isWithinBusinessHours(tenant);
	const handoffId = `TEM-${Math.floor(Math.random() * 90000 + 10000)}`;

	return {
		handoffId,
		available,
		from,
		summary
	};
}

/**
 * Müsaitlik kontrolü
 */
export async function checkSlots({ date, tenant }) {
	if (!isCalConfigured(tenant)) {
		return null; // Cal.com yoksa müsaitlik kontrolü yapılamaz
	}

	try {
		const startTime = `${date}T00:00:00`;
		const endTime = `${date}T23:59:59`;
		const apiKey = tenant?.cal_api_key || process.env.CAL_API_KEY;
		const eventTypeId = tenant?.cal_event_type_id || process.env.CAL_EVENT_TYPE_ID;

		return await checkAvailability({ startTime, endTime, eventTypeId, apiKey });
	} catch (err) {
		console.error("Müsaitlik kontrol hatası:", err.message);
		return null;
	}
}
