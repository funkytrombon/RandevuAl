import express from "express";
import { createTenant, getTenantByCredentials, getAllTenants, updateTenant, getChatList, getChatMessages, logMessage, getTenantStats } from "./db.js";
import { sendWhatsAppMessage } from "./twilio.js";

const router = express.Router();

router.post("/api/auth/register", (req, res) => {
	const { company_name, email, password, sector } = req.body;
	if (!email || !password || !company_name) return res.status(400).json({ error: "Lütfen tüm zorunlu alanları doldurun." });
	
	const dbTenants = getAllTenants();
	if (dbTenants.some(t => t.email === email)) return res.status(400).json({ error: "Bu email adresi zaten kullanımda." });

	const t = createTenant({ company_name, email, password, sector, subscription_plan: "free" });
	// Güvenli dönüş yap (şifreyi gizle)
	res.json({ token: `${t.id}:${t.password_hash}`, tenantId: t.id });
});

router.post("/api/auth/login", (req, res) => {
	const { email, password } = req.body;
	const t = getTenantByCredentials(email, password);
	if (!t) return res.status(401).json({ error: "Email veya şifre hatalı." });
	res.json({ token: `${t.id}:${t.password_hash}`, tenantId: t.id });
});

// Oturum Koruma Middleware
export function verifyClientAuth(req, res, next) {
	const auth = req.headers.authorization;
	if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Yetkisiz erişim" });

	const token = auth.split(" ")[1];
	const [idStr, pHash] = token.split(":");
	
	const dbTenants = getAllTenants();
	const t = dbTenants.find(x => x.id === Number(idStr) && x.password_hash === pHash);
	
	if (!t) return res.status(401).json({ error: "Geçersiz token" });
	
	req.tenant = t;
	next();
}

router.get("/api/dashboard/me", verifyClientAuth, (req, res) => {
	// Şifre hashi hariç tüm bilgileri dön
	const { password_hash, ...safeData } = req.tenant;
	res.json(safeData);
});

router.put("/api/dashboard/me", verifyClientAuth, (req, res) => {
	const { password, ...updates } = req.body; // Müşteri kendi şifresini düzeltemesin (şimdilik) veya engelle
	
	const updated = updateTenant(req.tenant.id, updates);
	const { password_hash, ...safeData } = updated;
	res.json(safeData);
});

router.get("/api/dashboard/stats", verifyClientAuth, (req, res) => {
	const stats = getTenantStats(req.tenant.id);
	res.json(stats);
});

// --- INBOX API ---

router.get("/api/chats", verifyClientAuth, (req, res) => {
	const chats = getChatList(req.tenant.id);
	res.json(chats);
});

router.get("/api/chats/:phone", verifyClientAuth, (req, res) => {
	const messages = getChatMessages(req.tenant.id, req.params.phone);
	res.json(messages);
});

router.post("/api/chats/:phone/send", verifyClientAuth, async (req, res) => {
	const { body } = req.body;
	const { phone } = req.params;

	try {
		// Twilio üzerinden gönder
		await sendWhatsAppMessage({
			to: phone,
			body: body,
			from: req.tenant.twilio_number
		});

		// Veritabanına logla
		const logged = logMessage({
			tenantId: req.tenant.id,
			customerPhone: phone,
			body: body,
			direction: 'outgoing',
			source: 'manual' // İnsan tarafından gönderildi
		});

		res.json(logged);
	} catch (e) {
		console.error("Manual send error:", e);
		res.status(500).json({ error: "Mesaj gönderilemedi." });
	}
});

export default router;
