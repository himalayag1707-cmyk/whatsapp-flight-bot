// Combined flowController implementation without duplicate sections
const { getUser, updateUser, resetUser, setLastAdminTarget, getLastAdminTarget, findUserByAny } = require('../state/userStore');
const { parseInput } = require('../services/parser');
const { getIATACode } = require('../services/airport');
const { searchFlights } = require('../services/flightService');
const { sendMessage, sendListMessage, sendImageMessage, sendImageById } = require('../services/whatsapp');
const { saveBooking } = require('../services/sheetsService');
const { processWithAI } = require('../services/aiService');

// Unified admin number for notifications and image forwarding
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || "918882783582";

// Global deduplication for media/webhooks
const processedMediaIds = new Set();
setInterval(() => { processedMediaIds.clear(); }, 3600000); // Clear every hour

/**
 * Sends an e‑ticket message to the user.
 */
async function sendETicketToUser(mobile, user) {
  const selectedFlight = user.flights?.find(f => f.flights[0].flight_number === user.data.flightNumberSelected);
  const depTime = selectedFlight?.flights[0]?.departure_airport?.time || 'N/A';
  const arrTime = selectedFlight?.flights[selectedFlight?.flights?.length - 1]?.arrival_airport?.time || 'N/A';
  const seatInfo = user.seatInfo ? `\nSeat(s): ${user.seatInfo}` : '';

  const ticketMsg = `🎫 *E‑Ticket Confirmation*\n\n` +
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
  } catch (err) {
    console.error('Failed to send e‑ticket to', mobile, err);
  }
}

/**
 * Core entry point for incoming WhatsApp messages.
 */
async function handleIncomingMessage(mobile, text, base64Image, mediaId, baseUrl = null) {
  const cleanText = text.trim();

  if (baseUrl) {
    const u = getUser(mobile);
    u.data.baseUrl = baseUrl;
    updateUser(mobile, u);
  }

  // 1. Admin Command Handling (Priority)
  const cleanMobile = mobile.replace(/\D/g, '').slice(-10);
  const cleanAdmin = ADMIN_NUMBER.replace(/\D/g, '').slice(-10);
  const isAdmin = cleanMobile === cleanAdmin && cleanMobile.length === 10;

  if (isAdmin) {
    const parts = cleanText.split(/\s+/);
    const cmd = parts[0].toUpperCase();
    if (cmd === 'CONFIRM' && parts.length >= 3) {
      const identifier = parts[1];
      const seatNumbers = parts.slice(2).join(' ');
      const targetUser = findUserByAny(identifier);
      if (!targetUser) {
        await sendMessage(ADMIN_NUMBER, `User "${identifier}" not found. Try mobile number.`);
        return;
      }
      targetUser.seatInfo = seatNumbers;
      targetUser.state = 'DONE';
      updateUser(targetUser.mobile, targetUser);
      await sendETicketToUser(targetUser.mobile, targetUser);
      const name = (targetUser.passengerNames && targetUser.passengerNames[0]) || 'User';
      await sendMessage(ADMIN_NUMBER, `E‑Ticket sent to ${targetUser.mobile} (${name}) with seats ${seatNumbers}.`);
    } else if (cmd === 'PAUSE' && parts.length >= 2) {
      const identifier = parts[1];
      const targetUser = findUserByAny(identifier);
      if (targetUser) {
        targetUser.isHumanOverride = true;
        updateUser(targetUser.mobile, targetUser);
        await sendMessage(ADMIN_NUMBER, `Bot paused for ${targetUser.mobile} (${targetUser.passengerNames[0] || 'User'}).`);
      } else {
        await sendMessage(ADMIN_NUMBER, `User "${identifier}" not found.`);
      }
    } else if (cmd === 'RESUME' && parts.length >= 2) {
      const identifier = parts[1];
      const targetUser = findUserByAny(identifier);
      if (targetUser) {
        targetUser.isHumanOverride = false;
        updateUser(targetUser.mobile, targetUser);
        await sendMessage(ADMIN_NUMBER, `Bot resumed for ${targetUser.mobile} (${targetUser.passengerNames[0] || 'User'}).`);
      } else {
        await sendMessage(ADMIN_NUMBER, `User "${identifier}" not found.`);
      }
    } else if (cmd === 'WHISPER' || cmd === 'ASK') {
      let targetUser = null;
      let adminInput = "";
      const potentialIdentifier = parts[1];
      const resolvedUser = findUserByAny(potentialIdentifier);
      if (resolvedUser) {
        targetUser = resolvedUser;
        adminInput = parts.slice(2).join(' ');
      } else {
        const lastMobile = getLastAdminTarget();
        if (lastMobile) {
          targetUser = getUser(lastMobile);
          adminInput = parts.slice(1).join(' ');
        }
      }

      if (targetUser && adminInput) {
        targetUser.messages.push({ role: 'whisper', text: adminInput, time: Date.now() });
        updateUser(targetUser.mobile, targetUser);
        await sendMessage(ADMIN_NUMBER, `🤫 Processing command for ${targetUser.mobile} (${targetUser.passengerNames[0] || 'Unknown Name'})...`);
        
        const aiResponse = await processWithAI(targetUser, `[ADMIN_COMMAND]: ${adminInput}`);
        
        if (aiResponse) {
          // 1. Handle Admin-Only Feedback
          if (aiResponse.admin_reply) {
            targetUser.messages.push({ role: 'bot', text: aiResponse.admin_reply, isAdminOnly: true, time: Date.now() });
            updateUser(targetUser.mobile, targetUser);
            await sendMessage(ADMIN_NUMBER, `🤖 *Manoj Internal:* ${aiResponse.admin_reply}`);
          }

          // 2. Handle Data Updates (e.g. admin says "change date to 20th")
          const parsed = aiResponse.parsed || {};
          if (parsed.fromCode) targetUser.data.from = parsed.fromCode;
          else if (parsed.fromText) targetUser.data.from = getIATACode(parsed.fromText) || targetUser.data.from;
          if (parsed.toCode) targetUser.data.to = parsed.toCode;
          else if (parsed.toText) targetUser.data.to = getIATACode(parsed.toText) || targetUser.data.to;
          if (parsed.email) targetUser.data.email = parsed.email;
          if (parsed.passengers) targetUser.data.passengers = parsed.passengers;
          if (parsed.date) targetUser.data.date = parsed.date;
          if (parsed.preference) targetUser.data.preference = parsed.preference;
          if (parsed.preferred_airline) {
            targetUser.data.preferred_airline = (parsed.preferred_airline.toLowerCase() === 'any') ? null : parsed.preferred_airline;
          }
          if (parsed.targetFlightDetails) targetUser.data.targetFlightDetails = parsed.targetFlightDetails;
          if (parsed.flightNumberSelected) targetUser.data.flightNumberSelected = parsed.flightNumberSelected;
          if (parsed.price) targetUser.data.price = parsed.price;
          if (parsed.price_markup_percent !== undefined) targetUser.data.price_markup = parsed.price_markup_percent;
          updateUser(targetUser.mobile, targetUser);

          // 3. Handle Workflow Triggers (e.g. admin says "show indigo options")
          if (aiResponse.searchFlightsNow) {
            targetUser.state = 'SEARCHING_FLIGHTS';
            updateUser(targetUser.mobile, targetUser);
            if (aiResponse.reply) {
              targetUser.messages.push({ role: 'bot', text: aiResponse.reply, time: Date.now() });
              updateUser(targetUser.mobile, targetUser);
              await sendMessage(targetUser.mobile, aiResponse.reply);
            }
            await executeFlightSearchWorkflow(targetUser.mobile, targetUser);
            return;
          }

          if (aiResponse.proceedToPayment) {
            targetUser.state = 'PAYMENT';
            updateUser(targetUser.mobile, targetUser);
            await sendPaymentSummary(targetUser.mobile, targetUser, async (msg) => {
              targetUser.messages.push({ role: 'bot', text: msg, time: Date.now() });
              updateUser(targetUser.mobile, targetUser);
              await sendMessage(targetUser.mobile, msg);
            });
            return;
          }

          // 4. Handle User-Facing Message (Skip if cmd is ASK, unless admin_reply was empty)
          if (aiResponse.reply) {
            const isInternalAck = /^(acknowledged|okay|ok|done|sure|i will|noted|acknowledged\.)/i.test(aiResponse.reply.toLowerCase().trim());
            
            if (cmd === 'WHISPER') {
              if (!isInternalAck || aiResponse.reply !== aiResponse.admin_reply) {
                targetUser.messages.push({ role: 'bot', text: aiResponse.reply, time: Date.now() });
                updateUser(targetUser.mobile, targetUser);
                await sendMessage(targetUser.mobile, aiResponse.reply);
              }
            } else if (cmd === 'ASK') {
              if (!aiResponse.admin_reply) {
                targetUser.messages.push({ role: 'bot', text: aiResponse.reply, isAdminOnly: true, time: Date.now() });
                updateUser(targetUser.mobile, targetUser);
                await sendMessage(ADMIN_NUMBER, `🤖 *Manoj says:* ${aiResponse.reply}`);
              }
            }
          }
        }
      } else {
        await sendMessage(ADMIN_NUMBER, `Could not identify user. Use: ${cmd} <mobile/name> <msg>`);
      }
      return;
    }
  }

  const user = getUser(mobile);
  const msgObj = { role: 'user', text: cleanText, time: Date.now() };
  if (base64Image) {
    msgObj.hasImage = true;
    msgObj.base64Image = base64Image;
  }
  user.messages.push(msgObj);
  updateUser(mobile, { messages: user.messages, lastMessageAt: new Date().toISOString() });

  if (mediaId && typeof mediaId === 'string' && mediaId.length > 5 && !processedMediaIds.has(mediaId)) {
    processedMediaIds.add(mediaId);
    setLastAdminTarget(mobile);
    await sendMessage(ADMIN_NUMBER, `⚠️ *ATTENTION: IMAGE RECEIVED*\n📱 User: ${mobile}`);
    await sendImageById(ADMIN_NUMBER, mediaId, `Image from ${mobile}`);
  }

  if (user.messages.length === 1) {
    setLastAdminTarget(mobile);
    await sendMessage(ADMIN_NUMBER, `👋 *NEW CHAT STARTED*\n📱 User: ${mobile}\n💬 Msg: ${cleanText}`);
  }

  if (user.isHumanOverride) return;

  if (['SELECT_FLIGHT', 'COLLECT_DETAILS', 'PAYMENT'].includes(user.state) && user.data.flightSearchTime) {
    const elapsed = (Date.now() - user.data.flightSearchTime) / (1000 * 60);
    if (elapsed > 30) {
      user.state = 'SEARCHING_FLIGHTS';
      user.data.flightSearchTime = null;
      user.data.flightNumberSelected = null;
      updateUser(mobile, user);
      const timeoutMsg = "⏳ I'm sorry, but flight prices change frequently and your previous session has expired. Giving you fresh results... 🔄";
      user.messages.push({ role: 'bot', text: timeoutMsg, time: Date.now() });
      await sendMessage(mobile, timeoutMsg);
      await executeFlightSearchWorkflow(mobile, user);
      return;
    }
  }

  if (cleanText.toLowerCase() === 'reset' || cleanText.toLowerCase() === 'clear') {
    resetUser(mobile);
    const reply = "✨ We've restarted the flow. Where do you want to travel?";
    user.messages.push({ role: 'bot', text: reply, time: Date.now() });
    await sendMessage(mobile, reply);
    return;
  }

  async function sendBotMessage(msg) {
    user.messages.push({ role: 'bot', text: msg, time: Date.now() });
    updateUser(mobile, { messages: user.messages });
    await sendMessage(mobile, msg);
  }

  const hasAI = !!process.env.OPENAI_API_KEY;

  if (user.state === 'SELECT_FLIGHT' && /details|view|show\s+details/i.test(cleanText)) {
    await sendFlightListResults(mobile, user, sendBotMessage);
    return;
  }

  if (user.state === 'SELECT_FLIGHT') {
    let selection = -1;
    if (cleanText.startsWith('flight_')) {
      selection = parseInt(cleanText.replace('flight_', ''), 10);
    } else {
      selection = Number(cleanText);
    }
    if (!isNaN(selection) && selection >= 1 && selection <= user.flights.length) {
      const selected = user.flights[selection - 1];
      const paxCount = parseInt(user.data.passengers) || 1;
      user.data.price = selected.price * paxCount;
      user.data.flightNumberSelected = selected.flights[0].flight_number;
      user.state = 'COLLECT_DETAILS';
      updateUser(mobile, user);

      // Send MakeMyTrip screenshot upon selection
      if (selected.screenshotUrl && user.data.baseUrl) {
        const absoluteUrl = `${user.data.baseUrl}${selected.screenshotUrl}`;
        console.log(`[Flow Controller]: Sending MMT selected flight screenshot to ${mobile}: ${absoluteUrl}`);
        try {
          const { sendImageMessage } = require('../services/whatsapp');
          await sendImageMessage(mobile, absoluteUrl, `📸 Live MakeMyTrip fare confirmation for Option ${selection}!`);
        } catch (imgErr) {
          console.error("Failed to send selected MMT screenshot:", imgErr.message);
        }
      }

      const depTime = selected.flights[0]?.departure_airport?.time || 'N/A';
      const arrTime = selected.flights[selected.flights.length - 1]?.arrival_airport?.time || 'N/A';
      const durationHr = Math.floor((selected.total_duration || 0) / 60);
      const durationMin = (selected.total_duration || 0) % 60;
      
      let baseMsg = `✅ *Flight Selected: ${selected.flights[0].airline} ${selected.flights[0].flight_number}*\n\n` +
        `📅 *Date:* ${user.data.date}\n` +
        `📍 *Route:* ${user.data.from} → ${user.data.to}\n` +
        `⏰ *Time:* ${depTime} – ${arrTime} (${durationHr}h ${durationMin}m)\n` +
        `💰 *Total Price:* ₹${user.data.price} (for ${paxCount} pax)\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n`;

      let missingInfo = [];
      if (!user.data.email) missingInfo.push("email address");
      if (!user.passengerNames || user.passengerNames.length === 0) missingInfo.push("full names of all passengers");

      if (missingInfo.length === 0) {
        user.state = 'PAYMENT';
        updateUser(mobile, user);
        await sendBotMessage(baseMsg + "Excellent! I have all your details. Proceeding to payment summary...");
        await sendPaymentSummary(mobile, user, sendBotMessage);
        return;
      }

      const promptText = `To finalize your booking, please share the **${missingInfo.join(" and ")}**.`;
      await sendBotMessage(baseMsg + promptText);
      return;
    }
  }

  if (user.state === 'PAYMENT') {
    if (cleanText.toLowerCase().includes('payment') || cleanText.toLowerCase().includes('done')) {
      user.state = 'DONE';
      await saveBooking(user);
      await sendBotMessage("🎉 Thank you! Your payment is being verified by our team. You will receive your e-ticket within 2 hours. ✈️");

      setLastAdminTarget(mobile);
      const adminMsg = `🚨 *URGENT: NEW PAYMENT RECEIVED*\n📱 User: ${mobile}\n👤 Names: ${user.passengerNames.join(', ')}\n✈️ Route: ${user.data.from} → ${user.data.to}\n🗓️ Date: ${user.data.date}\n💰 Amount: ₹${user.data.price}\n🆔 Flight: ${user.data.flightNumberSelected}\n\n*To confirm via WhatsApp*, reply exactly with:\nCONFIRM ${mobile} <Seat_Numbers>`;
      await sendMessage(ADMIN_NUMBER, adminMsg);
      updateUser(mobile, user);
      return;
    }
  }

  if (hasAI) {
    const aiResult = await processWithAI(user, cleanText, base64Image);
    if (aiResult) {
      if (aiResult.humanEscalation) {
        setLastAdminTarget(mobile);
        await sendMessage(ADMIN_NUMBER, `🆘 *HUMAN ESCALATION REQUESTED*\n📱 User: ${mobile}\n💬 Msg: "${cleanText}"`);
        await sendBotMessage("I have addressed a message to the senior but I am here if you want any help with your booking!");
      }
      const parsed = aiResult.parsed;
      // Persist flags to avoid repeated nudges
      if (parsed.preferred_airline) {
        user.data.luggageNudgeDone = true; // user was nudged/accepted 46kg option
      }
      if (parsed.targetFlightDetails) {
        user.data.screenshotNudgeDone = true; // exact flight screenshot processed
      }
      if (parsed.fromCode) user.data.from = parsed.fromCode;
      else if (parsed.fromText) user.data.from = getIATACode(parsed.fromText) || user.data.from;
      if (parsed.toCode) user.data.to = parsed.toCode;
      else if (parsed.toText) user.data.to = getIATACode(parsed.toText) || user.data.to;
      if (parsed.email) user.data.email = parsed.email;
      if (parsed.passengers) user.data.passengers = parsed.passengers;
      if (parsed.date) user.data.date = parsed.date;
      if (parsed.preference) user.data.preference = parsed.preference;
      if (parsed.preferred_airline) {
        user.data.preferred_airline = (parsed.preferred_airline.toLowerCase() === 'any') ? null : parsed.preferred_airline;
      }
      if (parsed.targetFlightDetails) user.data.targetFlightDetails = parsed.targetFlightDetails;
      if (parsed.flightNumberSelected) user.data.flightNumberSelected = parsed.flightNumberSelected;
      if (parsed.price) user.data.price = parsed.price;
      if (parsed.extractedNames) {
        let uniqueNames = Array.from(new Set([...user.passengerNames, ...parsed.extractedNames]));
        if (user.data.passengers && uniqueNames.length > user.data.passengers) {
          uniqueNames = uniqueNames.slice(0, user.data.passengers);
        }
        user.passengerNames = uniqueNames;
      }
      if (parsed.price_markup_percent !== undefined) user.data.price_markup = parsed.price_markup_percent;
      updateUser(mobile, user);

      if (aiResult.searchFlightsNow) {
        if (!user.data.from || !user.data.to) {
          await sendBotMessage("I couldn't recognise the origin/destination airport. Could you please rephrase it?");
          return;
        }
        user.state = 'SEARCHING_FLIGHTS';
        updateUser(mobile, user);
        if (aiResult.reply) {
            await sendBotMessage(aiResult.reply);
        }
        await executeFlightSearchWorkflow(mobile, user);
        return;
      }

      if (aiResult.proceedToPayment) {
        user.state = 'PAYMENT';
        updateUser(mobile, user);
        await sendPaymentSummary(mobile, user, sendBotMessage);
        return;
      }

      await sendBotMessage(aiResult.reply || "Thinking...");
      return;
    }
  }

  if (user.state === 'DONE') {
    await sendBotMessage("Your payment is currently being verified. You will receive your e-ticket within 2 hours. Type 'reset' if you want to book another flight.");
    return;
  }

  const parsedInput = parseInput(cleanText);
  if (parsedInput.email) user.data.email = parsedInput.email;
  if (parsedInput.passengers) user.data.passengers = parsedInput.passengers;
  if (parsedInput.date) user.data.date = parsedInput.date;
  if (parsedInput.fromText) user.data.from = getIATACode(parsedInput.fromText) || user.data.from;
  if (parsedInput.toText) user.data.to = getIATACode(parsedInput.toText) || user.data.to;

  if (!user.data.from || !user.data.to) {
    user.state = 'ASK_ROUTE';
    updateUser(mobile, user);
    await sendBotMessage("Hello! My name is Manoj from Hopspot Travel. How can I help you with your travel plans?");
    return;
  }
  if (!user.data.date) {
    user.state = 'ASK_DATE';
    updateUser(mobile, user);
    await sendBotMessage(`🌍 Got it! ${user.data.from} ✈️ ${user.data.to}. What date are you looking to travel?`);
    return;
  }
  if (!user.data.passengers) {
    user.state = 'ASK_PASSENGERS';
    updateUser(mobile, user);
    await sendBotMessage("👥 Perfect. How many passengers are traveling?");
    return;
  }
  if (!user.flights || user.flights.length === 0) {
    await sendBotMessage("🔍 Finding best flight options...");
    await executeFlightSearchWorkflow(mobile, user);
    return;
  }
}

async function sendPaymentSummary(mobile, user, sendBotMessage) {
  let summaryMsg = `✈️ *Booking Summary*\n\n`;
  summaryMsg += `👥 Passengers: ${user.passengerNames.join(", ")}\n`;
  summaryMsg += `Route: ${user.data.from} to ${user.data.to}\n`;
  summaryMsg += `💰 Total: ₹${user.data.price} (for ${user.data.passengers || 1} pax)\n\n`;
  summaryMsg += `━━━━━━━━━━━━━━━\nPAYMENT DETAILS\n━━━━━━━━━━━━━━━\n\n`;
  summaryMsg += `*Bank Transfer:*\nHopspot Travel Technologies\nA/C - 50200115250690\nIFSC - HDFC0001102\n\n`;
  summaryMsg += `*UPI:*\n6291439202@pthdfc\n\n`;
  summaryMsg += `*Razorpay / Cards:*\nhttps://razorpay.me/@hopspottraveltechnologiesllp\n\n`;
  summaryMsg += `━━━━━━━━━━━━━━━\n\nReply *"payment done"* once completed.`;
  await sendBotMessage(summaryMsg);
}

async function executeFlightSearchWorkflow(mobile, user) {
  const { sendMessage, sendImageMessage } = require('../services/whatsapp');
  try {
    const flights = await searchFlights(user.data);

    // Screenshots are now captured sequentially in the scraper and sent in sendFlightListResults

    if (!flights || flights.length === 0) {
      user.state = 'ASK_ROUTE';
      updateUser(mobile, user);
      await sendMessage(mobile, "😕 Sorry, I couldn't find any flights for that route/date. Please double check the cities and travel date.");
      return;
    }

    let availableFlights = [...flights];

    // Prioritize target flight from screenshot if exists
    if (user.data.targetFlightDetails) {
      const target = user.data.targetFlightDetails;
      const targetTime = target.departureTime || "";
      const targetAir = (target.airline || "").toLowerCase();
      
      const exactIdx = availableFlights.findIndex(f => {
        const leg = f.flights[0];
        const airMatch = leg.airline.toLowerCase().includes(targetAir);
        const timeMatch = (leg.departure_airport?.time || "").includes(targetTime);
        return airMatch && timeMatch;
      });

      if (exactIdx > -1) {
        const [matched] = availableFlights.splice(exactIdx, 1);
        availableFlights.unshift(matched); // Move exact match to top
      }
    }

    if (user.data.preferred_airline) {
      const prefAir = user.data.preferred_airline.toLowerCase().trim();
      const matches = availableFlights.filter(f => f.flights[0].airline.toLowerCase().includes(prefAir));
      if (matches.length > 0) availableFlights = matches;
    }

    const picks = availableFlights.slice(0, 5);
    user.flights = picks;
    user.state = 'SELECT_FLIGHT';
    user.data.flightSearchTime = Date.now();
    updateUser(mobile, user);

    await sendFlightListResults(mobile, user, async (msg) => {
      user.messages.push({ role: 'bot', text: msg, time: Date.now() });
      updateUser(mobile, { messages: user.messages });
      await sendMessage(mobile, msg);
    });
  } catch (err) {
    console.error("Workflow Error:", err);
    await sendMessage(mobile, "⚠️ I'm having a technical glitch searching for flights. Please try again in a moment.");
  }
}

async function sendFlightListResults(mobile, user, sendBotMessage) {
  const picks = user.flights;
  const { sendImageMessage, sendListMessage } = require('../services/whatsapp');

  await sendBotMessage(`✈️ *Top Flight Picks:*\n*${user.data.from}* ➔ *${user.data.to}*  |  🗓️ ${user.data.date}\n━━━━━━━━━━━━━━━━━━━━\nLoading visual confirmations...`);

  // Send screenshots sequentially
  for (let index = 0; index < picks.length; index++) {
    const f = picks[index];
    const leg = f.flights[0];
    const totalPrice = f.price * (parseInt(user.data.passengers) || 1);
    
    if (f.screenshotUrl && user.data.baseUrl) {
      const absoluteUrl = `${user.data.baseUrl}${f.screenshotUrl}`;
      const caption = `✈️ *Option ${index + 1}*: ${leg?.airline}\n💰 ₹${totalPrice}\n⏰ ${leg?.departure_airport?.time} - ${f.flights[f.flights.length - 1]?.arrival_airport?.time}`;
      console.log(`[Flow Controller]: Sending image for Option ${index + 1}: ${absoluteUrl}`);
      try {
        await sendImageMessage(mobile, absoluteUrl, caption);
        // Small delay to ensure sequential delivery order in WhatsApp
        await new Promise(res => setTimeout(res, 500));
      } catch (err) {
        console.error(`Failed to send screenshot for Option ${index + 1}:`, err.message);
      }
    }
  }

  let detailsMsg = `━━━━━━━━━━━━━━━━━━━━\nReview the flight cards above and select an option below 👇`;
  await sendBotMessage(detailsMsg);

  const rows = picks.map((f, i) => ({
    id: `flight_${i + 1}`,
    title: `Option ${i + 1}`,
    description: `${f.flights[0]?.airline} · ₹${f.price * (parseInt(user.data.passengers) || 1)}`.substring(0, 72)
  }));
  await sendListMessage(mobile, "Hopspot Flights", "Tap to pick your flight.", "Select Flight", [{ title: "Available Flights", rows }]);
}

module.exports = { handleIncomingMessage };
