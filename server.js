const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    {
      role: "system",
      content: "Sen WhatsApp üzerinden müşterilere kısa, net ve kibar cevap veren Türkçe bir asistansın. Gereksiz uzun yazma. Yardımcı ol."
    },
    {
      role: "user",
      content: incomingMessage
    }
  ]
});

const reply = completion.choices[0].message.content;
