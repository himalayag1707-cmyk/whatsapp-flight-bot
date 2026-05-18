const { parseConversation } = require('./services/aiService');

async function test() {
  const history = [
    { role: 'user', text: 'delhi to bombay 1 passenger no screenshot 30 may' },
    { role: 'bot', text: 'For this route, would you like me to find options with a higher baggage allowance (46kg / 2 bags)?' },
    { role: 'user', text: 'no' }
  ];
  
  const result = await parseConversation(history);
  console.log("Parsed Result:", JSON.stringify(result, null, 2));
}

test();
