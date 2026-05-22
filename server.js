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

const userOrders = {};

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
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body?.toLowerCase() || "";

    if (!userOrders[from]) {
      userOrders[from] = {
        step: null,
        data: {},
      };
    }

    const order = userOrders[from];

    // Sipariş başlat
    if (
      text.includes("sipariş") ||
      text.includes("satın almak") ||
      text.includes("almak istiyorum")
    ) {
      order.step = "name";

      await sendMessage(
        from,
        "Sipariş için ad soyadınızı yazar mısınız? 😊"
      );

      return res.sendStatus(200);
    }

    // Ad soyad
    if (order.step === "name") {
      order.data.name = text;
      order.step = "phone";

      await sendMessage(
        from,
        "Telefon numaranızı yazar mısınız? 📞"
      );

      return res.sendStatus(200);
    }

    // Telefon
    if (order.step === "phone") {
      order.data.phone = text;
      order.step = "city";

      await sendMessage(
        from,
        "Hangi şehirde yaşıyorsunuz? 🌍"
      );

      return res.sendStatus(200);
    }

    // Şehir
    if (order.step === "city") {
      order.data.city = text;
      order.step = "address";

      await sendMessage(
        from,
        "Açık adresinizi yazar mısınız? 📦"
      );

      return res.sendStatus(200);
    }

    // Adres
    if (order.step === "address") {
      order.data.address = text;
      order.step = "product";

      await sendMessage(
        from,
        "Hangi ürünü sipariş etmek istiyorsunuz? 🛍️"
      );

      return res.sendStatus(200);
    }

    // Ürün
    if (order.step === "product") {
      order.data.product = text;

      const summary = `
✅ Sipariş Alındı

👤 Ad Soyad: ${order.data.name}
📞 Telefon: ${order.data.phone}
🌍 Şehir: ${order.data.city}
📦 Adres: ${order.data.address}
🛍️ Ürün: ${order.data.product}

En kısa sürede sizinle iletişime geçeceğiz 😊
`;

      await sendMessage(from, summary);

      console.log("Yeni sipariş:", order.data);

      order.step = null;
      order.data = {};

      return res.sendStatus(200);
    }

    // Ürün link sistemi
    if (text.includes("link")) {
      await sendMessage(
        from,
        "Ürün linki:\nhttps://example.com/gold-burma-bilezik"
      );

      return res.sendStatus(200);
    }

    // AI cevap
    const aiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Sen Turkuaz Takı müşteri temsilcisisin. Kısa, samimi ve satış odaklı cevap ver.",
          },
          {
            role: "user",
            content: text,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply =
      aiResponse.data.choices[0].message.content;

    await sendMessage(from, reply);

    res.sendStatus(200);
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.sendStatus(500);
  }
});

async function sendMessage(to, body) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        body,
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

app.listen(PORT, () => {
  console.log("Server çalışıyor:", PORT);
});
