const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: "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" });

async function check() {
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{role: "user", content: "hi"}],
    });
    console.log("Success:", res.choices[0].message.content);
  } catch(e) {
    console.log("Error:", e.message);
  }
}
check();
