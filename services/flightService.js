const axios = require('axios');
const { searchMystifly } = require('./mystiflyService');

async function searchFlights(data) {
  try {
    // 1. Try Mystifly Primary (Professional GDS/LCC Data)
    if (process.env.MYSTIFLY_USERNAME) {
        console.log(`[Flight Service]: Searching Mystifly for ${data.from} -> ${data.to}`);
        const mystiflyResults = await searchMystifly(data);
        if (mystiflyResults.length > 0) {
            // Transform Mystifly format to match bot's display format
            const transformed = mystiflyResults.map(f => ({
                flights: [{
                    airline: f.airline,
                    flight_number: f.flight_number,
                    departure_airport: { time: f.depTime },
                    arrival_airport: { time: f.arrTime }
                }],
                price: f.price,
                total_duration: f.duration,
                luggage: f.luggage,
                source: "Mystifly"
            }));
            return finalizeAndPrioritize(transformed, data);
        }
    }

    // 2. Fallback to SerpApi (Google Flights)
    console.log(`[Flight Service]: Running SerpApi Fallback for ${data.from} -> ${data.to}`);

    const params = {
        engine: "google_flights",
        departure_id: data.from,
        arrival_id: data.to,
        outbound_date: data.date,
        type: 2, 
        adults: data.passengers || 1, 
        currency: "INR",
        hl: "en",
        gl: "in",
        api_key: process.env.SERPAPI_KEY
    };
    
    if (data.preference === 'Premium') params.travel_class = 3;

    const res = await axios.get("https://serpapi.com/search.json", { params });
    const all = [...(res.data.best_flights || []), ...(res.data.other_flights || [])];
    
    // Filter unique flights and add metadata
    const results = [];
    const seen = new Set();
    for (const f of all) {
        if (!f.flights || !f.flights[0] || typeof f.price !== 'number') continue;
        const first = f.flights[0];
        const flightNum = `${first.airline}_${first.flight_number}_${first.departure_airport?.time}`;
        
        if (!seen.has(flightNum)) {
            seen.add(flightNum);
            
            // Extract Visa and Luggage from SerpApi extensions
            let luggageInfo = f.luggage || "Not specified";
            let visaInfo = f.visa || "";
            if (f.extensions) {
                const extStr = f.extensions.join(" ").toLowerCase();
                if (extStr.includes("baggage included") || extStr.includes("check-in baggage")) {
                    luggageInfo = "Included";
                } else if (extStr.includes("no check-in baggage")) {
                    luggageInfo = "Not Included";
                }
            }
            if (f.layovers && f.layovers.length > 0) {
                const layoverStr = f.layovers.map(l => l.name).join(", ");
                visaInfo = ` (Transit: ${layoverStr})`;
            }

            f.original_price = f.price;
            f.luggage = luggageInfo;
            f.visa = visaInfo;
            
            if (data.preferred_airline && data.preferred_airline.toLowerCase() === 'air india' && first.airline.toLowerCase().includes('air india')) {
                f.luggage = "46kg (2x23kg)";
            }
            results.push(f);
        }
    }

    return finalizeAndPrioritize(results, data);

  } catch (err) {
    console.error("[Flight Service Error]:", err.message);
    return [];
  }
}

function finalizeAndPrioritize(results, data) {
    let processed = [...results];

    // Apply any additional dynamic markup from Admin/AI
    if (data.price_markup && !isNaN(data.price_markup)) {
        const markupMultiplier = 1 + (Number(data.price_markup) / 100);
        processed.forEach(f => { f.price = Math.floor(f.price * markupMultiplier); });
    }

    // EXACT MATCH FILTERING (From Screenshot)
    if (data.targetFlightDetails) {
        const target = data.targetFlightDetails;
        const targetTime = target.departureTime || "";
        const targetAir = (target.airline || "").toLowerCase();
        
        const exactMatches = processed.filter(f => {
            const leg = f.flights[0];
            const airMatch = leg.airline.toLowerCase().includes(targetAir) || targetAir.includes(leg.airline.toLowerCase());
            const timeMatch = (leg.departure_airport?.time || "").includes(targetTime);
            return airMatch && timeMatch;
        });

        if (exactMatches.length > 0) {
            return exactMatches; 
        }
    }

    // Sort by price initially
    processed.sort((a, b) => a.price - b.price);

    // AIR INDIA PRIORITIZATION
    if (processed.length > 0) {
        const lowestPrice = processed[0].price;
        const acceptablePremium = lowestPrice * 1.15; // 15% tolerance

        const airIndiaFlights = processed.filter(f => f.flights[0].airline.toLowerCase().includes('air india') && f.price <= acceptablePremium);
        
        if (airIndiaFlights.length > 0) {
            processed = processed.filter(f => !airIndiaFlights.includes(f));
            processed = [...airIndiaFlights, ...processed];
        }
    }

    return processed.slice(0, 6);
}

module.exports = {
  searchFlights
};
