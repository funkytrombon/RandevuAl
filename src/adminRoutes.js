import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAllTenants, createTenant, updateTenant, deleteTenant } from "./db.js";
import { SECTOR_TEMPLATES } from "./templates.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Basic Auth Middleware
function authMiddleware(req, res, next) {
	const authHeader = req.headers.authorization;
	if (!authHeader) {
		res.setHeader("WWW-Authenticate", 'Basic realm="Admin Paneli"');
		return res.status(401).send("Yetki reddedildi");
	}

	const auth = Buffer.from(authHeader.split(" ")[1], "base64").toString().split(":");
	const user = auth[0];
	const pass = auth[1];

	const correctUser = process.env.ADMIN_USERNAME || "admin";
	const correctPass = process.env.ADMIN_PASSWORD || "123456";

	if (user === correctUser && pass === correctPass) {
		next();
	} else {
		res.setHeader("WWW-Authenticate", 'Basic realm="Admin Paneli"');
		return res.status(401).send("Hatalı şifre");
	}
}

// Tüm admin altındaki istekler auth sisteminden geçmeli
router.use(authMiddleware);

// --- API ROTASI ---
router.get("/api/tenants", (req, res) => {
	res.json(getAllTenants());
});

router.get("/api/templates", (req, res) => {
	res.json(SECTOR_TEMPLATES);
});

router.post("/api/tenants", (req, res) => {
	const tenant = createTenant(req.body);
	res.json(tenant);
});

router.put("/api/tenants/:id", (req, res) => {
	const updated = updateTenant(req.params.id, req.body);
	if (!updated) return res.status(404).json({ error: "Tenant bulunamadı" });
	res.json(updated);
});

router.delete("/api/tenants/:id", (req, res) => {
	const success = deleteTenant(req.params.id);
	if (!success) return res.status(404).json({ error: "Tenant bulunamadı" });
	res.json({ success: true });
});

// Arayüzü (HTML/JS) güvenli katmanın altında sun
router.use("/", express.static(path.join(__dirname, "..", "public", "admin")));

export default router;
