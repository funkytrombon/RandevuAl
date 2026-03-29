import twilio from "twilio";

export function getTwilioClient() {
	const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
	if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
		throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
	}
	return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

/**
 * Validate Twilio webhook signature to prevent spoofed requests.
 * publicUrl must match EXACTLY what Twilio calls (scheme/host/path).
 */
export function validateTwilioWebhook({ req, publicUrl }) {
	// Debugging: Bypass authentication if explicitly set in .env
	if (process.env.BYPASS_TWILIO_AUTH === "true") {
		console.log("⚠️ [DEBUG] BYPASS_TWILIO_AUTH aktif! Güvenlik kontrolü atlanıyor...");
		return true;
	}

	const signature = req.headers["x-twilio-signature"];
	if (!signature) {
		console.log("❌ [HATA] Twilio imzası eksik (x-twilio-signature header bulunamadı).");
		return false;
	}

	const authToken = process.env.TWILIO_AUTH_TOKEN;
	return twilio.validateRequest(authToken, signature, publicUrl, req.body);
}

/**
 * Send a WhatsApp message via Twilio REST API.
 */
export async function sendWhatsAppMessage({ to, body, from }) {
	const client = getTwilioClient();
	const sender = from || process.env.TWILIO_WHATSAPP_FROM;
	if (!sender) throw new Error("Missing sender number (from or TWILIO_WHATSAPP_FROM)");

	return client.messages.create({
		from: sender.startsWith('whatsapp:') ? sender : `whatsapp:${sender}`,
		to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
		body
	});
}
