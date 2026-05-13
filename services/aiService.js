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
  
  // Build known data context so AI never forgets what it already knows
  const known = user.data || {};
  const knownContext = [
    known.from ? `From: ${known.from}` : null,
    known.to ? `To: ${known.to}` : null,
    known.date ? `Date: ${known.date}` : null,
    known.passengers ? `Passengers: ${known.passengers}` : null,
    known.preferred_airline ? `Preferred Airline: ${known.preferred_airline}` : null,
  ].filter(Boolean).join(', ');

  const screenshotAlreadySent = user.messages && user.messages.some(m => m.hasImage);
  
  return `You are Manoj, a friendly and professional travel agent for Hopspot Travel.
CURRENT DATE: ${dateStr}.
${knownContext ? `ALREADY KNOWN: ${knownContext}` : ''}

CRITICAL RULES (follow in exact order):

1. MEMORY: You already know the details listed in ALREADY KNOWN above. NEVER ask for details you already have. Do NOT forget previous information when a user declines an option.

2. SCREENSHOT VISION: If the user sends a screenshot of a flight listing, extract ALL visible info:
   - Departure city & arrival city → set "fromCode" and "toCode" (as IATA codes)
   - Travel date → set "date" (YYYY-MM-DD)
   - Number of passengers (default to 1 if not visible)
   - Exact airline name → set "targetFlightDetails.airline"
   - Exact departure time (HH:MM) → set "targetFlightDetails.departureTime"
   - After extraction, DO NOT ask for more details. Proceed directly to STEP 4 (luggage nudge) or STEP 5 (search).

3. FLOW: If you do NOT have route/date/passengers, ask for what's missing ONE at a time. Never ask for info you already have.

4. AIR INDIA 46KG NUDGE (ASK ONLY ONCE): If destination is Birmingham (BHX), London Heathrow (LHR), or Toronto (YYZ), ask ONCE: "Would you prefer flights with 46kg check-in luggage (2 bags of 23kg), highly recommended for this route?" If YES → set "preferred_airline": "Air India". If NO → immediately set "search_flights_now": true. Do NOT ask again.

5. SCREENSHOT NUDGE (ASK ONLY ONCE, SKIP IF SCREENSHOT ALREADY SENT): ${screenshotAlreadySent ? 'USER ALREADY SENT A SCREENSHOT. DO NOT ASK FOR ANOTHER ONE. Skip directly to search.' : 'When you have all details, ask once: "Do you have a screenshot of a lower price to beat?" If YES, wait. If NO, set "search_flights_now": true.'}

6. SEARCH: Set "search_flights_now": true when you have route + date + passengers and screenshot nudge is done.

7. NO "TODAY": Never start a reply with the word "today".

JSON Output (always return valid JSON):
{
  "reply": "Short, friendly message. Never repeat what the user just said.",
  "data_updates": {
    "fromCode": "IATA code or null",
    "toCode": "IATA code or null",
    "date": "YYYY-MM-DD or null",
    "passengers": null,
    "preferred_airline": "Airline name or null",
    "targetFlightDetails": { "airline": "Name", "departureTime": "HH:MM", "flightNumber": "" }
  },
  "search_flights_now": false
}`;
}

async function processWithAI(user, userInput, base64Image) {
  if (!openai) return null;
  try {
    const chatHistory = user.messages
      .filter(m => m.text && m.text.length > 0)
      .slice(-10) // Only last 10 messages to avoid token overflow
      .map(m => ({
        role: m.role === 'bot' ? 'assistant' : 'user',
        content: m.text
      }));

    // Construct the message with image support
    const userMessageContent = [{ type: "text", text: userInput || "Please look at this flight screenshot and extract all the details." }];
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
      temperature: 0.2, // Lower temperature = more consistent, less creative mistakes
      response_format: { type: "json_object" }
    });

    const aiOutput = JSON.parse(response.choices[0].message.content);
    
    // Clean up null strings from data_updates
    const parsed = aiOutput.data_updates || {};
    Object.keys(parsed).forEach(k => {
      if (parsed[k] === "null" || parsed[k] === null || parsed[k] === "") {
        delete parsed[k];
      }
    });

    return {
      reply: aiOutput.reply,
      parsed,
      searchFlightsNow: !!aiOutput.search_flights_now
    };
  } catch (err) {
    console.error("AI Error:", err);
    return null;
  }
}

module.exports = { processWithAI };
