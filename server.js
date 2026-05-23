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
    messages: [],
    order: {
      ad_soyad: "",
      telefon: "",
      sehir: "",
      adres: "",
      urun: "",
      olcu: "",
      not: "",
    },
    saved: false,
  };
}

function extractJson(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function sendWhatsAppMessage(to, message) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
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

async function saveToGoogleSheets(order, lastMessage) {
  const payload = {
    tarih: new Date().toLocaleString("tr-TR"),
    ad_soyad: order.ad_soyad || "",
    telefon: order.telefon || "",
    sehir: order.sehir || "",
    adres: order.adres || "",
    urun: order.urun || "",
    olcu: order.olcu || "",
    durum: "Yeni Sipariş",
    mesaj: lastMessage || "",
  };

  console.log("Sheets gönderi:", payload);

  const response = await axios.post(GOOGLE_SCRIPT_URL, payload, {
    headers: { "Content-Type": "application/json" },
  });

  console.log("Sheets cevap:", response.data);
}

async function aiReply(userText, session) {
  const systemPrompt = `
Sen Turkuaz Takı için WhatsApp müşteri temsilcisisin.

Görevin:
- Müşteriyle doğal, kısa ve samimi konuş.
- Kalıp gibi konuşma.
- Aynı soruyu tekrar tekrar sorma.
- Bildiğin bilgiyi tekrar isteme.
- Müşteri tek mesajda tüm bilgileri yazarsa direkt siparişi al.
- Sipariş için gerekli bilgiler: ad_soyad, telefon, urun, adres.
- Ölçü, şehir ve not varsa ayrıca kaydet.
- Müşteri iptal, vazgeçtim, iptal et derse siparişi iptal et.
- Müşteri sadece sohbet ederse normal cevap ver.
- Ürün sorarsa yardımcı ol.
- Fiyat konusunda kesin fiyat verme, "net fiyat için ekibimiz dönüş yapacak" de.

ÇOK ÖNEMLİ:
Sadece JSON döndür. Açıklama yazma.

JSON formatı:
{
  "reply": "müşteriye gönderilecek cevap",
  "order": {
    "ad_soyad": "",
    "telefon": "",
    "sehir": "",
    "adres": "",
    "urun": "",
    "olcu": "",
    "not": ""
  },
  "order_complete": false,
  "cancelled": false
}

Mevcut sipariş bilgisi:
${JSON.stringify(session.order)}

Konuşma geçmişi:
${JSON.stringify(session.messages.slice(-10))}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
  });

  return extractJson(response.choices[0].message.content);
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
      lower.includes("iptal") ||
      lower.includes("vazgeç")
    ) {
      sessions[from] = emptySession();

      await sendWhatsAppMessage(
        from,
        "Tamam, siparişinizi iptal ettim. Yeni sipariş vermek isterseniz buradayım."
      );

      return;
    }

    const session = sessions[from];

    if (session.saved) {
      sessions[from] = emptySession();
      sessions[from].messages.push({ role: "user", content: text });
    } else {
      session.messages.push({ role: "user", content: text });
    }

    const activeSession = sessions[from];
    const ai = await aiReply(text, activeSession);

    if (!ai || !ai.reply) {
      await sendWhatsAppMessage(
        from,
        "Mesajınızı aldım. Size yardımcı olayım, nasıl bir ürün istiyorsunuz?"
      );
      return;
    }

    if (ai.cancelled) {
      sessions[from] = emptySession();

      await sendWhatsAppMessage(
        from,
        "Tamam, siparişinizi iptal ettim. Yeni sipariş vermek isterseniz buradayım."
      );

      return;
    }

    activeSession.order = {
      ...activeSession.order,
      ...ai.order,
    };

    activeSession.messages.push({
      role: "assistant",
      content: ai.reply,
    });

    const complete =
      activeSession.order.ad_soyad &&
      activeSession.order.telefon &&
      activeSession.order.urun &&
      activeSession.order.adres;

    if (complete && !activeSession.saved) {
      await saveToGoogleSheets(activeSession.order, text);
      activeSession.saved = true;

      await sendWhatsAppMessage(
        from,
        `${activeSession.order.ad_soyad}, sipariş bilgilerinizi aldım. En kısa sürede sizinle iletişime geçeceğiz.`
      );

      return;
    }

    await sendWhatsAppMessage(from, ai.reply);
  } catch (error) {
    console.log("Webhook hata:", error.response?.data || error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});
