import express from "express";
import OpenAI from "openai";
import { verifyClientAuth } from "./authRoutes.js";

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Müşterinin sektörüyle ilgili sorular sorma rotası
router.post("/api/onboarding/chat", verifyClientAuth, async (req, res) => {
	try {
        const { messages, sector } = req.body;
        
        const systemPrompt = `
Sen "RandevuAl" platformunun ileri düzey kurulum danışmanısın. Görevin, işletme sahibine (sektör: ${sector}) akıllı sorular sorarak botu eğitmek için gerekli bilgileri toplamaktır.

SADECE ŞU JSON FORMATINDA YANIT VER:
{
  "reply": "Kullanıcıya söyleyeceğin mesaj (Soru, onay veya yönlendirme)",
  "suggestions": ["Müşterinin seçebileceği 1. kısa yanıt önerisi", "2. öneri", "3. öneri"],
  "is_complete": false
}

STRATEJİ:
1. Sektöre özgü derinlemesine sorular sor. Eğer sağlık sektörü ise "Randevu iptal politikanız nedir?", güzellik ise "Hangi markalarla çalışıyorsunuz?" gibi detaya in.
2. Her seferinde tam olarak 3 adet "suggestions" (öneri) sun. Bu öneriler, kullanıcının o anki soruya verebileceği muhtemel kısa cevaplar veya bir sonraki konuya geçiş teklifleri olmalı.
3. Nazik ve enerjik ol. "Müşteri yeterli" diyene kadar mülakatı sürdür.
`;
        
        const response = await openai.chat.completions.create({
			model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                ...(messages || [])
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
		});

        const output = JSON.parse(response.choices[0].message.content);
        res.json(output);
    } catch (e) {
        console.error("Onboarding Chat Error:", e);
        res.status(500).json({ error: "Yapay zeka asistanı yanıt veremedi." });
    }
});

// Sohbet bittiğinde sohbet geçmişini JSON'a (Form Datasına) dönüştürme rotası
router.post("/api/onboarding/generate", verifyClientAuth, async (req, res) => {
	try {
        const { messages, sector } = req.body;
        // Müşteri ile asistan arasındaki tüm sohbet geçmişi var.

        const systemPrompt = `
Kullanıcının asistanla yaptığı sohbet geçmişini oku. Amacın, sohbetten işletmeye ait bilgileri süzerek bir WhatsApp botu ayar JSON'u üretmektir.
SADECE GEÇERLİ JSON DÖNDÜR, başına sonuna markdown ekleme.

{
  "ai_personality": "Botun müşteriye nasıl hitap edeceği (Örn: 'Sen güler yüzlü bir asistanısın, kısa cevaplar ver, resmi ol')",
  "services": "Sohbette geçen verilen hizmetlerin kısa virgülle ayrılmış bir özeti (Örn: 'Saç Kesimi, Fön, Manikür')",
  "faq_text": "Sohbette geçen adres, saatler, otopark, iptal politikası, fiyatlar gibi genel bilgileri liste formatında derlenmiş hali. Okunabilir ve temiz olmalı."
}

Eğer bilgilerin bazıları sohbette hiç geçmemişse, mantıklı genel varsayımlar yap veya boş bırak.
`;

        const response = await openai.chat.completions.create({
			model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                ...(messages || []) // Müşterinin ve asistanın diyalogu
            ],
            temperature: 0.2,
		});

        let jsonText = response.choices[0].message.content.trim();
        // Temizlik (Bazen JSON markdown backtickleri arasında gelir: ```json ... ```)
        if (jsonText.startsWith(`\`\`\`json`)) {
			jsonText = jsonText.replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
		}

        const data = JSON.parse(jsonText);
        res.json(data);
    } catch (e) {
        console.error("Onboarding Generate Error:", e);
        res.status(500).json({ error: "Sohbetten veri çıkarılırken hata oluştu." });
    }
});

export default router;
