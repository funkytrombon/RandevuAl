/**
 * Cal.com API v2 entegrasyonu
 * Müsaitlik kontrolü, randevu oluşturma, iptal ve yeniden planlama.
 */

const BASE_URL = process.env.CAL_BASE_URL || "https://api.cal.com";

async function calRequest(method, endpoint, { apiKey, body } = {}) {
	const key = apiKey || process.env.CAL_API_KEY;
	if (!key) throw new Error("Cal.com API anahtarı bulunamadı");

	const url = `${BASE_URL}${endpoint}`;
	const options = {
		method,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${key}`,
			"cal-api-version": "2024-08-13"
		}
	};

	if (body && method !== "GET") {
		options.body = JSON.stringify(body);
	}

	const res = await fetch(url, options);
	const data = await res.json();

	if (!res.ok) {
		console.error(`Cal.com API error [${res.status}]:`, data);
		throw new Error(`Cal.com API hatası: ${res.status} — ${data.message || JSON.stringify(data)}`);
	}

	return data;
}

/**
 * Müsait slotları kontrol et
 * @param {Object} params
 * @param {string} params.startTime - ISO 8601 (e.g. "2026-03-29T00:00:00Z")
 * @param {string} params.endTime - ISO 8601
 * @param {string} [params.eventTypeId] - Cal.com event type ID
 * @param {string} [params.apiKey] - Tenant-specific API key
 */
export async function checkAvailability({ startTime, endTime, eventTypeId, apiKey }) {
	const typeId = eventTypeId || process.env.CAL_EVENT_TYPE_ID;
	const query = new URLSearchParams({
		startTime,
		endTime,
		eventTypeId: typeId
	});

	const data = await calRequest("GET", `/v2/slots/available?${query}`, { apiKey });
	return data.data?.slots || data.slots || [];
}

/**
 * Randevu oluştur
 * @param {Object} params
 * @param {string} params.name - Müşteri adı
 * @param {string} params.email - Müşteri e-posta
 * @param {string} params.startTime - ISO 8601
 * @param {string} [params.notes] - Ek notlar
 * @param {string} [params.eventTypeId]
 * @param {string} [params.apiKey]
 */
export async function createBooking({ name, email, startTime, notes, eventTypeId, apiKey }) {
	const typeId = eventTypeId || process.env.CAL_EVENT_TYPE_ID;

	// İstanbul saatine göre (UTC+3 kabul edip) evrensel ISO değerini bul
	const localDateObj = new Date(`${startTime}+03:00`); 
	const isoZ = localDateObj.toISOString(); // "YYYY-MM-DDTHH:mm:00.000Z"

	const body = {
		eventTypeId: Number(typeId),
		start: isoZ,
		attendee: {
			name,
			email: email || `${name.replace(/\s+/g, ".").toLowerCase()}@randevual.placeholder`,
			timeZone: process.env.BUSINESS_TIMEZONE || "Europe/Istanbul",
			language: "tr"
		},
		bookingFieldsResponses: {
			notes: notes || ""
		}
	};

	try {
		const data = await calRequest("POST", "/v2/bookings", { apiKey, body });
		return {
			uid: data.data?.uid || data.uid || data.id,
			startTime: data.data?.startTime || data.startTime || startTime,
			endTime: data.data?.endTime || data.endTime,
			status: data.data?.status || data.status || "ACCEPTED"
		};
	} catch (e) {
		console.error("Cal API Booking Error:", e.message);
		throw e;
	}
}

/**
 * Randevu iptal et
 * @param {string} bookingUid - Cal.com booking UID
 * @param {string} [apiKey]
 */
export async function cancelBooking(bookingUid, apiKey) {
	return calRequest("POST", `/v2/bookings/${bookingUid}/cancel`, { apiKey });
}

/**
 * Randevu yeniden planla
 * @param {string} bookingUid
 * @param {string} newStartTime - ISO 8601
 * @param {string} [apiKey]
 */
export async function rescheduleBooking(bookingUid, newStartTime, apiKey) {
	return calRequest("POST", `/v2/bookings/${bookingUid}/reschedule`, {
		apiKey,
		body: { start: newStartTime }
	});
}

/**
 * Cal.com bağlantısını test et
 * @param {string} [apiKey]
 */
export async function testConnection(apiKey) {
	try {
		const data = await calRequest("GET", "/v2/me", { apiKey });
		return { ok: true, user: data.data?.name || data.name };
	} catch (err) {
		return { ok: false, error: err.message };
	}
}

/**
 * Cal.com yapılandırılmış mı kontrol et
 */
export function isCalConfigured(tenant) {
	const apiKey = tenant?.cal_api_key || process.env.CAL_API_KEY;
	const eventTypeId = tenant?.cal_event_type_id || process.env.CAL_EVENT_TYPE_ID;
	return !!(apiKey && eventTypeId);
}
