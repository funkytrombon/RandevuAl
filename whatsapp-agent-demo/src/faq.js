import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedFaq = null;

function resolveFaqPath() {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = path.dirname(__filename);
	return path.join(__dirname, "..", "data", "faq.json");
}

export function loadFaq() {
	if (cachedFaq) return cachedFaq;

	const faqPath = resolveFaqPath();
	const raw = fs.readFileSync(faqPath, "utf-8");
	const json = JSON.parse(raw);

	if (!json || !Array.isArray(json.entries)) {
		throw new Error("faq.json must have an { entries: [] } structure");
	}

	cachedFaq = {
		...json,
		entries: json.entries.map((e) => {
			if (!e.id || !e.answer || !e.patterns) {
				throw new Error("Each FAQ entry must have id, patterns, answer");
			}
			const regexes = e.patterns.map((p) => new RegExp(p, "i"));
			return { ...e, _regexes: regexes };
		})
	};

	return cachedFaq;
}
