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

function nextQuestion(step) {
  if (step === "name") {
    return "Ad soyadınızı yazar mısınız? 😊";
  }

  if (step === "phone") {
    return "Telefon numaranızı yazar mısınız? 📞";
  }

  if (step === "city") {
    return "Hangi şehirde yaşıyorsunuz? 🌍";
  }

  if (step === "address") {
    return "Açık adresinizi yazar mısınız? 📦";
  }

  if (step === "product") {
    return "Hangi ürünü sipariş etmek istiyorsunuz? 🛍️";
  }

  return "Nasıl yardımcı olabilirim?";
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
      resetCustomer(from);
    }

    const customer = customers[from];

    // İPTAL
    if (
      lower === "iptal" ||
      lower.includes("iptal ettim") ||
      lower.includes("vazgeçtim") ||
      lower.includes("vazgectim")
    ) {
      resetCustomer(from);

      await sendMessage(
        from,
        "Sipariş işlemi iptal edildi ✅"
      );

      return res.sendStatus(200);
    }

    // SİPARİŞ BAŞLAT
    if (
      lower.includes("sipariş") ||
      lower.includes("siparis") ||
      lower.includes("satın almak") ||
      lower.includes("almak istiyorum")
    ) {
      if (!customer.active) {
        customer.active = true;
        customer.step = "name";

        await sendMessage(from, nextQuestion("name"));
      } else {
        await sendMessage(
          from,
          "Sipariş işleminiz devam ediyor 😊"
        );
      }

      return res.sendStatus(200);
    }

    // AKTİF SİPARİŞ AKIŞI
    if (customer.active) {

      // İSİM
      if (customer.step === "name") {
        customer.data.name = text;
        customer.step = "phone";

        await sendMessage(from, nextQuestion("phone"));
        return res.sendStatus(200);
      }

      // TELEFON
      if (customer.step === "phone") {
        customer.data.phone = text;
        customer.step = "city";

        await sendMessage(from, nextQuestion("city"));
        return res.sendStatus(200);
      }

      // ŞEHİR
      if (customer.step === "city") {
        customer.data.city = text;
        customer.step = "address";

        await sendMessage(from, nextQuestion("address"));
        return res.sendStatus(200);
      }

      // ADRES
      if (customer.step === "address") {
        customer.data.address = text;
        customer.step = "product";

        await sendMessage(from, nextQuestion("product"));
        return res.sendStatus(200);
      }

      // ÜRÜN
      if (customer.step === "product") {
        customer.data.product = text;

        const customerText = `
✅ Siparişiniz alınmıştır.

👤 ${customer.data.name}
📞 ${customer.data.phone}
🌍 ${customer.data.city}
📦 ${customer.data.address}
🛍️ ${customer.data.product}

Ekibimiz en kısa sürede sizinle iletişime geçecektir 😊
`;

        const adminText = `
🛒 Yeni Sipariş

👤 ${customer.data.name}
📞 ${customer.data.phone}
🌍 ${customer.data.city}
📦 ${customer.data.address}
🛍️ ${customer.data.product}
`;

        await sendMessage(from, customerText);

        if (ADMIN_PHONE) {
          await sendMessage(ADMIN_PHONE, adminText);
        }

        resetCustomer(from);

        return res.sendStatus(200);
      }
    }

    // LİNK
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

    // NORMAL MESAJ
    await sendMessage(
      from,
      "Merhaba 😊 Size nasıl yardımcı olabilirim?"
    );

    res.sendStatus(200);

  } catch (error) {
    console.log(error.response?.data || error.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log("Server çalışıyor:", PORT);
});
