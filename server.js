const express = require("express");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("WhatsApp AI Bot Çalışıyor");
});

app.post("/webhook", (req, res) => {

  console.log("MESAJ GELDİ:");
  console.log(req.body);

  res.sendStatus(200);

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server çalışıyor");
});