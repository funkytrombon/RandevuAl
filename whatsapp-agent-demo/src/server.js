import "dotenv/config";
import express from "express";
import morgan from "morgan";

import { validateTwilioWebhook, sendWhatsAppMessage } from "./twilio.js";
import { hasProcessed, markProcessed, getSession, setSession } from "./store.js";
import { runAgent } from "./agent.js";

const app = express();
app.use(morgan("dev"));

// Twilio sends application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));

app.get("/", (req, res) => {
	res.status(200).send("ok");
});

app.post("/twilio/whatsapp", async (req, res) => {
	try {
		const publicUrl = process.env.PUBLIC_WEBHOOK_URL;
		if (!publicUrl) return res.status(500).send("Missing PUBLIC_WEBHOOK_URL");

		const valid = validateTwilioWebhook({ req, publicUrl });
		if (!valid) return res.status(403).send("Invalid Twilio signature");

		const messageSid = req.body.MessageSid;
		const from = req.body.From; // "whatsapp:+1..."
		const body = (req.body.Body || "").trim();

		if (!messageSid || !from) return res.status(400).send("Bad request");

		// Idempotency: Twilio may retry webhooks
		if (hasProcessed(messageSid)) return res.status(200).send("duplicate");
		markProcessed(messageSid);

		if (!body) {
			await sendWhatsAppMessage({ to: from, body: "Send a message and I’ll help." });
			return res.status(200).send("ok");
		}

		const session = getSession(from);
		const { reply, newSession } = await runAgent({ from, userText: body, session });

		setSession(from, newSession);
		await sendWhatsAppMessage({ to: from, body: reply });

		res.status(200).send("ok");
	} catch (err) {
		console.error(err);
		res.status(500).send("server error");
	}
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Listening on :${port}`));
