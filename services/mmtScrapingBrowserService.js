const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// Ensure screenshots directory exists
const screenshotsDir = path.join(__dirname, '../public/screenshots');
if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Custom wait helper to avoid deprecated waitForTimeout
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Robust MakeMyTrip Scraper using Bright Data Scraping Browser
 */
async function scrapeMMT(data) {
  if (!process.env.BRIGHTDATA_WS_ENDPOINT) {
    console.log("[MMT Scraper]: BRIGHTDATA_WS_ENDPOINT missing. Skipping Scraping Browser search.");
    return [];
  }

  // Format date: YYYY-MM-DD -> DD/MM/YYYY
  const [year, month, day] = data.date.split('-');
  const formattedDate = `${day}/${month}/${year}`;
  
  const fromCode = data.from.toUpperCase();
  const toCode = data.to.toUpperCase();
  
  // Construct MMT Flight Search URL
  const url = `https://www.makemytrip.com/flight/search?itinerary=${fromCode}-${toCode}-${formattedDate}&tripType=O&paxType=A-1_C-0_I-0&intl=true&cabinClass=E`;
  
  console.log(`[MMT Scraper]: Launching Bright Data Scraping Browser for ${fromCode} -> ${toCode} on ${formattedDate}`);
  console.log(`[MMT Scraper]: Target URL: ${url}`);

  let browser;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: process.env.BRIGHTDATA_WS_ENDPOINT,
    });
    
    const page = await browser.newPage();
    
    // Set a realistic viewport size for screenshots
    await page.setViewport({ width: 1280, height: 1000 });
    
    // Navigate to MMT
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    console.log("[MMT Scraper]: Page loaded. Waiting for results to render...");
    
    // Wait for the main listings or error pages
    try {
        await page.waitForSelector('.listingCard, [class*="listingCard"], [id*="listing-card"]', { timeout: 15000 });
    } catch (e) {
        console.log("[MMT Scraper]: Standard listingCard selector not found, attempting fallback wait.");
        await delay(5000); // safety fallback wait
    }

    // Dismiss common popups/overlays by injecting CSS to hide them
    await page.evaluate(() => {
        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = `
            .commonOverlay, [class*="overlay"], [class*="Popup"], [class*="Modal"], [class*="tooltip"] {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    });

    console.log("[MMT Scraper]: Parsing flight details...");

    // Extract flights from DOM
    const flights = await page.evaluate(() => {
        const results = [];
        const cards = Array.from(document.querySelectorAll('.listingCard, [class*="listingCard"], [id*="listing-card"]'));
        
        cards.forEach((card, index) => {
            try {
                // Airline & Flight Number
                const airlineEl = card.querySelector('.airlineName, .airInfoName, [class*="airlineName"]');
                const airline = airlineEl ? airlineEl.innerText.trim() : 'Unknown Airline';
                
                const fliNoEl = card.querySelector('.fliCode, [class*="fliCode"]');
                const flight_number = fliNoEl ? fliNoEl.innerText.trim() : 'N/A';

                // Price
                const priceEl = card.querySelector('.actual-price, [class*="actual-price"], .price, [class*="price"]');
                let priceText = priceEl ? priceEl.innerText.replace(/[^\d]/g, '') : '';
                const price = priceText ? parseInt(priceText, 10) : 0;

                // Times & Duration
                const times = Array.from(card.querySelectorAll('.depTime, .arrTime, [class*="depTime"], [class*="arrTime"]')).map(el => el.innerText.trim());
                const departure_time = times[0] || 'N/A';
                const arrival_time = times[1] || 'N/A';

                const durationEl = card.querySelector('.stop-info, [class*="stop-info"], .duration, [class*="duration"]');
                const total_duration = durationEl ? durationEl.innerText.trim() : 'N/A';

                // Stops
                const stopsEl = card.querySelector('.stopsInfo, [class*="stopsInfo"]');
                const stops = stopsEl ? stopsEl.innerText.trim() : 'Non-stop';

                results.push({
                    index,
                    airline,
                    flight_number,
                    price,
                    departure_time,
                    arrival_time,
                    total_duration,
                    stops,
                    luggage: "Standard MMT Allowance", // Will enrich first flight if detailed
                    visa: ""
                });
            } catch (err) {
                // Ignore parsing errors for individual cards
            }
        });
        
        return results;
    });

    console.log(`[MMT Scraper]: Successfully parsed ${flights.length} flights.`);

    if (flights.length === 0) {
        console.log("[MMT Scraper]: No flights parsed. Capturing debug screenshot.");
        const debugPath = path.join(screenshotsDir, `debug_failed_${Date.now()}.png`);
        await page.screenshot({ path: debugPath });
        return [];
    }

    // Try to get detailed luggage info for the first/best flight
    try {
        console.log("[MMT Scraper]: Attempting to extract detailed baggage info for the top flight...");
        
        // Find and click "Flight Details" on the first card
        const detailsButton = await page.$('.flightDetails, [class*="flightDetails"], span.flightDetails');
        if (detailsButton) {
            await detailsButton.click();
            await delay(2000); // Wait for details tab to load
            
            // Extract baggage and visa rules if visible
            const detailsData = await page.evaluate(() => {
                let luggageInfo = "";
                let visaInfo = "";
                
                // Look for baggage tabs or table
                const tables = Array.from(document.querySelectorAll('table'));
                tables.forEach(table => {
                    const text = table.innerText.toLowerCase();
                    if (text.includes('baggage') || text.includes('check-in') || text.includes('cabin')) {
                        luggageInfo = table.innerText.replace(/\n+/g, ' | ').trim();
                    }
                });

                // Look for visa alerts/warnings
                const warnings = Array.from(document.querySelectorAll('[class*="warning"], [class*="alert"], [class*="visa"]'));
                warnings.forEach(w => {
                    if (w.innerText.toLowerCase().includes('visa')) {
                        visaInfo = w.innerText.trim();
                    }
                });

                return { luggageInfo, visaInfo };
            });

            if (detailsData.luggageInfo) {
                console.log("[MMT Scraper]: Successfully extracted detailed luggage:", detailsData.luggageInfo);
                flights[0].luggage = detailsData.luggageInfo;
            }
            if (detailsData.visaInfo) {
                console.log("[MMT Scraper]: Successfully extracted visa warning:", detailsData.visaInfo);
                flights[0].visa = detailsData.visaInfo;
            }
            
            // Close details to ensure a clean screenshot
            await detailsButton.click();
            await delay(500);
        }
    } catch (detErr) {
        console.log("[MMT Scraper]: Optional details extraction failed or skipped:", detErr.message);
    }

    // Capture screenshot of the first few results
    const screenshotName = `mmt_${fromCode}_${toCode}_${Date.now()}.png`;
    const screenshotPath = path.join(screenshotsDir, screenshotName);
    
    console.log(`[MMT Scraper]: Saving screenshot to ${screenshotPath}`);
    await page.screenshot({ path: screenshotPath });

    // Expose the public URL path
    const screenshotUrl = `/screenshots/${screenshotName}`;

    // Format results to standard schema
    const formattedResults = flights.map(f => ({
      flights: [{
        airline: f.airline,
        flight_number: f.flight_number,
        departure_airport: { time: f.departure_time },
        arrival_airport: { time: f.arrival_time }
      }],
      price: f.price,
      total_duration: f.total_duration,
      luggage: f.luggage,
      visa: f.visa,
      source: 'MakeMyTrip',
      screenshotUrl: screenshotUrl // Attach screenshot link
    }));

    return formattedResults;

  } catch (error) {
    console.error("[MMT Scraper Error]:", error.message);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { scrapeMMT };
