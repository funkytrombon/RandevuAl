/**
 * Sliding window rate limiter
 * Telefon numarası başına dakikada max mesaj sayısı kontrolü
 */

const windows = new Map();

const MAX_MESSAGES = 5;
const WINDOW_MS = 60_000; // 1 dakika

/**
 * Rate limit kontrolü
 * @param {string} phoneNumber - Kullanıcı telefon numarası
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
 */
export function checkRateLimit(phoneNumber) {
	const now = Date.now();
	const key = phoneNumber;

	if (!windows.has(key)) {
		windows.set(key, []);
	}

	const timestamps = windows.get(key);

	// Pencere dışındaki kayıtları temizle
	const cutoff = now - WINDOW_MS;
	const filtered = timestamps.filter((t) => t > cutoff);
	windows.set(key, filtered);

	if (filtered.length >= MAX_MESSAGES) {
		const oldestInWindow = filtered[0];
		const retryAfterMs = oldestInWindow + WINDOW_MS - now;
		return {
			allowed: false,
			remaining: 0,
			retryAfterMs: Math.max(0, retryAfterMs)
		};
	}

	filtered.push(now);
	return {
		allowed: true,
		remaining: MAX_MESSAGES - filtered.length,
		retryAfterMs: 0
	};
}

/**
 * Rate limit verilerini temizle (bellek yönetimi)
 * Her 10 dakikada bir çağrılabilir
 */
export function cleanupRateLimits() {
	const now = Date.now();
	const cutoff = now - WINDOW_MS * 2;

	for (const [key, timestamps] of windows) {
		const filtered = timestamps.filter((t) => t > cutoff);
		if (filtered.length === 0) {
			windows.delete(key);
		} else {
			windows.set(key, filtered);
		}
	}
}

// Her 10 dakikada temizlik
setInterval(cleanupRateLimits, 10 * 60_000);
