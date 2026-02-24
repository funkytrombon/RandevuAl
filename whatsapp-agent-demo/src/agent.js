import OpenAI from "openai";
import { lookupRestaurantFaq, createReservationStub, handoffToHumanStub } from "./tools.js";
import { isWithinBusinessHours } from "./bizHours.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function mustHaveEnv(name) {
	if (!process.env[name]) throw new Error(`Missing ${name}`);
}

function restaurantContext() {
	return {
		name: process.env.RESTAURANT_NAME || "Our Business",
		phone: process.env.RESTAURANT_PHONE || "N/A",
		address: process.env.RESTAURANT_ADDRESS || "N/A",
		tz: process.env.RESTAURANT_TIMEZONE || "America/Chicago"
	};
}

function missingReservationFields(draft) {
	// Phone intentionally NOT required for the demo.
	const missing = [];
	if (!draft.partySize) missing.push("partySize");
	if (!draft.date) missing.push("date");
	if (!draft.time) missing.push("time");
	if (!draft.name) missing.push("name");
	return missing;
}

function nextReservationQuestion(missing) {
	const field = missing[0];

	switch (field) {
		case "partySize":
			return "Absolutely — how many people should I plan for?";
		case "date":
			return "Nice. What day were you thinking — today, tomorrow, or another date?";
		case "time":
			return "And what time works best?";
		case "name":
			return "Perfect. What name should I put it under?";
		default:
			return "Got it — what details should I add?";
	}
}

async function extractReservationFields({ model, userText }) {
	const tz = process.env.RESTAURANT_TIMEZONE || "America/Chicago";

	const extractorSystem = `
Extract reservation details from the user's message.
Return JSON only:
{
  "partySize": number|null,
  "date": "YYYY-MM-DD"|null,
  "time": "HH:mm"|null,
  "name": string|null,
  "phone": string|null,
  "notes": string|null,
  "cancel": boolean
}
Rules:
- If user wants to cancel/stop, set cancel=true.
- If no value present, use null.
- Interpret relative dates like "today", "tonight", "this evening", "tomorrow" using timezone: ${tz}.
- Convert times like "7pm" to 24-hour "19:00".
- If the user says "this evening" and provides a time, treat date as today.
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
	for (const key of ["partySize", "date", "time", "name", "phone", "notes"]) {
		const v = parsed?.[key];
		if (v !== null && v !== undefined && v !== "") next[key] = v;
	}
	return next;
}

export async function runAgent({ from, userText, session }) {
	mustHaveEnv("OPENAI_API_KEY");
	const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
	const info = restaurantContext();

	// --- Reservation flow mode ---
	if (session.flow === "RESERVATION") {
		const parsed = await extractReservationFields({ model, userText });

		if (parsed.cancel) {
			session.flow = null;
			session.reservationDraft = {};
			return {
				reply: "No problem — I’ve cancelled the reservation request. Anything else I can help with?",
				newSession: session
			};
		}

		session.reservationDraft = mergeDraft(session.reservationDraft, parsed);

		const missing = missingReservationFields(session.reservationDraft);
		if (missing.length > 0) {
			return { reply: nextReservationQuestion(missing), newSession: session };
		}

		const result = await createReservationStub({ from, draft: session.reservationDraft });

		session.flow = null;
		session.reservationDraft = {};

		const msg =
			`✅ You’re all set (demo)\n` +
			`Name: ${result.name}\n` +
			`Party: ${result.partySize}\n` +
			`When: ${result.date} at ${result.time}\n` +
			`Confirmation: ${result.reservationId}\n\n` +
			`Anything else I can help with?`;

		return { reply: msg, newSession: session };
	}

	// --- Normal mode: plan what to do ---
	const withinHours = isWithinBusinessHours();
	const history = session.history.slice(-10);

	const system = `
You are the WhatsApp assistant for "${info.name}".
You can:
1) Answer FAQs (hours, location, menu/dietary, parking, specials, takeout).
2) Start a reservation/appointment flow.
3) Start a human handoff.
Keep messages short and friendly. Ask one question at a time.
Return JSON only:
{
  "intent": "FAQ"|"RESERVATION"|"HANDOFF"|"GENERAL",
  "startReservation": boolean,
  "startHandoff": boolean,
  "faqQuery": string|null,
  "handoffSummary": string|null,
  "reply": string
}
Business hours availability right now: ${withinHours ? "AVAILABLE" : "NOT_AVAILABLE"}.
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
			intent: "GENERAL",
			startReservation: false,
			startHandoff: false,
			faqQuery: null,
			handoffSummary: null,
			reply: "Could you rephrase that?"
		};
	}

	// Try FAQ tool first when appropriate
	if (plan.intent === "FAQ" || plan.faqQuery) {
		const answer = await lookupRestaurantFaq({ question: plan.faqQuery || userText });
		if (answer) {
			session.history = [
				...history,
				{ role: "user", content: userText },
				{ role: "assistant", content: answer }
			];
			return { reply: answer, newSession: session };
		}
	}

	// Start reservation flow — IMPORTANT: extract immediately from the original user message
	if (plan.startReservation || plan.intent === "RESERVATION") {
		session.flow = "RESERVATION";

		const initialParsed = await extractReservationFields({ model, userText });
		if (initialParsed.cancel) {
			session.flow = null;
			session.reservationDraft = {};
			const msg = "All good — I won’t make a reservation. Anything else?";
			session.history = [...history, { role: "user", content: userText }, { role: "assistant", content: msg }];
			return { reply: msg, newSession: session };
		}

		session.reservationDraft = mergeDraft({}, initialParsed);

		const missing = missingReservationFields(session.reservationDraft);
		const reply = missing.length > 0
			? nextReservationQuestion(missing)
			: "Got it. What name should I put it under?";

		session.history = [
			...history,
			{ role: "user", content: userText },
			{ role: "assistant", content: reply }
		];

		// If we somehow already have everything including name, we can auto-confirm.
		// (We keep it simple and ask for name if missingReservationFields returned empty unexpectedly.)
		if (missing.length === 0 && session.reservationDraft.name) {
			const result = await createReservationStub({ from, draft: session.reservationDraft });

			session.flow = null;
			session.reservationDraft = {};

			const msg =
				`✅ Reservation confirmed (demo)\n` +
				`• Name: ${result.name}\n` +
				`• Party: ${result.partySize}\n` +
				`• When: ${result.date} at ${result.time}\n` +
				`Confirmation: ${result.reservationId}\n\n` +
				`Anything else you’d like to know about ${info.name}?`;

			session.history = [...history, { role: "user", content: userText }, { role: "assistant", content: msg }];
			return { reply: msg, newSession: session };
		}

		return { reply, newSession: session };
	}

	// Start human handoff (stub)
	if (plan.startHandoff || plan.intent === "HANDOFF") {
		const summary = plan.handoffSummary || userText;
		const result = await handoffToHumanStub({ from, summary });

		const reply = result.available
			? `Got it — I’m looping in a human now (demo). Please share any extra details here and they’ll reply shortly.\nRef: ${result.handoffId}`
			: `We’re currently outside business hours. I can take a message and a human will follow up when we’re open.\nRef: ${result.handoffId}\nWhat should I pass along?`;

		session.history = [
			...history,
			{ role: "user", content: userText },
			{ role: "assistant", content: reply }
		];

		return { reply, newSession: session };
	}

	// Default reply
	const reply =
		typeof plan.reply === "string" && plan.reply.trim()
			? plan.reply.trim()
			: `How can I help? (hours, reservations, or a human)`;

	session.history = [
		...history,
		{ role: "user", content: userText },
		{ role: "assistant", content: reply }
	];

	return { reply, newSession: session };
}
