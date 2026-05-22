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
  const match = GOOGLE_SHEET_URL?.match(/\/d\/([^/]+)/);

  if (!match) return null;

  const sheetId = match[1];

  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
}

function parseCSV(csv) {
  const lines = csv.trim().split(/\r?\n/);

  const headers = lines[0].split(",").map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim());

    const item = {};

    headers.forEach((header, i) => {
      item[header] = values[i] || "";
    });

    return item;
  });
}

async function getProducts() {
  try {
    const csvUrl = getSheetCsvUrl();

    if (!csvUrl) return [];

    const response = await axios.get(csvUrl);

    const products = parseCSV(response.data);

    return products.filter(
      p =>
        p.urun_adi &&
        String(p.aktif).toLowerCase() === "evet"
    );
  } catch (error) {
    console.log(error.message);
    return [];
  }
}

function findProducts(message, products) {
  const text = message.toLowerCase();

  return products.filter(p => {
    const kategori = String(p.kategori || "").toLowerCase();
    const urunAdi = String(p.urun_adi || "").toLowerCase();
    const aciklama = String(p.aciklama || "").toLowerCase();
    const etiket = String(p.etiket || "").toLowerCase();

    return (
      text.includes(kategori) ||
      text.includes(urunAdi) ||
      text.includes(aciklama) ||
      text.includes(etiket)
    );
  });
}

function productListText(products) {
  return products.map(p => {
    return `
Ürün: ${p.urun_adi}
Kategori: ${p.kategori}
Fiyat: ${p.fiyat}₺
Stok: ${p.stok}
Açıklama: ${p.aciklama}
Ürün Linki: ${p.urun_linki}
Fotoğraf: ${p.foto_url}
`;
  }).join("\n");
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
    const text = message.text?.body;

    if (!text) return res.sendStatus(200);

    const allProducts = await getProducts();

    const matchedProducts = findProducts(text, allProducts);

    const visibleProducts =
      matchedProducts.length > 0
        ? matchedProducts
        : allProducts.slice(0, 10);

    const systemPrompt = `
Sen TURKUAZ TAKI müşteri temsilcisisin.

Kurallar:
- Yapay zeka olduğunu söyleme.
- Samimi konuş.
- Satış odaklı ol.
- Kısa ve doğal yaz.
- Emoji kullan ama abartma.

Kampanya:
- 2. üründe %50 indirim var.
- Her 2 üründe bir geçerli.
- Ucuz olan ürün yarı fiyatına düşer.

Sipariş almak istersen:
- isim soyisim
- telefon
- şehir
- ürün adı
iste.

Ürünler:
${productListText(visibleProducts)}
`;

    const openaiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0.5
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
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
          body: reply
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
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
