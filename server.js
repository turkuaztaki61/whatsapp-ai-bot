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

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

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
      text: {
        body: message,
      },
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

  console.log("Sheets veri:", payload);

  const response = await axios.post(
    GOOGLE_SCRIPT_URL,
    payload,
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  console.log("Sheets cevap:", response.data);
}

async function analyzeMessage(message, oldData) {
  const prompt = `
Sen bir kuyumcu sipariş botusun.

Müşteri mesajından bilgileri çıkar.
Eski bilgileri koru.
Sadece JSON döndür.

Eski bilgiler:
${JSON.stringify(oldData)}

Yeni mesaj:
${message}

JSON:
{
  "ad_soyad": "",
  "telefon": "",
  "sehir": "",
  "adres": "",
  "urun": "",
  "olcu": ""
}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0,
  });

  return temizleJson(response.choices[0].message.content);
}

app.get("/", (req, res) => {
  res.send("Bot çalışıyor");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return;
    if (message.type !== "text") return;

    const from = message.from;
    const text = message.text.body.trim();
    const lower = text.toLowerCase();

    if (!sessions[from]) {
      sessions[from] = emptySession();
    }

    // İPTAL
    if (
      lower === "iptal" ||
      lower.includes("iptal et") ||
      lower.includes("vazgeç") ||
      lower.includes("vazgeçtim")
    ) {
      sessions[from] = emptySession();

      await sendWhatsAppMessage(
        from,
        "Siparişiniz iptal edildi."
      );

      return;
    }

    // YENİ SİPARİŞ
    if (
      lower.includes("yeni sipariş") ||
      lower.includes("yeni siparis")
    ) {
      sessions[from] = emptySession();

      await sendWhatsAppMessage(
        from,
        "Yeni sipariş oluşturabilirsiniz."
      );

      return;
    }

    // Eğer eski sipariş kaydedildiyse sıfırla
    if (sessions[from].saved) {
      sessions[from] = emptySession();
    }

    const analyzed = await analyzeMessage(
      text,
      sessions[from]
    );

    sessions[from] = {
      ...sessions[from],
      ...analyzed,
      mesaj: text,
    };

    const data = sessions[from];

    const tamam =
      data.ad_soyad &&
      data.telefon &&
      data.urun &&
      data.adres;

    if (tamam && !data.saved) {
      await saveToGoogleSheets(data);

      sessions[from].saved = true;

      await sendWhatsAppMessage(
        from,
        `${data.ad_soyad}, siparişiniz kaydedildi.`
      );

      return;
    }

    // Eksik bilgi sor
    if (!data.ad_soyad) {
      await sendWhatsAppMessage(
        from,
        "Ad soyadınızı yazabilir misiniz?"
      );
      return;
    }

    if (!data.telefon) {
      await sendWhatsAppMessage(
        from,
        "Telefon numaranızı yazabilir misiniz?"
      );
      return;
    }

    if (!data.urun) {
      await sendWhatsAppMessage(
        from,
        "Hangi ürünü istiyorsunuz?"
      );
      return;
    }

    if (!data.adres) {
      await sendWhatsAppMessage(
        from,
        "Adresinizi yazabilir misiniz?"
      );
      return;
    }

  } catch (error) {
    console.error(
      "Webhook hata:",
      error.response?.data || error.message
    );
  }
});

app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});
