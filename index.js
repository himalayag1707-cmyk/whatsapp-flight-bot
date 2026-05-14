require('dotenv').config();
const express = require('express');
const { handleIncomingMessage } = require('./controllers/flowController');

const app = express();
app.use(express.json());
app.use(express.static('dashboard/public'));

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Ensure data directory exists for local persistence
const fs = require('fs');
const path = require('path');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
  console.log('📁 Created data directory');
}

// WhatsApp Verification (Webhook)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Used to avoid processing the same message twice (WhatsApp sends retries)
const processedMessages = new Set();

// Incoming Messages Webhook
app.post('/webhook', async (req, res) => {
  // Send 200 OK immediately so WhatsApp doesn't retry
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const msg = value?.messages?.[0];

    if (!msg) return;

    // Deduplication
    if (processedMessages.has(msg.id)) return;
    processedMessages.add(msg.id);
    setTimeout(() => processedMessages.delete(msg.id), 60000); // clear after 1 min

    const from = msg.from;
    let text = "";
    let base64Image = null;
    let mediaId = null;

    if (msg.type === 'text') {
      text = msg.text?.body || "";
    } else if (msg.type === 'image') {
      mediaId = msg.image?.id;
      if (mediaId) {
        const { downloadMedia } = require('./services/whatsapp');
        base64Image = await downloadMedia(mediaId);
        text = msg.image?.caption || ""; 
      }
    } else if (msg.type === 'interactive' && msg.interactive?.type === 'list_reply') {
      text = msg.interactive.list_reply.id; // Extracts 'flight_1', etc.
    } else if (msg.interactive?.button_reply) {
      text = msg.interactive.button_reply.id;
    }

    if (text || base64Image || mediaId) {
      console.log(`📩 Incoming message from ${from}: ${text?.substring(0, 50)}...`);
      await handleIncomingMessage(from, text, base64Image, mediaId);
    }

  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err.message);
    if (err.response) console.error("Response data:", err.response.data);
  }
});

// Dashboard APIs
const { getUser } = require('./state/userStore');
app.get('/api/users', (req, res) => {
  const { getAllUsers } = require('./state/userStore');
  res.json(getAllUsers());
});
app.post('/api/send', async (req, res) => {
  const { mobile, text } = req.body;
  if (!mobile || !text) return res.status(400).json({ error: "Missing fields" });
  
  const userStore = require('./state/userStore');
  const user = userStore.getUser(mobile);
  user.messages.push({ role: 'bot', text, time: Date.now() });
  user.lastMessageAt = new Date().toISOString();
  userStore.updateUser(mobile, { messages: user.messages, lastMessageAt: user.lastMessageAt });
  
  const { sendMessage } = require('./services/whatsapp');
  try {
    await sendMessage(mobile, text);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to send message" });
  }
});

app.post('/api/override', (req, res) => {
  const { mobile, isHumanOverride } = req.body;
  const userStore = require('./state/userStore');
  userStore.updateUser(mobile, { isHumanOverride });
  res.json({ success: true, isHumanOverride });
});

app.get('/api/history/:mobile', (req, res) => {
  const { getArchivedHistory } = require('./state/userStore');
  res.json(getArchivedHistory(req.params.mobile));
});

app.post('/api/whisper', async (req, res) => {
  const { mobile, text } = req.body;
  if (!mobile || !text) return res.status(400).json({ error: "Missing fields" });
  
  const { handleIncomingMessage } = require('./controllers/flowController');
  
  // Simulate an admin WHISPER command to trigger the AI interactive logic
  const adminCommand = `WHISPER ${mobile} ${text}`;
  
  try {
    // We pass ADMIN_NUMBER and null media to signify this is a command from the admin
    await handleIncomingMessage(process.env.ADMIN_NUMBER || '918882783582', adminCommand, null);
    res.json({ success: true, message: "Whisper processed successfully" });
  } catch (error) {
    console.error("Dashboard Whisper Error:", error);
    res.status(500).json({ error: "Failed to process whisper" });
  }
});

app.patch('/api/users/:mobile', (req, res) => {
  const mobile = req.params.mobile;
  const updates = req.body;
  const userStore = require('./state/userStore');
  const user = userStore.getUser(mobile);
  
  if (updates.data) {
    user.data = { ...user.data, ...updates.data };
  }
  if (updates.state) user.state = updates.state;
  if (updates.passengerNames) user.passengerNames = updates.passengerNames;
  
  userStore.updateUser(mobile, user);
  res.json({ success: true, user });
});

app.post('/api/send-ticket', async (req, res) => {
  const { mobile, seatNumber } = req.body;
  if (!mobile) return res.status(400).json({ error: "Missing mobile" });
  
  const { sendMessage } = require('./services/whatsapp');
  const userStore = require('./state/userStore');
  const user = userStore.getUser(mobile);
  
  const selectedFlight = user.flights?.find(f => f.flights[0].flight_number === user.data.flightNumberSelected);
  const depTime = selectedFlight?.flights[0]?.departure_airport?.time || 'N/A';
  const arrTime = selectedFlight?.flights[selectedFlight?.flights?.length - 1]?.arrival_airport?.time || 'N/A';

  const seatInfo = seatNumber ? `\nSeat(s): ${seatNumber}` : "";

  const ticketMsg = `🎫 *E-Ticket Confirmation*\n\n` +
                    `Passenger(s): ${user.passengerNames.join(', ')}\n` +
                    `Route: ${user.data.from} → ${user.data.to}\n` +
                    `Date: ${user.data.date}\n` +
                    `Flight: ${user.data.flightNumberSelected}` +
                    seatInfo + `\n` +
                    `Departure Time: ${depTime}\n` +
                    `Arrival Time: ${arrTime}\n\n` +
                    `Your booking is confirmed.`;

  try {
    await sendMessage(mobile, ticketMsg);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to send ticket" });
  }
});

app.get('/api/debug', async (req, res) => {
  const OpenAI = require('openai');
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }]
    });
    res.json({ status: "AI is working perfectly!", reply: response.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ 
      error: "AI initialization failed", 
      message: err.message, 
      key_present: !!process.env.OPENAI_API_KEY 
    });
  }
});

// Background Nudge Job (runs every 5 minutes)
setInterval(async () => {
  const { getAllUsers, updateUser } = require('./state/userStore');
  const { sendMessage } = require('./services/whatsapp');
  const users = getAllUsers();
  const now = Date.now();
  
  for (const mobile in users) {
    const user = users[mobile];
    if (['SELECT_FLIGHT', 'COLLECT_DETAILS', 'PAYMENT'].includes(user.state)) {
      const inactiveMinutes = (now - user.lastActivity) / (1000 * 60);
      if (inactiveMinutes > 30 && !user.data.nudgeSent) {
        user.data.nudgeSent = true;
        const nudgeMsg = "Hi there! Have you decided on your flight or are we ready for payment? Prices fluctuate quickly, so let me know if you need any help completing your booking! ✈️";
        user.messages.push({ role: 'bot', text: nudgeMsg, time: Date.now() });
        updateUser(mobile, user);
        try {
          await sendMessage(mobile, nudgeMsg);
        } catch (err) {
          console.error("Failed to send nudge to", mobile);
        }
      }
    }
  }
}, 5 * 60 * 1000);

app.listen(PORT, HOST, () => {
  console.log(`🚀 WA Flight Bot running on http://${HOST}:${PORT}`);
  console.log(`🔗 Webhook URL should be: <your-railway-url>/webhook`);
});
