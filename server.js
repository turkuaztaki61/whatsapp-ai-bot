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

async function getProducts() {
  try {
    const response = await axios.get(GOOGLE_SHEET_URL);
    const text = response.data;

    const rows = text.split("\n").slice(1);

    return rows.map((row) => {
      const cols = row.split(",");

      return {
        kategori: cols[0],
        urun_adi: cols[1],
        fiyat: cols[2],
        stok: cols[3],
        aciklama: cols[4],
        foto_url: cols[5],
        urun_linki: cols[6],
        etiket: cols[7],
        aktif: cols[8]
      };
    });
  } catch (err) {
    console.log(err);
    return [];
  }
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
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body?.toLowerCase() || "";

    const products = await getProducts();

    let foundProduct = null;

    for (const product of products) {
      const tags = product.etiket?.toLowerCase() || "";
      const name = product.urun_adi?.toLowerCase() || "";

      if (
        text.includes(name) ||
        tags.split(",").some((tag) => text.includes(tag.trim()))
      ) {
        foundProduct = product;
        break;
      }
    }

    let reply = "";

    if (foundProduct) {
      if (text.includes("link")) {
        reply = `Ürün linki:\n${foundProduct.urun_linki}`;
      } else if (
        text.includes("foto") ||
        text.includes("resim")
      ) {
        reply = `Ürün fotoğrafı:\n${foundProduct.foto_url}`;
      } else {
        reply = `${foundProduct.urun_adi} fiyatı ${foundProduct.fiyat}₺.\n\n${foundProduct.aciklama}`;
      }
    } else {
      const aiResponse = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Sen Turkuaz Takı müşteri temsilcisisin. Kısa ve samimi cevap ver."
            },
            {
              role: "user",
              content: text
            }
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      reply =
        aiResponse.data.choices[0].message.content;
    }

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
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log("Server çalışıyor:", PORT);
});
