const express = require("express");

const app = express();

app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const PHONE_NUMBER_ID = "1157929437414549";

app.get("/", (req, res) => {
  res.send("WhatsApp AI Bot Çalışıyor");
});

app.get("/webhook", (req, res) => {
  const verify_token = "hasan123";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === verify_token) {
    console.log("WEBHOOK DOĞRULANDI");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

async function askChatGPT(userMessage) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: userMessage,
    }),
  });

  const data = await response.json();

  console.log("OPENAI CEVABI:", data);

  return data.output_text || "Şu an cevap oluşturamadım.";
}

async function sendWhatsAppMessage(to, text) {
  const response = await fetch(
    `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        text: {
          body: text,
        },
      }),
    }
  );

  const data = await response.json();
  console.log("WHATSAPP CEVABI:", data);
}

app.post("/webhook", async (req, res) => {
  try {
    console.log("MESAJ GELDİ:");
    console.log(JSON.stringify(req.body, null, 2));

    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message && message.type === "text") {
      const from = message.from;
      const userText = message.text?.body || "";

      console.log("KULLANICI MESAJI:", userText);

      const aiReply = await askChatGPT(userText);

      await sendWhatsAppMessage(from, aiReply);
    }

    res.sendStatus(200);
  } catch (error) {
    console.log("HATA:", error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server çalışıyor");
});
