const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// Ensure screenshots directory exists
const screenshotsDir = path.join(__dirname, '../public/screenshots');
if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Custom wait helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Advanced MMT Scraper - Visual Booking Flow
 * Deep navigates into "View Prices" -> "Book Now" -> Captures Trip Summary
 */
async function scrapeMMT(data) {
  if (!process.env.BRIGHTDATA_WS_ENDPOINT) {
    console.log("[MMT Scraper]: BRIGHTDATA_WS_ENDPOINT missing. Skipping.");
    return [];
  }

  const [year, month, day] = data.date.split('-');
  const formattedDate = `${day}/${month}/${year}`;
  const fromCode = data.from.toUpperCase();
  const toCode = data.to.toUpperCase();
  
  const url = `https://www.makemytrip.com/flight/search?itinerary=${fromCode}-${toCode}-${formattedDate}&tripType=O&paxType=A-1_C-0_I-0&intl=true&cabinClass=E`;
  
  console.log(`[MMT Scraper]: Launching Bright Data Scraping Browser (Visual Flow)`);
  console.log(`[MMT Scraper]: Target URL: ${url}`);

  let browser;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: process.env.BRIGHTDATA_WS_ENDPOINT,
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000 });
    
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (gotoErr) {
        console.log("[MMT Scraper]: Page goto timed out or failed, but attempting to parse anyway...");
    }
    console.log("[MMT Scraper]: Page loaded. Waiting for results...");
    
    try {
        await page.waitForSelector('.listingCard, [class*="listingCard"], [id*="listing-card"], .fli-list, .clusterView, [class*="cluster"]', { timeout: 15000 });
    } catch (e) {
        console.log("[MMT Scraper]: Standard listingCard selector not found, attempting fallback wait.");
        await delay(5000);
    }

    // Hide overlays on main page
    await page.evaluate(() => {
        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = `
            .commonOverlay, [class*="overlay"], [class*="Popup"], [class*="Modal"], [class*="tooltip"] { display: none !important; }
        `;
        document.head.appendChild(style);
    });

    console.log("[MMT Scraper]: Parsing top flight details...");

    // Extract basic flight info for all cards
    let flights = await page.evaluate(() => {
        const results = [];
        const cards = Array.from(document.querySelectorAll('.listingCard, [class*="listingCard"], [id*="listing-card"], .fli-list, .clusterView, [class*="cluster"]'));
        
        cards.forEach((card, index) => {
            try {
                const airlineEl = card.querySelector('.airlineName, .airInfoName, [class*="airlineName"]');
                const airline = airlineEl ? airlineEl.innerText.trim() : 'Unknown Airline';
                
                const fliNoEl = card.querySelector('.fliCode, [class*="fliCode"]');
                const flight_number = fliNoEl ? fliNoEl.innerText.trim() : 'N/A';

                const priceEl = card.querySelector('.actual-price, [class*="actual-price"], .price, [class*="price"]');
                let priceText = priceEl ? priceEl.innerText.replace(/[^\d]/g, '') : '';
                const price = priceText ? parseInt(priceText, 10) : 0;

                const times = Array.from(card.querySelectorAll('.depTime, .arrTime, [class*="depTime"], [class*="arrTime"]')).map(el => el.innerText.trim());
                const departure_time = times[0] || 'N/A';
                const arrival_time = times[1] || 'N/A';

                const durationEl = card.querySelector('.stop-info, [class*="stop-info"], .duration, [class*="duration"]');
                const total_duration = durationEl ? durationEl.innerText.trim() : 'N/A';

                const stopsEl = card.querySelector('.stopsInfo, [class*="stopsInfo"]');
                const stops = stopsEl ? stopsEl.innerText.trim() : 'Non-stop';

                results.push({ index, airline, flight_number, price, departure_time, arrival_time, total_duration, stops });
            } catch (err) {}
        });
        return results;
    });

    if (flights.length === 0) return [];

    // Filter to Target Match OR Top 4
    let targetIndices = [];
    if (data.targetFlightDetails) {
        console.log(`[MMT Scraper]: Exact Match Requested for: ${data.targetFlightDetails.airline} at ${data.targetFlightDetails.departureTime}`);
        const targetAir = (data.targetFlightDetails.airline || "").toLowerCase();
        const targetTime = data.targetFlightDetails.departureTime || "";
        
        const exactIdx = flights.findIndex(f => {
            return f.airline.toLowerCase().includes(targetAir) && f.departure_time.includes(targetTime);
        });
        
        if (exactIdx > -1) {
            targetIndices = [exactIdx];
            console.log(`[MMT Scraper]: Found Exact Match at index ${exactIdx}!`);
        } else {
            console.log(`[MMT Scraper]: Exact Match NOT found. Falling back to top 4.`);
            targetIndices = [0, 1, 2, 3].filter(i => i < flights.length);
        }
    } else {
        // Pick Top 4 Options
        targetIndices = [0, 1, 2, 3].filter(i => i < flights.length);
    }

    const finalFlights = [];
    const searchResultsUrl = await page.url();

    // Deep Navigation Loop
    for (let i = 0; i < targetIndices.length; i++) {
        const flightIdx = targetIndices[i];
        const flightData = flights[flightIdx];
        console.log(`\n[MMT Scraper]: Deep navigating Option ${i+1}/${targetIndices.length} (Index ${flightIdx}) - ${flightData.airline}`);

        try {
            // Re-select cards (DOM might have updated if we closed a modal)
            const cards = await page.$$('.listingCard, [class*="listingCard"], [id*="listing-card"], .fli-list, .clusterView, [class*="cluster"]').catch(() => []);
            if (!cards[flightIdx]) {
                console.log(`[MMT Scraper]: Could not re-select card at index ${flightIdx}. Skipping visual grab.`);
                finalFlights.push(flightData);
                continue;
            }
            
            const card = cards[flightIdx];
            
            // 1. Click 'View Prices'
            let viewPricesBtn = await card.$('.viewFareBtn, [class*="viewFare"], button, a.viewFareBtn').catch(() => null); 
            if (!viewPricesBtn) {
                viewPricesBtn = await card.$('.priceSection, [class*="price"]').catch(() => null);
            }
            if (!viewPricesBtn) {
                console.log("[MMT Scraper]: View Prices button not found. Skipping visual grab.");
                finalFlights.push(flightData);
                continue;
            }
            
            const pagesBeforeView = await browser.pages();
            await page.evaluate(el => el.scrollIntoView({block: "center"}), viewPricesBtn).catch(() => {});
            await delay(1000);
            
            // Click and catch if it destroys context or fails
            await viewPricesBtn.click().catch(() => {});
            console.log("  -> Clicked 'View Prices'");
            
            // Wait for fare modal/section OR new tab
            await delay(4000);

            let pagesAfterView = await browser.pages();
            let reviewPage = null;
            let isNewTab = false;

            if (pagesAfterView.length > pagesBeforeView.length) {
                console.log("  -> 'View Prices' immediately opened a new tab! Bypassing 'Book Now'.");
                reviewPage = pagesAfterView[pagesAfterView.length - 1];
                isNewTab = true;
            } else {
                // 2. Find 'Book Now' button in the expanded fare options
                // We scope the search strictly to the current card to avoid clicking another flight's button
                const bookNowBtns = await card.$$('button, a, input').catch(() => []);
                let targetBookBtn = null;
                
                for (const btn of bookNowBtns) {
                    const text = await page.evaluate(el => el.innerText || el.value || '', btn).catch(() => '');
                    const className = await page.evaluate(el => el.className || '', btn).catch(() => '');
                    const cleanText = text.toUpperCase().trim();
                    const cleanClass = className.toLowerCase();
                    
                    if (cleanText.includes('BOOK') || cleanText.includes('CONTINUE') || cleanText.includes('SELECT') || cleanClass.includes('booknow') || cleanClass.includes('farebtn')) {
                        targetBookBtn = btn;
                        if (cleanText.includes('BOOK')) break; // Prefer explicit 'BOOK' text
                    }
                }

                if (targetBookBtn) {
                    const pagesBeforeBook = await browser.pages();
                    await page.evaluate(el => el.scrollIntoView({block: "center"}), targetBookBtn).catch(() => {});
                    await delay(500);
                    await targetBookBtn.click().catch(() => {});
                    console.log("  -> Clicked 'Book Now'");
                    
                    await delay(5000); // Give MMT time to open new tab
                    
                    const pagesAfterBook = await browser.pages();
                    if (pagesAfterBook.length > pagesBeforeBook.length) {
                        reviewPage = pagesAfterBook[pagesAfterBook.length - 1];
                        isNewTab = true;
                        console.log("  -> Detected new tab for Trip Summary.");
                    } else {
                        reviewPage = page;
                        console.log("  -> Loaded Trip Summary in the same tab.");
                    }
                } else {
                    console.log("  -> 'Book Now' button not found. Taking screenshot of current page as fallback.");
                    reviewPage = page;
                }
            }

            // 4. Prepare Review Page
            await reviewPage.setViewport({ width: 1280, height: 1200 }).catch(() => {}); 
            await reviewPage.bringToFront().catch(() => {});
            
            // Wait for core elements to render
            try {
                await reviewPage.waitForSelector('.fareSummary, [class*="fareSummary"], .review-page, [class*="tripSummary"]', { timeout: 10000 });
            } catch (e) {
                console.log("  -> Wait for review page elements timed out. Proceeding anyway.");
            }

            // Hide popups on review page
            await reviewPage.evaluate(() => {
                const style = document.createElement('style');
                style.type = 'text/css';
                style.innerHTML = `
                    .commonOverlay, [class*="overlay"], [class*="Popup"], [class*="Modal"], [class*="login"], [class*="insurance"], [class*="FARE_RULES"] { display: none !important; }
                `;
                document.head.appendChild(style);
            }).catch(() => {});
            await delay(2000);

            // 5. Take Screenshot
            const screenshotName = `mmt_summary_${fromCode}_${toCode}_${flightIdx}_${Date.now()}.png`;
            const screenshotPath = path.join(screenshotsDir, screenshotName);
            
            await reviewPage.screenshot({ path: screenshotPath });
            console.log(`  -> Saved Booking Review screenshot: ${screenshotName}`);
            
            flightData.screenshotUrl = `/screenshots/${screenshotName}`;
            finalFlights.push(flightData);

            // 6. Cleanup Context
            if (isNewTab) {
                await reviewPage.close().catch(() => {});
                await page.bringToFront().catch(() => {});
            } else {
                if (page.url() !== searchResultsUrl) {
                    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
                }
            }
            
            await delay(2000); // Let main page settle before next iteration

        } catch (err) {
            console.log(`  -> Failed deep navigation for Option ${i+1}:`, err.message);
            // If it failed, we still want to add the text data as a fallback
            if (!flightData.screenshotUrl) {
                finalFlights.push(flightData);
            }
            // Ensure we are back on the main page context
            try {
                const currentPages = await browser.pages();
                if (currentPages.length > 1) {
                    await currentPages[currentPages.length - 1].close().catch(() => {});
                }
                await page.bringToFront().catch(() => {});
            } catch (e) {}
        }
    }

    // Format results
    const formattedResults = finalFlights.map((f, i) => ({
      // We attach the option ID (1, 2, 3, 4) for WhatsApp referencing
      optionId: i + 1,
      flights: [{
        airline: f.airline,
        flight_number: f.flight_number,
        departure_airport: { time: f.departure_time },
        arrival_airport: { time: f.arrival_time }
      }],
      price: f.price,
      total_duration: f.total_duration,
      stops: f.stops,
      source: 'MakeMyTrip',
      screenshotUrl: f.screenshotUrl 
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
