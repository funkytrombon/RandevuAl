/**
 * Basit JSON dosya tabanlı veritabanı
 * Derleme gerektirmez, tüm platformlarda çalışır.
 * Veriler: data/randevual-db.json
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, "..", "data", "randevual-db.json");

// --- Veritabanı şeması ---
const DEFAULT_DB = {
	tenants: [],
	sessions: [],
	appointments: [],
	messages: [],
	_meta: { version: 1, created: new Date().toISOString() }
};

// --- Düşük seviyeli okuma/yazma ---

function readDb() {
	try {
		if (!fs.existsSync(DB_PATH)) {
			writeDb(DEFAULT_DB);
			return { ...DEFAULT_DB };
		}
		const data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
		// Ensure all keys from DEFAULT_DB exist (for backward compatibility)
		return { ...DEFAULT_DB, ...data };
	} catch (err) {
		console.error("DB Read Error:", err);
		return { ...DEFAULT_DB };
	}
}

function writeDb(data) {
	const dir = path.dirname(DB_PATH);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function nextId(collection) {
	if (!collection.length) return 1;
	return Math.max(...collection.map((r) => r.id ?? 0)) + 1;
}

function now() {
	return new Date().toISOString();
}

function hashPassword(str) {
	if (!str) return null;
	return crypto.createHash("sha256").update(str).digest("hex");
}

// --- Tenant İşlemleri ---

export function findTenantByNumber(phoneNumber) {
	const db = readDb();
	const clean = (phoneNumber || "").replace("whatsapp:", "");
	return db.tenants.find(
		(t) => t.twilio_number === clean || t.whatsapp_number === clean
	) || null;
}

export function createTenant(data) {
	const db = readDb();
	
	// Eğer auth için şifre gelirse, hashlenecek
	const { password, ...rest } = data;
	const tenant = { 
		id: nextId(db.tenants), ...rest,
		password_hash: password ? hashPassword(password) : null,
		created_at: now(), updated_at: now() 
	};
	
	db.tenants.push(tenant);
	writeDb(db);
	return tenant;
}

export function updateTenant(tenantId, data) {
	const db = readDb();
	const idx = db.tenants.findIndex((t) => t.id === Number(tenantId));
	if (idx === -1) return null;
	
	const { password, ...rest } = data;
	const updated = { ...db.tenants[idx], ...rest, updated_at: now() };
	if (password) updated.password_hash = hashPassword(password);
	
	db.tenants[idx] = updated;
	writeDb(db);
	return updated;
}

export function deleteTenant(tenantId) {
	const db = readDb();
	const idx = db.tenants.findIndex((t) => t.id === Number(tenantId));
	if (idx === -1) return false;
	db.tenants.splice(idx, 1);
	writeDb(db);
	return true;
}

export function getAllTenants() {
	return readDb().tenants;
}

export function getTenantByCredentials(email, password) {
	const db = readDb();
	const hashed = hashPassword(password);
	return db.tenants.find(t => t.email === email && t.password_hash === hashed) || null;
}

export function getDefaultTenant() {
	const db = readDb();
	if (db.tenants.length > 0) return db.tenants[0];

	// İlk kez: env'den varsayılan tenant oluştur
	return createTenant({
		company_name: process.env.BUSINESS_NAME || "Sağlık Merkezi",
		sector: process.env.BUSINESS_SECTOR || "health",
		locale: "tr",
		twilio_number: (process.env.TWILIO_WHATSAPP_FROM || "").replace("whatsapp:", ""),
		whatsapp_number: (process.env.TWILIO_WHATSAPP_FROM || "").replace("whatsapp:", ""),
		subscription_plan: "enterprise",
		cal_api_key: process.env.CAL_API_KEY || null,
		cal_event_type_id: process.env.CAL_EVENT_TYPE_ID || null,
		services: process.env.BUSINESS_SERVICES || "Genel Muayene",
		working_hours_weekday: process.env.BIZ_HOURS_MON_FRI || "09:00-18:00",
		working_hours_saturday: process.env.BIZ_HOURS_SAT || "10:00-14:00",
		working_hours_sunday: process.env.BIZ_HOURS_SUN || "Kapalı",
		timezone: process.env.BUSINESS_TIMEZONE || "Europe/Istanbul",
		current_month_messages: 0,
		current_month_ai_calls: 0,
		total_conversations: 0
	});
}

export function incrementTenantUsage(tenantId) {
	const db = readDb();
	const tenant = db.tenants.find((t) => t.id === tenantId);
	if (tenant) {
		tenant.current_month_ai_calls = (tenant.current_month_ai_calls || 0) + 1;
		tenant.total_conversations = (tenant.total_conversations || 0) + 1;
		tenant.updated_at = now();
		writeDb(db);
	}
}

// --- Session İşlemleri ---

export function getSessionFromDb(sessionId, tenantId) {
	const db = readDb();
	return db.sessions.find(
		(s) => s.session_id === sessionId && s.tenant_id === tenantId
	) || null;
}

export function upsertSession(sessionId, tenantId, data) {
	const db = readDb();
	const idx = db.sessions.findIndex(
		(s) => s.session_id === sessionId && s.tenant_id === tenantId
	);

	if (idx >= 0) {
		db.sessions[idx] = {
			...db.sessions[idx],
			...data,
			session_id: sessionId,
			tenant_id: tenantId,
			updated_at: now(),
			last_message_at: now()
		};
	} else {
		db.sessions.push({
			id: nextId(db.sessions),
			session_id: sessionId,
			tenant_id: tenantId,
			status: "ACTIVE",
			customer_phone: sessionId.replace("whatsapp:", ""),
			chat_messages: "[]",
			flow: null,
			appointment_draft: "{}",
			followup_count: 0,
			created_at: now(),
			updated_at: now(),
			last_message_at: now(),
			booking_probability: 0,
			sentiment: "neutral",
			...data
		});
	}

	writeDb(db);
	return getSessionFromDb(sessionId, tenantId);
}

export function updateSessionStatus(sessionId, tenantId, status) {
	const db = readDb();
	const session = db.sessions.find(
		(s) => s.session_id === sessionId && s.tenant_id === tenantId
	);
	if (session) {
		session.status = status;
		session.updated_at = now();
		writeDb(db);
	}
}

// --- Randevu İşlemleri ---

export function createAppointmentRecord(data) {
	const db = readDb();
	const referenceId = data.reference_id || `RDV-${Math.floor(Math.random() * 900000 + 100000)}`;
	const appointment = {
		id: nextId(db.appointments),
		reference_id: referenceId,
		status: "CONFIRMED",
		created_at: now(),
		updated_at: now(),
		...data
	};
	db.appointments.push(appointment);
	writeDb(db);
	return { referenceId, ...data };
}

export function findAppointmentsByPhone(phone, tenantId) {
	const db = readDb();
	const clean = (phone || "").replace("whatsapp:", "");
	return db.appointments
		.filter((a) => a.customer_phone === clean && a.tenant_id === tenantId)
		.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function cancelAppointmentByRef(refId) {
	const db = readDb();
	const appt = db.appointments.find((a) => a.reference_id === refId);
	if (appt) {
		appt.status = "CANCELLED";
		appt.updated_at = now();
		writeDb(db);
	}
}

// --- Mesaj Loglama (Inbox) ---

export function logMessage({ tenantId, customerPhone, body, direction, source = 'ai', intent = null, sentiment = null, booking_probability = null }) {
	const db = readDb();
	const cleanPhone = (customerPhone || "").replace("whatsapp:", "");
	
	const message = {
		id: nextId(db.messages),
		tenant_id: tenantId,
		customer_phone: cleanPhone,
		body,
		direction, // 'incoming' veya 'outgoing'
		source,    // 'ai' veya 'manual'
		intent,
		sentiment,
		booking_probability,
		created_at: now()
	};
	
	// Update session with latest metrics if it's an outgoing message from AI
	if (direction === 'outgoing' && source === 'ai' && booking_probability !== null) {
		const session = db.sessions.find(s => s.session_id === `whatsapp:${cleanPhone}` && s.tenant_id === tenantId);
		if (session) {
			session.booking_probability = booking_probability;
			session.sentiment = sentiment;
			session.updated_at = now();
		}
	}

	db.messages.push(message);
	writeDb(db);
	return message;
}

export function getChatList(tenantId) {
	const db = readDb();
	const tenantMessages = db.messages.filter(m => m.tenant_id === tenantId);
	
	// Her telefon numarası için en son mesajı bul
	const chats = {};
	tenantMessages.forEach(m => {
		if (!chats[m.customer_phone] || new Date(m.created_at) > new Date(chats[m.customer_phone].last_message_at)) {
			chats[m.customer_phone] = {
				phone: m.customer_phone,
				last_message: m.body,
				last_message_at: m.created_at,
				unread_count: 0 // İleride eklenebilir
			};
		}
	});
	
	return Object.values(chats).sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
}

export function getChatMessages(tenantId, customerPhone) {
	const db = readDb();
	const cleanPhone = (customerPhone || "").replace("whatsapp:", "");
	return db.messages
		.filter(m => m.tenant_id === tenantId && m.customer_phone === cleanPhone)
		.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// --- Kullanım Limiti ---

// --- İstatistikler ---

export function getTenantStats(tenantId) {
	const db = readDb();
	const sessions = db.sessions.filter(s => s.tenant_id === tenantId);
	const appointments = db.appointments.filter(a => a.tenant_id === tenantId);
	
	// AI-Rescued: User had negative sentiment or TEMSILCI intent but eventually booked an appointment
	let rescuedCount = 0;
	sessions.forEach(session => {
		const sessionMessages = db.messages.filter(m => m.tenant_id === tenantId && m.customer_phone === session.customer_phone);
		const hadNegative = sessionMessages.some(m => m.sentiment === 'negative' || m.intent === 'TEMSILCI');
		const hasAppointment = appointments.some(a => a.customer_phone === session.customer_phone);
		if (hadNegative && hasAppointment) rescuedCount++;
	});

	const totalProbability = sessions.reduce((acc, s) => acc + (s.booking_probability || 0), 0);
	const avgProbability = sessions.length > 0 ? Math.round(totalProbability / sessions.length) : 0;

	// Sentiment breakdown
	const sentiments = { positive: 0, neutral: 0, negative: 0 };
	sessions.forEach(s => { sentiments[s.sentiment || 'neutral']++; });

	return {
		total_appointments: appointments.length,
		ai_rescued: rescuedCount,
		avg_probability: avgProbability,
		sentiments,
		total_sessions: sessions.length
	};
}

export function checkUsageLimit(tenant) {
	const limits = {
		free: 50,
		starter: 500,
		pro: Infinity
	};
	
	// Eski kayıtlarda "enterprise" vb. varsa uyumluluk için sınırsız kabul et
	let plan = tenant?.subscription_plan || "free";
	if (plan === "enterprise" || plan === "professional") plan = "pro";

	const max = limits[plan] || 50;
	return (tenant?.current_month_ai_calls || 0) < max;
}

// Başlangıçta veritabanını oluştur / kontrol et
try {
	readDb();
	console.log(`✅ JSON veritabanı hazır: ${DB_PATH}`);
} catch (err) {
	console.warn("⚠️ Veritabanı başlatma hatası:", err.message);
}
