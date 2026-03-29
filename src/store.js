/**
 * Session yönetimi — JSON dosya tabanlı + in-memory fallback
 */

import { getSessionFromDb, upsertSession } from "./db.js";

const processedMessageSids = new Set();
const fallbackSessions = new Map();

/**
 * Session şeması:
 * {
 *   history: OpenAI chat messages (rolling window),
 *   flow: null | "RANDEVU",
 *   appointmentDraft: {
 *     service?: string,
 *     date?: string,     // YYYY-MM-DD
 *     time?: string,     // HH:mm
 *     name?: string,
 *     phone?: string,
 *     notes?: string
 *   }
 * }
 */

export function hasProcessed(messageSid) {
	return processedMessageSids.has(messageSid);
}

export function markProcessed(messageSid) {
	processedMessageSids.add(messageSid);
	// Bellek temizliği
	if (processedMessageSids.size > 10000) {
		const arr = [...processedMessageSids];
		arr.slice(0, arr.length - 5000).forEach((sid) => processedMessageSids.delete(sid));
	}
}

function defaultSession() {
	return {
		history: [],
		flow: null,
		appointmentDraft: {}
	};
}

export function getSession(userId, tenantId) {
	if (tenantId) {
		try {
			const dbSession = getSessionFromDb(userId, tenantId);
			if (dbSession) {
				return {
					history: JSON.parse(dbSession.chat_messages || "[]"),
					flow: dbSession.flow || null,
					appointmentDraft: JSON.parse(dbSession.appointment_draft || "{}"),
					dbRecord: dbSession
				};
			}
		} catch (err) {
			console.warn("Session okuma hatası:", err.message);
		}
	}

	return fallbackSessions.get(userId) ?? defaultSession();
}

export function setSession(userId, session, tenantId) {
	if (tenantId) {
		try {
			upsertSession(userId, tenantId, {
				chat_messages: JSON.stringify(session.history || []),
				flow: session.flow || null,
				appointment_draft: JSON.stringify(session.appointmentDraft || {}),
				customer_name: session.appointmentDraft?.name || null,
				customer_phone: userId.replace("whatsapp:", ""),
				service_type: session.appointmentDraft?.service || null
			});
		} catch (err) {
			console.warn("Session yazma hatası:", err.message);
			fallbackSessions.set(userId, session);
		}
	} else {
		fallbackSessions.set(userId, session);
	}
}
