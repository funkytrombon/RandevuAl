/**
 * Komut algılama ve yönlendirme
 * Desteklenen komutlar: STOP, SİL, DEVAM
 * Çoklu dil desteği (tr, en)
 */

const COMMAND_PATTERNS = {
	STOP: [
		/^stop$/i,
		/^dur$/i,
		/^durdur$/i,
		/^iptal$/i,
		/^çık$/i,
		/^bırak$/i,
		/^mesaj\s*atma$/i
	],
	DELETE: [
		/^sil$/i,
		/^verilerimi\s*sil$/i,
		/^delete$/i,
		/^delete[_\s]?data$/i,
		/^veri\s*silme$/i
	],
	RESUME: [
		/^devam$/i,
		/^devam\s*et$/i,
		/^başla$/i,
		/^resume$/i,
		/^start$/i
	]
};

const RESPONSES = {
	STOP: "✋ Mesajlarımızı durdurduk. Tekrar başlatmak istediğinizde \"DEVAM\" yazabilirsiniz.\n\nNot: Bu işlem sadece otomatik mesajları durdurur.",
	DELETE: "🗑️ Verileriniz silindi. Tüm konuşma geçmişiniz ve kişisel bilgileriniz kaldırıldı.\n\nTekrar hizmet almak için herhangi bir mesaj gönderebilirsiniz.",
	RESUME: "👋 Tekrar hoş geldiniz! Size nasıl yardımcı olabilirim?\n\n📋 Randevu almak\n❓ Soru sormak\n👤 Temsilciye bağlanmak",
	RATE_LIMITED: "⏳ Çok fazla mesaj gönderdiniz. Lütfen bir dakika bekleyip tekrar deneyin.",
	USAGE_EXCEEDED: "📊 Bu ay için mesaj limitinize ulaştınız. Planınızı yükseltmek için bizimle iletişime geçin."
};

/**
 * Mesaj metninden komut algıla
 * @param {string} text - Kullanıcı mesajı
 * @returns {{ command: string|null, response: string|null }}
 */
export function detectCommand(text) {
	const trimmed = (text || "").trim();

	for (const [command, patterns] of Object.entries(COMMAND_PATTERNS)) {
		if (patterns.some((p) => p.test(trimmed))) {
			return { command, response: RESPONSES[command] };
		}
	}

	return { command: null, response: null };
}

/**
 * Hazır yanıt mesajı al
 * @param {string} key - Yanıt anahtarı
 * @returns {string}
 */
export function getResponse(key) {
	return RESPONSES[key] || "";
}
