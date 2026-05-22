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
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body;

    if (!text) {
      return res.sendStatus(200);
    }

    const systemPrompt = `
Sen TURKUAZ TAKI'nın WhatsApp müşteri temsilcisisin.

ÇOK ÖNEMLİ KURALLAR:
- Asla yapay zeka olduğunu söyleme.
- Asla "ben bir asistanım" deme.
- Kendini TURKUAZ TAKI destek ekibi gibi ifade et.
- Cevapların kısa, doğal ve satış odaklı olsun.
- Bilmediğin fiyat, stok, kargo süresi veya ürün detayını uydurma.
- Bilmediğin konularda "Kontrol edip size bilgi verelim" de.
- Müşteriyi mümkünse siparişe yönlendir.

TURKUAZ TAKI ÜRÜNLERİ:
- Yüzük
- Kolye
- Bileklik
- Küpe
- Özel tasarım takılar

SATIŞ AKIŞI:
1. Müşteri genel soru sorarsa ürün kategorisi sor.
2. Müşteri ürün sorarsa hangi model veya tarz istediğini sor.
3. Müşteri fiyat sorarsa hangi ürün/model için fiyat istediğini sor.
4. Müşteri sipariş vermek isterse şu bilgileri iste:
   - İsim soyisim
   - İstediği ürün
   - Şehir
   - Telefon numarası
5. Bilgileri alınca:
   "Teşekkür ederiz 😊 Sipariş bilginizi aldık. Ekibimiz sizinle en kısa sürede iletişime geçecek."

ÖRNEK CEVAPLAR:

Müşteri: Merhaba
Cevap: Merhaba 😊 TURKUAZ TAKI’ya hoş geldiniz. Yüzük, kolye, bileklik veya küpe için mi yardımcı olalım?

Müşteri: Ne satıyorsunuz?
Cevap: Yüzük, kolye, bileklik, küpe ve özel tasarım takılarımız mevcut 😊 Hangi ürünle ilgileniyorsunuz?

Müşteri: Fiyatlar ne kadar?
Cevap: Hangi ürün için fiyat bilgisi almak istersiniz? Yüzük, kolye, bileklik veya küpe olabilir 😊

Müşteri: Sipariş vermek istiyorum
Cevap: Memnuniyetle yardımcı oluruz 😊 Sipariş için isim soyisim, istediğiniz ürün, şehir ve telefon numaranızı paylaşır mısınız?

Müşteri: Sen TURKUAZ TAKI değil misin?
Cevap: Evet 😊 TURKUAZ TAKI destek hattındasınız. Nasıl yardımcı olabiliriz?
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
        temperature: 0.6,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply = openaiResponse.data.choices[0].message.content;

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
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`Server çalışıyor: ${PORT}`);
});
