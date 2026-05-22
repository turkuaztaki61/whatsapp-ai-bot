const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const sessions = {};

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
  const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Sayfa1!A:H",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          new Date().toLocaleString("tr-TR"),
          data.ad_soyad || "",
          data.telefon || "",
          data.sehir || "",
          data.adres || "",
          data.urun || "",
          data.olcu || "",
          data.not || "",
        ],
      ],
    },
  });
}

async function analyzeMessage(message, oldData) {
  const prompt = `
Sen bir kuyumcu WhatsApp sipariş asistanısın.

Görevin müşterinin mesajından sipariş bilgilerini çıkarmak.
Eski bilgiler varsa onları koru, yeni mesajdaki bilgilerle tamamla.

Kesinlikle açıklama yazma.
Sadece JSON döndür.

Eski bilgiler:
${JSON.stringify(oldData || {})}

Yeni müşteri mesajı:
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
- Müşteri adını söylediyse ad_soyad alanına yaz.
- Telefon numarasını yakala.
- Ürün alyans, bilezik, yüzük, kolye vb olabilir.
- Ölçü varsa olcu alanına yaz.
- Şehir/ilçe varsa sehir alanına yaz.
- Açık adres varsa adres alanına yaz.
- Eski bilgileri asla silme.
- Sipariş tamam sayılması için en az ad_soyad, telefon, ürün ve adres olmalı.
- Eksik olan tek şeyi eksik_bilgi alanına yaz.
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

  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== "text") return;

    const from = message.from;
    const text = message.text.body;

    if (!sessions[from]) {
      sessions[from] = {
        ad_soyad: "",
        telefon: "",
        sehir: "",
        adres: "",
        urun: "",
        olcu: "",
        not: "",
        saved: false,
      };
    }

    const analyzed = await analyzeMessage(text, sessions[from]);

    sessions[from] = {
      ...sessions[from],
      ...analyzed,
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
        `${data.ad_soyad}, sipariş bilgilerinizi aldım. En kısa sürede sizinle iletişime geçeceğiz.`
      );

      return;
    }

    if (data.saved) {
      await sendWhatsAppMessage(
        from,
        "Siparişiniz zaten kaydedildi. En kısa sürede sizinle iletişime geçeceğiz."
      );
      return;
    }

    let soru = "Siparişinizi tamamlamak için ";

    if (!data.ad_soyad) soru += "adınızı soyadınızı öğrenebilir miyim?";
    else if (!data.telefon) soru += "telefon numaranızı öğrenebilir miyim?";
    else if (!data.urun) soru += "almak istediğiniz ürünü öğrenebilir miyim?";
    else if (!data.adres) soru += "açık adresinizi öğrenebilir miyim?";
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
