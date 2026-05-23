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

const SITE_URL = "https://turkuaztaki.com/";

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const sessions = {};

let productCache = {
  updatedAt: 0,
  products: [],
};

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
      urun_linki: "",
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

function cleanText(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
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

async function getSiteProducts() {
  const now = Date.now();

  if (productCache.products.length && now - productCache.updatedAt < 1000 * 60 * 30) {
    return productCache.products;
  }

  try {
    const response = await axios.get(SITE_URL, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    const html = response.data;
    const products = [];

    const productRegex =
      /href="([^"]+)"[^>]*>\s*([^<]*TURKUAZ[^<]+)<\/a>[\s\S]{0,300}?₺\s?([\d.,]+)/gi;

    let match;

    while ((match = productRegex.exec(html)) !== null) {
      let link = match[1];
      const name = cleanText(match[2]);
      const price = `₺${match[3]}`;

      if (!link.startsWith("http")) {
        link = SITE_URL.replace(/\/$/, "") + "/" + link.replace(/^\//, "");
      }

      if (
        name &&
        price &&
        !products.some((p) => p.name === name)
      ) {
        products.push({
          name,
          price,
          link,
        });
      }
    }

    productCache = {
      updatedAt: now,
      products,
    };

    console.log("Ürün sayısı:", products.length);

    return products;
  } catch (error) {
    console.log("Site ürün çekme hatası:", error.message);
    return productCache.products || [];
  }
}

function searchProducts(products, text) {
  const q = text.toLowerCase();

  const keywords = [
    "bileklik",
    "bilezik",
    "yüzük",
    "yuzuk",
    "alyans",
    "kolye",
    "zincir",
    "küpe",
    "kupe",
    "kelepçe",
    "kelepce",
    "saat",
    "takım",
    "set",
  ];

  const foundKeyword = keywords.find((k) => q.includes(k));

  let results = products;

  if (foundKeyword) {
    results = products.filter((p) =>
      p.name.toLowerCase().includes(foundKeyword.replace("ü", "u")) ||
      p.name.toLowerCase().includes(foundKeyword)
    );
  }

  if (!results.length) {
    results = products.filter((p) =>
      q.split(" ").some((word) =>
        word.length > 3 && p.name.toLowerCase().includes(word)
      )
    );
  }

  return results.slice(0, 5);
}

function isProductQuestion(text) {
  const q = text.toLowerCase();

  return (
    q.includes("var mı") ||
    q.includes("model") ||
    q.includes("ürün") ||
    q.includes("urun") ||
    q.includes("fiyat") ||
    q.includes("kaç para") ||
    q.includes("ne kadar") ||
    q.includes("bileklik") ||
    q.includes("bilezik") ||
    q.includes("yüzük") ||
    q.includes("yuzuk") ||
    q.includes("alyans") ||
    q.includes("kolye") ||
    q.includes("küpe") ||
    q.includes("kupe")
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
    mesaj: `${lastMessage || ""} ${order.urun_linki || ""}`,
  };

  console.log("Sheets gönderi:", payload);

  const response = await axios.post(GOOGLE_SCRIPT_URL, payload, {
    headers: { "Content-Type": "application/json" },
  });

  console.log("Sheets cevap:", response.data);
}

async function aiReply(userText, session, productSuggestions) {
  const systemPrompt = `
Sen Turkuaz Takı için WhatsApp müşteri temsilcisisin.

Görevin:
- Doğal, kısa ve samimi konuş.
- Kalıp gibi konuşma.
- Aynı bilgiyi tekrar isteme.
- Sipariş için gerekli bilgiler: ad_soyad, telefon, urun, adres.
- Ölçü, şehir, ürün linki ve not varsa kaydet.
- Müşteri iptal, vazgeçtim, iptal et derse siparişi iptal et.
- Fiyat sorarsa sadece verilen site ürünlerinden fiyat söyle.
- Emin olmadığın fiyat için "net bilgi için ekibimiz dönüş yapacak" de.
- Müşteri ürün sorarsa aşağıdaki ürün önerilerini kullan.

Ürün önerileri:
${JSON.stringify(productSuggestions || [])}

Sadece JSON döndür.

JSON:
{
  "reply": "müşteriye gönderilecek cevap",
  "order": {
    "ad_soyad": "",
    "telefon": "",
    "sehir": "",
    "adres": "",
    "urun": "",
    "olcu": "",
    "not": "",
    "urun_linki": ""
  },
  "cancelled": false
}

Mevcut sipariş:
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
    }

    const activeSession = sessions[from];

    activeSession.messages.push({
      role: "user",
      content: text,
    });

    let productSuggestions = [];

    if (isProductQuestion(text)) {
      const products = await getSiteProducts();
      productSuggestions = searchProducts(products, text);
    }

    const ai = await aiReply(text, activeSession, productSuggestions);

    if (!ai || !ai.reply) {
      await sendWhatsAppMessage(
        from,
        "Mesajınızı aldım. Size yardımcı olayım, nasıl bir ürün arıyorsunuz?"
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
