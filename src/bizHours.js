/**
 * Mesai saatleri kontrolü
 * Europe/Istanbul varsayılan timezone
 */

function parseRange(range) {
	if (!range || range.toLowerCase() === "kapalı" || range.toLowerCase() === "kapali") {
		return null; // Kapalı gün
	}
	const [start, end] = range.split("-");
	const toMin = (hhmm) => {
		const [h, m] = hhmm.split(":").map(Number);
		return h * 60 + m;
	};
	return { startMin: toMin(start), endMin: toMin(end) };
}

function getLocalParts(timeZone) {
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false
	});

	const parts = fmt.formatToParts(new Date());
	const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

	return {
		weekday: map.weekday, // Mon Tue Wed Thu Fri Sat Sun
		minutes: Number(map.hour) * 60 + Number(map.minute)
	};
}

/**
 * Şu an mesai saatleri içinde mi?
 * @param {Object} [tenant] - Tenant bilgisi (opsiyonel)
 * @returns {boolean}
 */
export function isWithinBusinessHours(tenant) {
	const tz = tenant?.timezone || process.env.BUSINESS_TIMEZONE || "Europe/Istanbul";
	const { weekday, minutes } = getLocalParts(tz);

	const monFri = tenant?.working_hours_weekday || process.env.BIZ_HOURS_MON_FRI || "09:00-18:00";
	const sat = tenant?.working_hours_saturday || process.env.BIZ_HOURS_SAT || "10:00-14:00";
	const sun = tenant?.working_hours_sunday || process.env.BIZ_HOURS_SUN || "Kapalı";

	let rangeStr = monFri;
	if (weekday === "Sat") rangeStr = sat;
	if (weekday === "Sun") rangeStr = sun;

	const range = parseRange(rangeStr);
	if (!range) return false; // Kapalı gün

	return minutes >= range.startMin && minutes < range.endMin;
}

/**
 * İş günü ve saatlerini formatlanmış string olarak döndür
 * @param {Object} [tenant]
 * @returns {string}
 */
export function getBusinessHoursText(tenant) {
	const monFri = tenant?.working_hours_weekday || process.env.BIZ_HOURS_MON_FRI || "09:00-18:00";
	const sat = tenant?.working_hours_saturday || process.env.BIZ_HOURS_SAT || "10:00-14:00";
	const sun = tenant?.working_hours_sunday || process.env.BIZ_HOURS_SUN || "Kapalı";

	return `Pazartesi-Cuma: ${monFri}\nCumartesi: ${sat}\nPazar: ${sun}`;
}
