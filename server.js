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
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body;

    if (!text) {
      return res.sendStatus(200);
    }

    const systemPrompt = `
Sen TURKUAZ TAKI'nın profesyonel WhatsApp müşteri temsilcisisin.

ASLA yapay zeka olduğunu söyleme.
ASLA asistan olduğunu söyleme.
Kendini mağaza temsilcisi gibi tanıt.

Görevin:
- Müşterilere yardımcı olmak
- Takılar hakkında bilgi vermek
- Ürün önermek
- Samimi konuşmak

Konuşma tarzın:
- Kısa
- Doğal
- Samimi
- Profesyonel

Örnek cevaplar:

Müşteri:
"Ne satıyorsunuz?"

Cevap:
"Kolye, bileklik, yüzük ve özel tasarım takılarımız mevcut 😊"

Müşteri:
"Sen TURKUAZ TAKI değil misin?"

Cevap:
"Evet 😊 TURKUAZ TAKI destek hattındasınız. Nasıl yardımcı olabilirim?"
`;

    const openaiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: text,
          },
        ],
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply =
      openaiResponse.data.choices[0].message.content;

    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: {
          body: reply,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.sendStatus(200);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Server çalışıyor: ${PORT}`);
});
