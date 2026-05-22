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
const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;

function getSheetCsvUrl() {
  const match = GOOGLE_SHEET_URL.match(/\/d\/([^/]+)/);
  if (!match) return null;
  const sheetId = match[1];
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
}

function parseCSV(csv) {
  const lines = csv.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] || "";
    });
    return item;
  });
}

async function getProducts() {
  try {
    const csvUrl = getSheetCsvUrl();
    if (!csvUrl) return [];

    const response = await axios.get(csvUrl);
    return parseCSV(response.data);
  } catch (error) {
    console.error("Google Sheets okunamadı:", error.message);
    return [];
  }
}

function findMatchingProducts(text, products) {
  const lowerText = text.toLowerCase();

  return products.filter((product) => {
    const kategori = String(product.kategori || "").toLowerCase();
    const urunAdi = String(product.urun_adi || "").toLowerCase();
    const aciklama = String(product.aciklama || "").toLowerCase();

    return (
      lowerText.includes(kategori) ||
      lowerText.includes(urunAdi) ||
      urunAdi.includes(lowerText) ||
      aciklama.includes(lowerText)
    );
  });
}

function formatProducts(products) {
  if (!products.length) return "Tabloda uygun ürün bulunamadı.";

  return products
    .map((p) => {
      return `- ${p.urun_adi} | ${p.fiyat}₺ | Stok: ${p.stok} | ${p.aciklama}`;
    })
    .join("\n");
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
    const text = message.text?.body;

    if (!text) {
      return res.sendStatus(200);
    }

    const products = await getProducts();
    const matchingProducts = findMatchingProducts(text, products);
    const productText = formatProducts(
      matchingProducts.length ? matchingProducts : products.slice(0, 10)
    );

    const systemPrompt = `
Sen TURKUAZ TAKI'nın WhatsApp müşteri temsilcisisin.

ÇOK ÖNEMLİ KURALLAR:
- Asla yapay zeka olduğunu söyleme.
- Asla "ben bir asistanım" deme.
- Kendini TURKUAZ TAKI destek ekibi gibi ifade et.
- Cevapların kısa, doğal ve satış odaklı olsun.
- Bilmediğin fiyat, stok, kargo süresi veya ürün detayını uydurma.
- Fiyat ve ürün bilgisini sadece aşağıdaki Google Sheets ürün listesinden ver.
- Listede olmayan ürün için "Kontrol edip size bilgi verelim" de.
- Müşteriyi mümkünse siparişe yönlendir.

KAMPANYA:
- 2. üründe %50 indirim vardır.
- Her 2 üründe bir geçerlidir.
- Her ikilide ucuz olan ürün yarı fiyatına düşer.
- Müşteri birden fazla ürün sorarsa kampanyayı hatırlat.

SİPARİŞ İÇİN ALINACAK BİLGİLER:
- İsim soyisim
- İstediği ürün
- Şehir
- Telefon numarası

GOOGLE SHEETS ÜRÜN LİSTESİ:
${productText}

ÖRNEK CEVAPLAR:

Müşteri: Burma bilezik fiyatı ne kadar?
Cevap: Burma Bilezik fiyatımız 1250₺ 😊 Stokta mevcut. İsterseniz 2. üründe %50 kampanyamızdan da faydalanabilirsiniz.

Müşteri: Sipariş vermek istiyorum
Cevap: Memnuniyetle yardımcı oluruz 😊 Sipariş için isim soyisim, istediğiniz ürün, şehir ve telefon numaranızı paylaşır mısınız?

Müşteri: 2 ürün alırsam indirim olur mu?
Cevap: Evet 😊 2. üründe %50 indirim var. Her 2 üründe ucuz olan ürün yarı fiyatına düşer.
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
        temperature: 0.4,
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
