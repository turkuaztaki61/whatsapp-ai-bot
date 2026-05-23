const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const sessions = {};

function emptySession() {
  return {
    ad_soyad: "",
    telefon: "",
    sehir: "",
    adres: "",
    urun: "",
    olcu: "",
    not: "",
    mesaj: "",
    saved: false,
  };
}

function temizleJson(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}

async function sendWhatsAppMessage(to, message) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function saveToGoogleSheets(data) {
  const payload = {
    tarih: new Date().toLocaleString("tr-TR"),
    ad_soyad: data.ad_soyad || "",
    telefon: data.telefon || "",
    sehir: data.sehir || "",
    adres: data.adres || "",
    urun: data.urun || "",
    olcu: data.olcu || "",
    durum: "Yeni Sipariş",
    mesaj: data.mesaj || "",
  };

  console.log("Sheets giden veri:", payload);

  const response = await axios.post(GOOGLE_SCRIPT_URL, payload, {
    headers: { "Content-Type": "application/json" },
  });

  console.log("Sheets cevap:", response.data);
}

async function analyzeMessage(message, oldData) {
  const prompt = `
Sen bir kuyumcu WhatsApp sipariş asistanısın.

Müşteri mesajından sipariş bilgilerini çıkar.
Eski bilgileri koru, yeni mesajdaki bilgilerle tamamla.
Sadece JSON döndür.

Eski bilgiler:
${JSON.stringify(oldData || {})}

Yeni mesaj:
${message}

JSON formatı:
{
  "ad_soyad": "",
  "telefon": "",
  "sehir": "",
  "adres": "",
  "urun": "",
  "olcu": "",
  "not": "",
  "siparis_tamam": false,
  "eksik_bilgi": ""
}

Kurallar:
- Eski bilgileri asla silme.
- Sipariş tamam olması için ad_soyad, telefon, urun ve adres dolu olmalı.
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
  });

  return temizleJson(response.choices[0].message.content);
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== "text") return;

    const from = message.from;
    const text = message.text.body.trim();
    const lower = text.toLowerCase();

    if (!sessions[from]) {
      sessions[from] = emptySession();
    }

    if (
      lower === "iptal" ||
      lower.includes("iptal et") ||
      lower.includes("vazgeçtim") ||
      lower.includes("vazgeç")
    ) {
      sessions[from] = emptySession();

      await sendWhatsAppMessage(
        from,
        "Siparişiniz iptal edildi. Yeni sipariş vermek isterseniz bilgileri tekrar yazabilirsiniz."
      );
      return;
    }

    if (
      lower.includes("yeni sipariş") ||
      lower.includes("yeni siparis") ||
      lower.includes("baştan") ||
      lower.includes("bastan")
    ) {
      sessions[from] = emptySession();

      await sendWhatsAppMessage(
        from,
        "Yeni sipariş için bilgilerinizi alabilirim. Ürün, telefon ve adres bilgilerinizi yazabilirsiniz."
      );
      return;
    }

    if (sessions[from].saved) {
      sessions[from] = emptySession();
    }

    const analyzed = await analyzeMessage(text, sessions[from]);

    sessions[from] = {
      ...sessions[from],
      ...analyzed,
      mesaj: text,
    };

    const data = sessions[from];

    const tamam = data.ad_soyad && data.telefon && data.urun && data.adres;

    if (tamam && !data.saved) {
      await saveToGoogleSheets(data);
      sessions[from].saved = true;

      await sendWhatsAppMessage(
        from,
        `${data.ad_soyad}, sipariş bilgilerinizi aldım. En kısa sürede sizinle iletişime geçeceğiz.`
      );
      return;
    }

    let soru = "";

    if (!data.ad_soyad) soru = "Adınızı soyadınızı öğrenebilir miyim?";
    else if (!data.telefon) soru = "Telefon numaranızı öğrenebilir miyim?";
    else if (!data.urun) soru = "Almak istediğiniz ürünü öğrenebilir miyim?";
    else if (!data.adres) soru = "Açık adresinizi öğrenebilir miyim?";
    else soru = "Eksik bilgileri paylaşabilir misiniz?";

    await sendWhatsAppMessage(from, soru);
  } catch (error) {
    console.error("Webhook hata:", error.response?.data || error.message);
  }
});

app.get("/", (req, res) => {
  res.send("WhatsApp bot çalışıyor.");
});

app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});
