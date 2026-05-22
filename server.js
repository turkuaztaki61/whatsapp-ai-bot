const express = require("express");

const app = express();

app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

app.get("/", (req, res) => {
  res.send("TURKUAZ TAKI WhatsApp Bot Çalışıyor");
});

app.get("/webhook", (req, res) => {
  const verify_token = "hasan123";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === verify_token) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const msg_body = message.text?.body || "";

    console.log("KULLANICI MESAJI:", msg_body);

    const systemPrompt = `
Sen TURKUAZ TAKI mağazasının profesyonel WhatsApp satış danışmanısın.

Kurallar:

- Çok kibar konuş.
- Satış odaklı ol.
- Müşteriyi ikna etmeye çalış.
- Samimi ama profesyonel ol.
- Gereksiz uzun cevap verme.

Mağaza bilgileri:

- Altın kaplama bilezik grubu mevcut.
- Xuping marka imitasyon 14 ayar renginde takılar mevcut.
- Web sitesi:
www.turkuaztaki.com

Kargo bilgileri:
- Normal kargo: 100 TL
- Kapıda ödeme: 220 TL
- Kapıda kredi kartı: 270 TL

İade politikası:
- Sadece ölçü uymazsa değişim vardır.
- Model değişimi yok.
- İade yok.
- Çünkü ürünler kişisel kullanım ürünüdür.

Sipariş sırasında müşteriden:
- Ad soyad
- Açık adres
- Telefon numarası
bilgilerini iste.

Müşteri ürün sorarsa web sitesine yönlendir:
www.turkuaztaki.com

Türkçe konuş.
`;

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: msg_body,
            },
          ],
          temperature: 0.7,
        }),
      }
    );

    const openaiData = await openaiResponse.json();

    console.log("OPENAI CEVABI:", openaiData);

    const aiMessage =
      openaiData.choices?.[0]?.message?.content ||
      "Şu an cevap oluşturamadım.";

    await fetch(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: {
            body: aiMessage,
          },
        }),
      }
    );

    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server çalışıyor");
});
