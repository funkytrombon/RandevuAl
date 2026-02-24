import { loadFaq } from "./faq.js";
import { isWithinBusinessHours } from "./bizHours.js";

function templateEnvVars(text) {
	if (!text) return text;

	return text.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => {
		if (!(key in process.env)) {
			// optional: warn loudly for missing config
			console.warn(`Missing env var for FAQ template: ${key}`);
			return "";
		}
		return process.env[key] ?? "";
	});
}

export async function lookupRestaurantFaq({ question }) {
	const q = question || "";
	const faq = loadFaq();

	const hit = faq.entries.find((e) => e._regexes.some((r) => r.test(q)));
	if (!hit) return null;

	return templateEnvVars(hit.answer);
}

export async function createReservationStub({ from, draft }) {
	const reservationId = `RSV-${Math.floor(Math.random() * 900000 + 100000)}`;

	// Demo choice: don't ask for phone; stub it.
	const phoneStub = "(demo) phone not collected";

	return {
		reservationId,
		from,
		...draft,
		phone: draft.phone ?? phoneStub,
		status: "CONFIRMED (stubbed)"
	};
}

export async function handoffToHumanStub({ from, summary }) {
	const available = isWithinBusinessHours();
	const handoffId = `HUM-${Math.floor(Math.random() * 90000 + 10000)}`;

	return {
		handoffId,
		available,
		from,
		summary
	};
}
