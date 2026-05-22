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

const customers = {};

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
    const text = message.text?.body?.trim() || "";
    const lower = text.toLowerCase();

    if (!customers[from]) {
      customers[from] = {
        active: false,
        step: null,
        data: {},
      };
    }

    const customer = customers[from];

    // İPTAL
    if (lower.includes("iptal")) {
      customers[from] = {
        active: false,
        step: null,
        data: {},
      };

      await sendMessage(
        from,
        "Sipariş işlemi iptal edildi ✅"
      );

      return res.sendStatus(200);
    }

    // SİPARİŞ BAŞLAT
    if (
      lower.includes("sipariş") ||
      lower.includes("satın almak") ||
      lower.includes("almak istiyorum")
    ) {
      customer.active = true;
      customer.step = "name";
      customer.data = {};

      await sendMessage(
        from,
        "Sipariş için ad soyadınızı yazar mısınız? 😊"
      );

      return res.sendStatus(200);
    }

    // AKTİF SİPARİŞ
    if (customer.active) {

      // AD
      if (customer.step === "name") {
        customer.data.name = text;
        customer.step = "phone";

        await sendMessage(
          from,
          "Telefon numaranızı yazar mısınız? 📞"
        );

        return res.sendStatus(200);
      }

      // TELEFON
      if (customer.step === "phone") {
        customer.data.phone = text;
        customer.step = "city";

        await sendMessage(
          from,
          "Hangi şehirde yaşıyorsunuz? 🌍"
        );

        return res.sendStatus(200);
      }

      // ŞEHİR
      if (customer.step === "city") {
        customer.data.city = text;
        customer.step = "address";

        await sendMessage(
          from,
          "Açık adresinizi yazar mısınız? 📦"
        );

        return res.sendStatus(200);
      }

      // ADRES
      if (customer.step === "address") {
        customer.data.address = text;
        customer.step = "product";

        await sendMessage(
          from,
          "Hangi ürünü sipariş etmek istiyorsunuz? 🛍️"
        );

        return res.sendStatus(200);
      }

      // ÜRÜN
      if (customer.step === "product") {
        customer.data.product = text;

        const customerMessage = `✅ Sipariş talebiniz alındı 😊

👤 ${customer.data.name}
📞 ${customer.data.phone}
🌍 ${customer.data.city}
📦 ${customer.data.address}
🛍️ ${customer.data.product}

En kısa sürede sizinle iletişime geçeceğiz.`;

        await sendMessage(from, customerMessage);

        const adminMessage = `🛒 Yeni Sipariş

👤 ${customer.data.name}
📞 ${customer.data.phone}
🌍 ${customer.data.city}
📦 ${customer.data.address}
🛍️ ${customer.data.product}`;

        if (ADMIN_PHONE) {
          await sendMessage(
            ADMIN_PHONE,
            adminMessage
          );
        }

        customers[from] = {
          active: false,
          step: null,
          data: {},
        };

        return res.sendStatus(200);
      }
    }

    // ÜRÜN LİNKİ
    if (lower.includes("link")) {
      await sendMessage(
        from,
        "Ürün linki:\nhttps://example.com/gold-burma-bilezik"
      );

      return res.sendStatus(200);
    }

    // FOTO
    if (
      lower.includes("foto") ||
      lower.includes("resim")
    ) {
      await sendMessage(
        from,
        "Ürün fotoğrafı:\nhttps://via.placeholder.com/600"
      );

      return res.sendStatus(200);
    }

    // AI CEVAP
    const aiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Sen Turkuaz Takı müşteri temsilcisisin. Samimi, kısa ve satış odaklı konuş.",
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

app.listen(PORT, () => {
  console.log("Server çalışıyor:", PORT);
});
