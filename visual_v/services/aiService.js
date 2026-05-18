const OpenAI = require('openai');

let openai;
try {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch (e) {
  console.log("OpenAI not initialized.");
}

function getAiServicePrompt(user) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const known = user.data || {};
  
  // Explicit state injected into prompt so AI NEVER forgets
  const knownLines = [];
  if (known.from) knownLines.push(`- FROM airport: ${known.from} (IATA code, already confirmed)`);
  if (known.to) knownLines.push(`- TO airport: ${known.to} (IATA code, already confirmed)`);
  if (known.date) knownLines.push(`- DATE: ${known.date} (already confirmed)`);
  if (known.passengers) knownLines.push(`- PASSENGERS: ${known.passengers} (already confirmed)`);
  if (known.preferred_airline) knownLines.push(`- PREFERRED AIRLINE: ${known.preferred_airline} (user explicitly requested)`);
  if (known.targetFlightDetails) knownLines.push(`- SCREENSHOT FLIGHT: ${JSON.stringify(known.targetFlightDetails)} (from user's screenshot)`);

  const knownBlock = knownLines.length > 0
    ? `\n=== ALREADY CONFIRMED DATA (DO NOT ASK AGAIN) ===\n${knownLines.join('\n')}\n================================================\n`
    : '';

  const screenshotAlreadySent = user.messages && user.messages.some(m => m.hasImage);
  const luggageNudgeDone = user.data?.luggageNudgeDone || false;
  const screenshotNudgeDone = user.data?.screenshotNudgeDone || screenshotAlreadySent;

  return `You are Manoj, a sharp and friendly travel agent for Hopspot Travel.
CURRENT DATE: ${dateStr}.
${knownBlock}
=== YOUR DECISION TREE (follow STRICTLY in order) ===

STEP 1 — CHECK KNOWN DATA:
You already have the data listed in ALREADY CONFIRMED above.
NEVER ask for data you already have. This is the most important rule.

STEP 2 — SCREENSHOT HANDLING (if user sent an image):
If an image was sent, you MUST extract from it:
  • Route (from/to city names → convert to IATA) → set fromCode, toCode
  • Date → set date as YYYY-MM-DD
  • Airline name + departure time → set targetFlightDetails.airline and targetFlightDetails.departureTime
  • Passengers if visible (else default 1)
After extracting, set search_flights_now: true immediately. Do NOT wait for a manual request.

STEP 3 — COLLECT MISSING INFO (only if truly missing):
If any of FROM, TO, DATE, PASSENGERS is missing, ask for ONE missing item at a time.
Example: If you have FROM+TO+DATE but not PASSENGERS, just ask "How many passengers?"
Do NOT ask for city or date if you already have them.

STEP 4 — LUGGAGE PREFERENCE (ask ONCE only, only for specific routes):
${luggageNudgeDone ? 'LUGGAGE NUDGE ALREADY DONE. Skip this step.' :
`If TO is BHX, LHR, or YYZ, ask ONCE: "For this route, would you like me to find options with a higher baggage allowance (46kg / 2 bags)? 🧳"
  - If YES → set preferred_airline: "Air India", luggageNudgeDone: true
  - If NO  → set luggageNudgeDone: true, search_flights_now: true`}

STEP 5 — SCREENSHOT NUDGE (ask ONCE only):
${screenshotNudgeDone ? 'SCREENSHOT NUDGE ALREADY DONE OR SCREENSHOT ALREADY SENT. Skip directly to search.' :
`If all details are collected and no screenshot has been shared, ask ONCE:
"Do you have a screenshot of a cheaper flight you'd like me to beat?"
  - If YES → wait for screenshot
  - If NO  → set screenshotNudgeDone: true, search_flights_now: true`}

STEP 6 — INLINE AIRLINE REQUEST:
If user says "show me only X airline" or "I want X airline" → set preferred_airline to that airline, set search_flights_now: true immediately. Do NOT ask any more questions.

STEP 7 — TRIGGER SEARCH:
When FROM + TO + DATE + PASSENGERS are all known OR a screenshot has just been processed → set search_flights_now: true.

=== ABSOLUTE RULES ===
• ABSOLUTELY BAN THE WORD "TODAY": Never use the word "today" anywhere in your response. Not at the start, middle, or end. No exceptions.
• NEVER ask for info you already have
• NEVER re-ask after user declines an option (46kg, screenshot, etc.)
• Keep replies short and natural, like a real travel agent WhatsApp message
• When in doubt about what to do next → trigger search

=== JSON OUTPUT FORMAT (always valid JSON) ===
{
  "reply": "Short WhatsApp-style message",
  "data_updates": {
    "fromCode": "IATA or null",
    "toCode": "IATA or null",
    "date": "YYYY-MM-DD or null",
    "passengers": null,
    "preferred_airline": "Airline name or null",
    "luggageNudgeDone": false,
    "screenshotNudgeDone": false,
    "targetFlightDetails": {
      "airline": "Exact airline name from screenshot",
      "departureTime": "HH:MM from screenshot",
      "flightNumber": "Flight code if visible"
    }
  },
  "search_flights_now": false
}`;
}

async function processWithAI(user, userInput, base64Image) {
  if (!openai) return null;
  try {
    // Only keep last 8 messages to avoid token bloat
    const chatHistory = user.messages
      .filter(m => m.text && m.text.length > 0)
      .slice(-9, -1) // Get last 8 messages EXCLUDING the current one (which is the last one)
      .map(m => ({
        role: m.role === 'bot' ? 'assistant' : 'user',
        content: m.text
      }));

    const userMessageContent = [{ 
      type: "text", 
      text: userInput || (base64Image ? "Please extract all flight details from this screenshot." : "Hello")
    }];
    
    if (base64Image) {
      userMessageContent.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: "high" }
      });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: getAiServicePrompt(user) },
        ...chatHistory,
        { role: "user", content: userMessageContent }
      ],
      temperature: 0.1, // Very low — maximum consistency
      response_format: { type: "json_object" }
    });

    const aiOutput = JSON.parse(response.choices[0].message.content);
    const parsed = aiOutput.data_updates || {};

    // Strip nulls and empty strings so they don't overwrite real data
    const cleanParsed = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== null && v !== "null" && v !== "" && v !== undefined) {
        if (typeof v === 'object' && !Array.isArray(v)) {
          // For nested objects (like targetFlightDetails), strip nulls inside too
          const inner = {};
          for (const [ik, iv] of Object.entries(v)) {
            if (iv !== null && iv !== "null" && iv !== "" && iv !== undefined) inner[ik] = iv;
          }
          if (Object.keys(inner).length > 0) cleanParsed[k] = inner;
        } else {
          cleanParsed[k] = v;
        }
      }
    }

    console.log(`[AI Output]: reply="${aiOutput.reply?.substring(0, 60)}" search=${aiOutput.search_flights_now} parsed=${JSON.stringify(cleanParsed)}`);

    return {
      reply: aiOutput.reply,
      parsed: cleanParsed,
      searchFlightsNow: !!aiOutput.search_flights_now
    };
  } catch (err) {
    console.error("AI Error:", err.message);
    return null;
  }
}

module.exports = { processWithAI };
