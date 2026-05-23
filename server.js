const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

const userState = {};

async function sendWhatsAppMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: {
        body: text,
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

  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return;
    if (message.type !== "text") return;

    const from = message.from;
    const text = message.text.body.trim();
    const lowerText = text.toLowerCase();

    // Kullanıcı yoksa oluştur
    if (!userState[from]) {
      userState[from] = {
        siparisTamamlandi: false,
      };
    }

    // İPTAL KOMUTU
    if (
      lowerText === "iptal" ||
      lowerText.includes("iptal")
    ) {

      // Kullanıcının siparişini sil
      delete userState[from];

      await sendWhatsAppMessage(
        from,
        "Siparişiniz iptal edildi."
      );

      return;
    }

    // Önceki sipariş varsa
    if (userState[from].siparisTamamlandi) {
      await sendWhatsAppMessage(
        from,
        "Siparişiniz zaten kayıtlı."
      );

      return;
    }

    // Telefon
    const telefonMatch =
      text.match(/0\s?5\d{2}\s?\d{3}\s?\d{2}\s?\d{2}/);

    const telefon = telefonMatch
      ? telefonMatch[0]
      : "";

    // Ölçü
    const olcuMatch =
      text.match(/ölçü\s?(\d+)/i);

    const olcu = olcuMatch
      ? olcuMatch[1]
      : "";

    // Ürün
    let urun = "";

    if (lowerText.includes("alyans")) {
      urun = "Alyans";
    }

    // Ad Soyad
    let adSoyad = "";

    const benMatch =
      text.match(/ben\s+([a-zA-ZçğıöşüÇĞİÖŞÜ\s]+)/i);

    if (benMatch) {
      adSoyad = benMatch[1]
        .split("telefon")[0]
        .split("adres")[0]
        .split("ölçü")[0]
        .trim();
    }

    // Adres
    let adres = "";

    const adresMatch =
      text.match(/adres\s+(.+)/i);

    if (adresMatch) {
      adres = adresMatch[1].trim();
    }

    // Şehir
    let sehir = "";

    const sehirler = [
      "istanbul",
      "ankara",
      "izmir",
      "trabzon",
      "antalya",
      "bursa",
      "adana",
      "konya",
      "samsun",
      "ordu",
      "rize",
    ];

    for (const s of sehirler) {
      if (lowerText.includes(s)) {
        sehir =
          s.charAt(0).toUpperCase() +
          s.slice(1);

        break;
      }
    }

    // Sheets veri
    const siparisData = {
      tarih: new Date().toLocaleString("tr-TR"),
      ad_soyad: adSoyad,
      telefon,
      sehir,
      adres,
      urun,
      olcu,
      durum: "Yeni Sipariş",
      mesaj: text,
    };

    console.log(
      "Sheets gönderi:",
      siparisData
    );

    try {
      const response = await axios.post(
        GOOGLE_SCRIPT_URL,
        siparisData
      );

      console.log(
        "Sheets cevap:",
        response.data
      );
    } catch (err) {
      console.log(
        "Sheets hata:",
        err.message
      );
    }

    // Sipariş tamamlandı
    userState[from].siparisTamamlandi = true;

    await sendWhatsAppMessage(
      from,
      `${adSoyad || "Müşteri"}, sipariş bilgilerinizi aldım.`
    );

  } catch (error) {
    console.log(
      "Webhook hata:",
      error.message
    );
  }
});

app.listen(PORT, () => {
  console.log(
    `Server ${PORT} portunda çalışıyor`
  );
});
