const express = require("express");

const app = express();

app.use(express.json());

const TOKEN = process.env.WHATSAPP_TOKEN;

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

app.post("/webhook", async (req, res) => {
  console.log("MESAJ GELDİ:");
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      const from = message.from;
      const text = message.text?.body;

      console.log("Mesaj:", text);

      await fetch(
        "https://graph.facebook.com/v25.0/101070864485171/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            text: {
              body: "Merhaba 👋 Mesajını aldım: " + text,
            },
          }),
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server çalışıyor");
});
