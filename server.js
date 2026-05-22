import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_PHONE = process.env.ADMIN_PHONE;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

async function sendMessage(to, body) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function saveOrderToSheet(order) {
  if (!GOOGLE_SCRIPT_URL) return;

  await axios.post(GOOGLE_SCRIPT_URL, {
    ad_soyad: order.ad_soyad,
    telefon: order.telefon,
    sehir: order.sehir,
    adres: order.adres,
    urun: order.urun,
  });
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body?.trim() || "";
    const lower = text.toLocaleLowerCase("tr-TR");

    if (
      lower.includes("iptal") ||
      lower.includes("vazgeç") ||
      lower.includes("vazgec")
    ) {
      await sendMessage(from, "Sipariş işlemi iptal edildi ✅");
      return res.sendStatus(200);
    }

    if (
      lower === "link" ||
      lower === "ürün linki" ||
      lower === "urun linki"
    ) {
      await sendMessage(
        from,
        "Ürün linki:\nhttps://example.com/gold-burma-bilezik"
      );
      return res.sendStatus(200);
    }

    if (
      lower === "foto" ||
      lower === "fotoğraf" ||
      lower === "fotograf" ||
      lower === "resim"
    ) {
      await sendMessage(
        from,
        "Ürün fotoğrafı:\nhttps://via.placeholder.com/600"
      );
      return res.sendStatus(200);
    }

    const ai = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Sen TURKUAZ TAKI'nın profesyonel WhatsApp satış temsilcisisin.

Kurallar:
- Kısa konuş.
- Samimi ol.
- Yapay zeka olduğunu söyleme.
- Aynı soruyu tekrar sorma.
- Müşteri tek mesajda tüm sipariş bilgilerini verebilir.
- Eksik bilgi varsa sadece eksik olanı sor.

Toplanacak bilgiler:
- ad_soyad
- telefon
- sehir
- adres
- urun

Tüm bilgiler tamamlandıysa SADECE şu formatta JSON döndür:

{
  "siparis_tamam": true,
  "ad_soyad": "",
  "telefon": "",
  "sehir": "",
  "adres": "",
  "urun": ""
}

Bilgiler eksikse müşteriye kısa cevap ver.
JSON dışında hiçbir şey yazma sadece sipariş tamamlandıysa JSON yaz.
`,
          },
          {
            role: "user",
            content: text,
          },
        ],
        temperature: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply = ai.data.choices[0].message.content.trim();

    if (reply.startsWith("{")) {
      const order = JSON.parse(reply);

      if (order.siparis_tamam) {
        const customerText = `✅ Siparişiniz alınmıştır

👤 Ad Soyad: ${order.ad_soyad}
📞 Telefon: ${order.telefon}
🌍 Şehir: ${order.sehir}
📦 Adres: ${order.adres}
🛍️ Ürün: ${order.urun}

Sizinle kısa sürede iletişime geçeceğiz 😊`;

        const adminText = `🛒 Yeni Sipariş

👤 Ad Soyad: ${order.ad_soyad}
📞 Telefon: ${order.telefon}
🌍 Şehir: ${order.sehir}
📦 Adres: ${order.adres}
🛍️ Ürün: ${order.urun}`;

        await sendMessage(from, customerText);

        if (ADMIN_PHONE) {
          await sendMessage(ADMIN_PHONE, adminText);
        }

        await saveOrderToSheet(order);

        return res.sendStatus(200);
      }
    }

    await sendMessage(from, reply);

    return res.sendStatus(200);
  } catch (error) {
    console.log(error.response?.data || error.message);
    return res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log("Server çalışıyor:", PORT);
});
