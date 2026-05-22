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

    if (!msg) {
      return res.sendStatus(200);
    }

    const from = msg.from;
    const text = msg.text?.body?.trim() || "";
    const lower = text.toLocaleLowerCase("tr-TR");

    // İPTAL
    if (
      lower.includes("iptal") ||
      lower.includes("vazgeç") ||
      lower.includes("vazgec")
    ) {
      await sendMessage(
        from,
        "Sipariş işlemi iptal edildi ✅"
      );

      return res.sendStatus(200);
    }

    // LİNK
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

    // FOTO
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

    // OPENAI
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
- Kısa konuş
- Samimi ol
- Emoji kullan
- Yapay zeka olduğunu söyleme
- Gereksiz uzun yazma
- Aynı soruyu tekrar sorma
- Sipariş iptal edilirse anlayıp işlemi sıfırla
- Müşteri tek mesajda tüm bilgileri verebilir

Toplanacak bilgiler:
- ad soyad
- telefon
- şehir
- adres
- ürün

Tüm bilgiler tamamlandıysa müşteriye şu formatta cevap ver:

✅ Siparişiniz alınmıştır

👤 Ad Soyad:
📞 Telefon:
🌍 Şehir:
📦 Adres:
🛍️ Ürün:

"Sizinle kısa sürede iletişime geçeceğiz 😊"

Eğer bilgiler eksikse SADECE eksik olanı sor.

Örnek:
- Telefon eksikse sadece telefon iste
- Adres eksikse sadece adres iste

ASLA aynı bilgiyi tekrar isteme.
`,
          },
          {
            role: "user",
            content: text,
          },
        ],
        temperature: 0.4,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply =
      ai.data.choices[0].message.content;

    await sendMessage(from, reply);

    // ADMİNE GÖNDER
    if (
      reply.includes("✅ Siparişiniz alınmıştır")
    ) {
      if (ADMIN_PHONE) {
        await sendMessage(
          ADMIN_PHONE,
          `🛒 Yeni Sipariş:\n\n${reply}`
        );
      }
    }

    return res.sendStatus(200);

  } catch (error) {
    console.log(
      error.response?.data || error.message
    );

    return res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log("Server çalışıyor:", PORT);
});
