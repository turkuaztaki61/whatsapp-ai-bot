const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const userState = {};

app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body?.trim();

    if (!text) {
      return res.sendStatus(200);
    }

    // Küçük harfe çevir
    const lowerText = text.toLowerCase();

    // Kullanıcı state yoksa oluştur
    if (!userState[from]) {
      userState[from] = {
        siparisTamamlandi: false
      };
    }

    // İPTAL KOMUTU
    if (lowerText === "iptal") {
      userState[from] = {
        siparisTamamlandi: false
      };

      await sendWhatsAppMessage(
        from,
        "Siparişiniz iptal edildi. Yeni sipariş oluşturabilirsiniz."
      );

      return res.sendStatus(200);
    }

    // Daha önce sipariş verdiyse
    if (userState[from].siparisTamamlandi) {
      await sendWhatsAppMessage(
        from,
        "Siparişiniz zaten kaydedildi. En kısa sürede sizinle iletişime geçeceğiz."
      );

      return res.sendStatus(200);
    }

    // Bilgileri mesajdan çek
    const telefonMatch = text.match(/0\s?5\d{2}\s?\d{3}\s?\d{2}\s?\d{2}/);
    const olcuMatch = text.match(/ölçü\s?(\d+)/i);

    const telefon = telefonMatch ? telefonMatch[0] : "";
    const olcu = olcuMatch ? olcuMatch[1] : "";

    // Şehir tahmini
    let sehir = "";
    const sehirler = [
      "istanbul","ankara","izmir","trabzon","bursa","antalya",
      "konya","adana","samsun","ordu","rize"
    ];

    for (const s of sehirler) {
      if (lowerText.includes(s)) {
        sehir = s.charAt(0).toUpperCase() + s.slice(1);
        break;
      }
    }

    // Ad soyad tahmini
    let adSoyad = "";

    const benMatch = text.match(/ben\s+([a-zA-ZçğıöşüÇĞİÖŞÜ\s]+)/i);

    if (benMatch) {
      adSoyad = benMatch[1]
        .split("telefon")[0]
        .split("adres")[0]
        .split("ölçü")[0]
        .trim();
    }

    // Ürün tahmini
    let urun = "";

    if (lowerText.includes("alyans")) {
      urun = "alyans";
    }

    // Adres tahmini
    let adres = "";

    const adresMatch = text.match(/adres\s+(.+)/i);

    if (adresMatch) {
      adres = adresMatch[1].trim();
    }

    // Google Sheets'e gönder
    const siparisData = {
      tarih: new Date().toLocaleString("tr-TR"),
      ad_soyad: adSoyad,
      telefon,
      sehir,
      adres,
      urun,
      olcu,
      durum: "Yeni Sipariş",
      mesaj: text
    };

    console.log("Sheets gönderi verisi:", siparisData);

    try {
      const response = await axios.post(
        process.env.GOOGLE_SCRIPT_URL,
        siparisData
      );

      console.log("Sheets cevap:", response.data);
    } catch (err) {
      console.log("Sheets hata:", err.message);
    }

    userState[from].siparisTamamlandi = true;

    await sendWhatsAppMessage(
      from,
      `${adSoyad || "Müşteri"}, sipariş bilgilerinizi aldım. En kısa sürede sizinle iletişime geçeceğiz.`
    );

    res.sendStatus(200);

  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.send("Bot çalışıyor");
});

async function sendWhatsAppMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});
