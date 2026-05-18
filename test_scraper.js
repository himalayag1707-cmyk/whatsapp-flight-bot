require('dotenv').config();
const { scrapeMMT } = require('./services/mmtScrapingBrowserService');

async function test() {
  console.log("Starting scraper test...");
  const data = {
    from: 'DEL',
    to: 'YYZ',
    date: '2026-05-30'
  };
  
  const results = await scrapeMMT(data);
  console.log("Final Results Length:", results.length);
  if (results.length > 0) {
    console.log("Screenshot URL:", results[0].screenshotUrl);
  }
}

test();
