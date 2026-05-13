const axios = require('axios');

async function searchFlights(data) {
  try {
    console.log(`[Flight Service]: Running Classic Search (100% Price) for ${data.from} -> ${data.to}`);

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
    
    let results = [];
    const seen = new Set();

    for (const f of all) {
        if (!f.flights || !f.flights[0] || typeof f.price !== 'number') continue;
        const first = f.flights[0];
        const flightNum = `${first.airline}_${first.flight_number}_${first.departure_airport?.time}`;
        
        if (!seen.has(flightNum)) {
            seen.add(flightNum);
            
            // Extract Visa and Luggage from SerpApi extensions
            let luggageInfo = "Not specified";
            let visaInfo = "";
            if (f.extensions) {
                const extStr = f.extensions.join(" ").toLowerCase();
                if (extStr.includes("baggage included") || extStr.includes("check-in baggage")) {
                    luggageInfo = "Included";
                } else if (extStr.includes("no check-in baggage")) {
                    luggageInfo = "Not Included";
                }
            }
            // Check for transit visa warning in layovers
            if (f.layovers && f.layovers.length > 0) {
                const layoverStr = f.layovers.map(l => l.name).join(", ");
                visaInfo = ` (Transit: ${layoverStr})`;
            }

            f.original_price = f.price;
            f.price = f.price; // 100% PRICE (No discount)
            f.luggage = luggageInfo;
            f.visa = visaInfo;
            
            // If user agreed to 46kg Air India, override luggage string
            if (data.preferred_airline && data.preferred_airline.toLowerCase() === 'air india' && first.airline.toLowerCase().includes('air india')) {
                f.luggage = "46kg (2x23kg)";
            }

            results.push(f);
        }
    }

    // Apply any additional dynamic markup from Admin/AI
    if (data.price_markup && !isNaN(data.price_markup)) {
        const markupMultiplier = 1 + (Number(data.price_markup) / 100);
        results.forEach(f => { f.price = Math.floor(f.price * markupMultiplier); });
    }

    // EXACT MATCH FILTERING (From Screenshot)
    if (data.targetFlightDetails) {
        const target = data.targetFlightDetails;
        const targetTime = target.departureTime || "";
        const targetAir = (target.airline || "").toLowerCase();
        
        const exactMatches = results.filter(f => {
            const leg = f.flights[0];
            const airMatch = leg.airline.toLowerCase().includes(targetAir) || targetAir.includes(leg.airline.toLowerCase());
            const timeMatch = (leg.departure_airport?.time || "").includes(targetTime);
            return airMatch && timeMatch;
        });

        if (exactMatches.length > 0) {
            return exactMatches; // Return ONLY the exact match
        }
    }

    // Sort by price initially
    results.sort((a, b) => a.price - b.price);

    // AIR INDIA PRIORITIZATION
    if (results.length > 0) {
        const lowestPrice = results[0].price;
        const acceptablePremium = lowestPrice * 1.15; // 15% tolerance

        // Find Air India flights within 15% of the cheapest
        const airIndiaFlights = results.filter(f => f.flights[0].airline.toLowerCase().includes('air india') && f.price <= acceptablePremium);
        
        if (airIndiaFlights.length > 0) {
            // Remove them from current position
            results = results.filter(f => !airIndiaFlights.includes(f));
            // Add them to the top
            results = [...airIndiaFlights, ...results];
        }
    }

    return results.slice(0, 6); // Return top 6 instead of 10

  } catch (err) {
    console.error("[Flight Service Error]:", err.message);
    return [];
  }
}

module.exports = {
  searchFlights
};
