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

const orders = {};

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

function resetOrder(from) {
  orders[from] = {
    step: "idle",
    name: "",
    phone: "",
    city: "",
    address: "",
    product: "",
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
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body?.trim() || "";
    const lower = text.toLocaleLowerCase("tr-TR");

    if (!orders[from]) resetOrder(from);

    if (
      lower.includes("iptal") ||
      lower.includes("vazgeç") ||
      lower.includes("vazgec") ||
      lower.includes("sıfırla") ||
      lower.includes("sifirla")
    ) {
      resetOrder(from);
      await sendMessage(from, "Sipariş işlemi iptal edildi ✅");
      return res.sendStatus(200);
    }

    if (
      lower.includes("sipariş") ||
      lower.includes("siparis") ||
      lower.includes("satın") ||
      lower.includes("satin") ||
      lower.includes("almak istiyorum")
    ) {
      resetOrder(from);
      orders[from].step = "name";
      await sendMessage(from, "Ad soyadınızı yazar mısınız? 😊");
      return res.sendStatus(200);
    }

    const order = orders[from];

    if (order.step === "name") {
      order.name = text;
      order.step = "phone";
      await sendMessage(from, "Telefon numaranızı yazar mısınız? 📞");
      return res.sendStatus(200);
    }

    if (order.step === "phone") {
      order.phone = text;
      order.step = "city";
      await sendMessage(from, "Hangi şehirde yaşıyorsunuz? 🌍");
      return res.sendStatus(200);
    }

    if (order.step === "city") {
      order.city = text;
      order.step = "address";
      await sendMessage(from, "Açık adresinizi yazar mısınız? 📦");
      return res.sendStatus(200);
    }

    if (order.step === "address") {
      order.address = text;
      order.step = "product";
      await sendMessage(from, "Hangi ürünü sipariş etmek istiyorsunuz? 🛍️");
      return res.sendStatus(200);
    }

    if (order.step === "product") {
      order.product = text;

      const customerText = `✅ Sipariş talebiniz alındı 😊

👤 ${order.name}
📞 ${order.phone}
🌍 ${order.city}
📦 ${order.address}
🛍️ ${order.product}

Ekibimiz sizinle en kısa sürede iletişime geçecek.`;

      const adminText = `🛒 Yeni Sipariş Talebi

👤 ${order.name}
📞 ${order.phone}
🌍 ${order.city}
📦 ${order.address}
🛍️ ${order.product}`;

      await sendMessage(from, customerText);

      if (ADMIN_PHONE) {
        await sendMessage(ADMIN_PHONE, adminText);
      }

      resetOrder(from);
      return res.sendStatus(200);
    }

    await sendMessage(
      from,
      "Merhaba 😊 Sipariş vermek için “sipariş vermek istiyorum” yazabilirsiniz."
    );

    return res.sendStatus(200);
  } catch (error) {
    console.log(error.response?.data || error.message);
    return res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log("Server çalışıyor:", PORT);
});
