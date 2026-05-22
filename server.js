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

async function getProducts() {
  try {
    const response = await axios.get(GOOGLE_SHEET_URL);
    const csv = response.data.trim();
    const lines = csv.split(/\r?\n/);

    const headers = lines[0].split(",").map(h => h.trim());

    return lines.slice(1).map(line => {
      const values = line.split(",").map(v => v.trim());
      const item = {};

      headers.forEach((h, i) => {
        item[h] = values[i] || "";
      });

      return item;
    }).filter(p => p.urun_adi && String(p.aktif || "").toLowerCase() === "evet");
  } catch (error) {
    console.log("Sheet okunamadı:", error.message);
    return [];
  }
}

function findProduct(text, products) {
  const t = text.toLowerCase();

  return products.find(p => {
    const name = String(p.urun_adi || "").toLowerCase();
    const tag = String(p.etiket || "").toLowerCase();
    const category = String(p.kategori || "").toLowerCase();

    return (
      t.includes(name) ||
      name.includes(t) ||
      tag.split(",").some(x => t.includes(x.trim())) ||
      t.includes(category)
    );
  });
}

function extractPhone(text) {
  const cleaned = text.replace(/\s/g, "");
  const match = cleaned.match(/(\+?90)?0?5\d{9}/);
  return match ? match[0] : null;
}

function looksLikeAddress(text) {
  const t = text.toLowerCase();
  return (
    t.includes("mah") ||
    t.includes("mahalle") ||
    t.includes("cad") ||
    t.includes("sok") ||
    t.includes("no") ||
    t.includes("apart") ||
    t.length > 20
  );
}

function looksLikeCity(text) {
  return text.length >= 3 && text.length <= 25;
}

function getMissingField(data) {
  if (!data.name) return "name";
  if (!data.phone) return "phone";
  if (!data.city) return "city";
  if (!data.address) return "address";
  if (!data.product) return "product";
  return null;
}

function questionFor(field) {
  const questions = {
    name: "Sipariş için ad soyadınızı yazar mısınız? 😊",
    phone: "Telefon numaranızı yazar mısınız? 📞",
    city: "Hangi şehirde yaşıyorsunuz? 🌍",
    address: "Açık adresinizi yazar mısınız? 📦",
    product: "Hangi ürünü sipariş etmek istiyorsunuz? 🛍️",
  };

  return questions[field];
}

async function finishOrder(from, data) {
  const customerMessage = `✅ Sipariş talebinizi aldık 😊

👤 Ad Soyad: ${data.name}
📞 Telefon: ${data.phone}
🌍 Şehir: ${data.city}
📦 Adres: ${data.address}
🛍️ Ürün: ${data.product}

Ekibimiz sizinle en kısa sürede iletişime geçecek.`;

  const adminMessage = `🛒 Yeni Sipariş Talebi

👤 Ad Soyad: ${data.name}
📞 Telefon: ${data.phone}
🌍 Şehir: ${data.city}
📦 Adres: ${data.address}
🛍️ Ürün: ${data.product}

Müşteri WhatsApp ID:
${from}`;

  await sendMessage(from, customerMessage);

  if (ADMIN_PHONE) {
    await sendMessage(ADMIN_PHONE, adminMessage);
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
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const rawText = message.text?.body || "";
    const text = rawText.trim();
    const lower = text.toLowerCase();

    if (!text) return res.sendStatus(200);

    if (!customers[from]) {
      customers[from] = {
        orderMode: false,
        data: {},
      };
    }

    const customer = customers[from];
    const products = await getProducts();
    const product = findProduct(lower, products);

    if (lower.includes("iptal")) {
      customer.orderMode = false;
      customer.data = {};
      await sendMessage(from, "Sipariş işlemini iptal ettim. Başka bir konuda yardımcı olabiliriz 😊");
      return res.sendStatus(200);
    }

    if (lower.includes("sipariş") || lower.includes("satın almak") || lower.includes("almak istiyorum")) {
      customer.orderMode = true;

      if (product) {
        customer.data.product = product.urun_adi;
      }

      const missing = getMissingField(customer.data);

      if (!missing) {
        await finishOrder(from, customer.data);
        customer.orderMode = false;
        customer.data = {};
      } else {
        await sendMessage(from, questionFor(missing));
      }

      return res.sendStatus(200);
    }

    if (customer.orderMode) {
      const phone = extractPhone(text);

      if (phone && !customer.data.phone) {
        customer.data.phone = phone;
      } else if (product && !customer.data.product) {
        customer.data.product = product.urun_adi;
      } else if (!customer.data.name) {
        customer.data.name = text;
      } else if (!customer.data.city && looksLikeCity(text)) {
        customer.data.city = text;
      } else if (!customer.data.address && looksLikeAddress(text)) {
        customer.data.address = text;
      } else if (!customer.data.product) {
        customer.data.product = text;
      }

      const missing = getMissingField(customer.data);

      if (!missing) {
        await finishOrder(from, customer.data);
        customer.orderMode = false;
        customer.data = {};
      } else {
        await sendMessage(from, questionFor(missing));
      }

      return res.sendStatus(200);
    }

    if (product && lower.includes("link")) {
      await sendMessage(from, `Ürün linki:\n${product.urun_linki}`);
      return res.sendStatus(200);
    }

    if (product && (lower.includes("foto") || lower.includes("resim"))) {
      await sendMessage(from, `Ürün fotoğrafı:\n${product.foto_url}`);
      return res.sendStatus(200);
    }

    if (product) {
      await sendMessage(
        from,
        `${product.urun_adi} fiyatı ${product.fiyat}₺ 😊\n\n${product.aciklama}\n\n2. üründe %50 indirim kampanyamız var.`
      );
      return res.sendStatus(200);
    }

    const productText = products.map(p => {
      return `${p.urun_adi} - ${p.fiyat}₺ - ${p.aciklama}`;
    }).join("\n");

    const aiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Sen TURKUAZ TAKI'nın WhatsApp müşteri temsilcisisin.

Kurallar:
- Yapay zeka olduğunu söyleme.
- Kısa, samimi ve satış odaklı konuş.
- Ürün fiyatlarını sadece aşağıdaki listeden ver.
- Bilmediğin fiyatı uydurma.
- Sipariş isteyen müşteriyi sipariş bilgilerine yönlendir.
- 2. üründe %50 indirim olduğunu uygun yerde söyle.

Ürün listesi:
${productText}
`
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0.4
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply = aiResponse.data.choices[0].message.content;

    await sendMessage(from, reply);

    res.sendStatus(200);
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log("Server çalışıyor:", PORT);
});
