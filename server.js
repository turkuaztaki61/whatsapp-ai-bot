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

function resetCustomer(from) {
  customers[from] = {
    active: false,
    step: null,
    data: {},
  };
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

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body?.trim() || "";
    const lower = text.toLowerCase();

    if (!text) return res.sendStatus(200);

    if (!customers[from]) {
      resetCustomer(from);
    }

    const customer = customers[from];

    if (
      lower === "iptal" ||
      lower.includes("iptal ettim") ||
      lower.includes("vazgeçtim") ||
      lower.includes("vazgectim")
    ) {
      resetCustomer(from);

      await sendMessage(from, "Sipariş işlemi iptal edildi ✅");

      return res.sendStatus(200);
    }

    if (
      lower.includes("sipariş") ||
      lower.includes("siparis") ||
      lower.includes("satın almak") ||
      lower.includes("satin almak") ||
      lower.includes("almak istiyorum")
    ) {
      customer.active = true;

      if (!customer.step) {
        customer.step = "name";
      }

      await sendMessage(from, nextQuestion(customer.step));

      return res.sendStatus(200);
    }

    if (customer.active) {
      if (customer.step === "name") {
        customer.data.name = text;
        customer.step = "phone";

        await sendMessage(from, nextQuestion("phone"));
        return res.sendStatus(200);
      }

      if (customer.step === "phone") {
        customer.data.phone = text;
        customer.step = "city";

        await sendMessage(from, nextQuestion("city"));
        return res.sendStatus(200);
      }

      if (customer.step === "city") {
        customer.data.city = text;
        customer.step = "address";

        await sendMessage(from, nextQuestion("address"));
        return res.sendStatus(200);
      }

      if (customer.step === "address") {
        customer.data.address = text;
        customer.step = "product";

        await sendMessage(from, nextQuestion("product"));
        return res.sendStatus(200);
      }

      if (customer.step === "product") {
        customer.data.product = text;

        const customerMessage = `✅ Sipariş talebiniz alındı 😊

👤 Ad Soyad: ${customer.data.name}
📞 Telefon: ${customer.data.phone}
🌍 Şehir: ${customer.data.city}
📦 Adres: ${customer.data.address}
🛍️ Ürün: ${customer.data.product}

Ekibimiz sizinle en kısa sürede iletişime geçecek.`;

        const adminMessage = `🛒 Yeni Sipariş Talebi

👤 Ad Soyad: ${customer.data.name}
📞 Telefon: ${customer.data.phone}
🌍 Şehir: ${customer.data.city}
📦 Adres: ${customer.data.address}
🛍️ Ürün: ${customer.data.product}

Müşteri WhatsApp ID: ${from}`;

        await sendMessage(from, customerMessage);

        if (ADMIN_PHONE) {
          await sendMessage(ADMIN_PHONE, adminMessage);
        }

        resetCustomer(from);

        return res.sendStatus(200);
      }
    }

    if (lower.includes("link")) {
      await sendMessage(
        from,
        "Ürün linki:\nhttps://example.com/gold-burma-bilezik"
      );

      return res.sendStatus(200);
    }

    if (lower.includes("foto") || lower.includes("resim")) {
      await sendMessage(
        from,
        "Ürün fotoğrafı:\nhttps://via.placeholder.com/600"
      );

      return res.sendStatus(200);
    }

    const aiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Sen TURKUAZ TAKI'nın WhatsApp müşteri temsilcisisin. Yapay zeka olduğunu söyleme. Kısa, samimi ve satış odaklı cevap ver. Sipariş isteyen müşteriye isim, telefon, şehir, adres ve ürün bilgilerini iste.",
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

    const reply = aiResponse.data.choices[0].message.content;

    await sendMessage(from, reply);

    res.sendStatus(200);
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.sendStatus(200);
  }
});

function nextQuestion(step) {
  if (step === "name") return "Sipariş için ad soyadınızı yazar mısınız? 😊";
  if (step === "phone") return "Telefon numaranızı yazar mısınız? 📞";
  if (step === "city") return "Hangi şehirde yaşıyorsunuz? 🌍";
  if (step === "address") return "Açık adresinizi yazar mısınız? 📦";
  if (step === "product") return "Hangi ürünü sipariş etmek istiyorsunuz? 🛍️";
  return "Nasıl yardımcı olabiliriz? 😊";
}

app.listen(PORT, () => {
  console.log("Server çalışıyor:", PORT);
});
