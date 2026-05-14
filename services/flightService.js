const axios = require('axios');
const { searchMystifly } = require('./mystiflyService');
const { searchMMT } = require('./skyscannerService');

async function searchFlights(data) {
  try {
    // ── 1. Mystifly Primary (Professional GDS Data) ─────────────────────────
    if (process.env.MYSTIFLY_USERNAME) {
      console.log(`[Flight Service]: Trying Mystifly for ${data.from} → ${data.to}`);
      const mystiflyResults = await searchMystifly(data);
      if (mystiflyResults.length > 0) {
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
          visa: '',
          source: 'Mystifly'
        }));
        return finalizeAndPrioritize(transformed, data);
      }
    }

    // ── 1.5 MakeMyTrip via Skyscanner (NEW PRIMARY) ─────────────────────────
    if (process.env.RAPIDAPI_KEY) {
      console.log(`[Flight Service]: 🔍 Attempting PRIORITY search: MakeMyTrip...`);
      const mmtResults = await searchMMT(data);
      if (mmtResults && mmtResults.length > 0) {
        console.log(`[Flight Service]: 🌟 SUCCESS! Retrieved ${mmtResults.length} exact results from MakeMyTrip.`);
        return finalizeAndPrioritize(mmtResults, data);
      } else {
        console.log(`[Flight Service]: ⚠️ MMT failed or no results found. Falling back to SerpApi.`);
      }
    }

    // ── 2. SerpApi Fallback (Google Flights) ────────────────────────────────
    console.log(`[Flight Service]: Searching SerpApi for ${data.from} → ${data.to} on ${data.date}`);

    const params = {
      engine: 'google_flights',
      departure_id: data.from,
      arrival_id: data.to,
      outbound_date: data.date,
      type: 2,                          // One-way
      adults: parseInt(data.passengers) || 1,
      currency: 'INR',
      hl: 'en',
      gl: 'in',
      api_key: process.env.SERPAPI_KEY
    };

    if (data.preference === 'Premium') params.travel_class = 3;

    const res = await axios.get('https://serpapi.com/search.json', { params });
    const raw = [...(res.data.best_flights || []), ...(res.data.other_flights || [])];

    console.log(`[Flight Service]: SerpApi returned ${raw.length} raw results`);

    // ── 3. Deduplicate & enrich ──────────────────────────────────────────────
    const results = [];
    const seen = new Set();

    for (const f of raw) {
      if (!f.flights?.[0] || typeof f.price !== 'number') continue;

      const first = f.flights[0];
      const key = `${first.airline}_${first.departure_airport?.time}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Luggage from SerpApi extensions
      let luggage = 'Not specified';
      if (f.extensions?.length) {
        const ext = f.extensions.join(' ').toLowerCase();
        if (ext.includes('check-in baggage') || ext.includes('baggage included')) luggage = 'Included';
        else if (ext.includes('no check-in') || ext.includes('no baggage')) luggage = 'Not included';
      }

      // Transit visa warning
      let visa = '';
      if (f.layovers?.length) {
        const layoverStr = f.layovers.map(l => l.name).join(', ');
        const layoverStrLower = layoverStr.toLowerCase();
        
        let visaWarning = "";
        if (layoverStrLower.includes("united states") || layoverStrLower.includes("new york") || layoverStrLower.includes("jfk") || layoverStrLower.includes("newark") || layoverStrLower.includes("dulles")) {
            visaWarning = " (🛂 USA Transit Visa Req.)";
        } else if (layoverStrLower.includes("london") || layoverStrLower.includes("heathrow") || layoverStrLower.includes("gatwick")) {
            visaWarning = " (🛂 UK Transit Visa Req.)";
        } else if (layoverStrLower.includes("frankfurt") || layoverStrLower.includes("munich") || layoverStrLower.includes("paris") || layoverStrLower.includes("zurich") || layoverStrLower.includes("amsterdam")) {
            visaWarning = " (🛂 Schengen Transit Req.)";
        }

        visa = `${visaWarning} (Transit: ${layoverStr})`;
      }

      // Air India 46kg override
      if (data.preferred_airline?.toLowerCase() === 'air india'
          && first.airline.toLowerCase().includes('air india')) {
        luggage = '46kg (2×23kg)';
      }

      results.push({ ...f, luggage, visa });
    }

    return finalizeAndPrioritize(results, data);

  } catch (err) {
    console.error('[Flight Service Error]:', err.message);
    return [];
  }
}

// ── Shared prioritization & filtering logic ──────────────────────────────────
function finalizeAndPrioritize(results, data) {
  let pool = [...results];

  // Apply markup
  if (data.price_markup && !isNaN(data.price_markup)) {
    const mult = 1 + Number(data.price_markup) / 100;
    pool.forEach(f => { f.price = Math.floor(f.price * mult); });
  }

  // ── EXACT MATCH: find the specific flight from a screenshot ──────────────
  if (data.targetFlightDetails) {
    const { airline: tAir = '', departureTime: tTime = '', flightNumber: tNum = '' } = data.targetFlightDetails;

    if (tAir || tTime) {
      const tAirLow = tAir.toLowerCase().trim();
      const tTimeTrim = tTime.replace(':', '').trim(); // normalise "01:45" → "0145"

      const exactMatches = pool.filter(f => {
        const leg = f.flights[0];
        const legAir = leg.airline.toLowerCase();
        const legTime = (leg.departure_airport?.time || '').replace(':', '').trim();
        const legNum = (leg.flight_number || '').toLowerCase();

        const airMatch = tAirLow
          ? (legAir.includes(tAirLow) || tAirLow.includes(legAir))
          : true;

        const timeMatch = tTimeTrim
          ? (legTime === tTimeTrim || legTime.includes(tTimeTrim) || tTimeTrim.includes(legTime))
          : true;

        const numMatch = tNum
          ? legNum.includes(tNum.toLowerCase())
          : true;

        // Require BOTH airline AND (time OR flight number) to match
        return airMatch && (timeMatch || numMatch);
      });

      if (exactMatches.length > 0) {
        console.log(`[Flight Service]: Exact screenshot match found — ${exactMatches.length} result(s)`);
        return exactMatches.slice(0, 3); // Show up to 3 matches of that exact flight/airline
      }

      // No exact match — fall through to show all results with preferred airline nudged up
      console.log(`[Flight Service]: No exact match for "${tAir} ${tTime}" — showing all results`);
    }
  }

  // ── Sort: Common Sense (Direct first, then price, then duration) ──────
  pool.sort((a, b) => {
    const aDirect = (a.flights?.[0]?.extensions || []).some(e => e.toLowerCase().includes('non-stop'));
    const bDirect = (b.flights?.[0]?.extensions || []).some(e => e.toLowerCase().includes('non-stop'));
    
    if (aDirect && !bDirect) return -1;
    if (!aDirect && bDirect) return 1;
    
    // Price tie-breaker
    if (Math.abs(a.price - b.price) > 500) return a.price - b.price;
    
    // Duration tie-breaker (e.g. 15h 30m -> 930 mins)
    const getMins = (d) => {
      if (!d) return 9999;
      const h = parseInt(d.match(/(\d+)h/)?.[1] || 0);
      const m = parseInt(d.match(/(\d+)m/)?.[1] || 0);
      return (h * 60) + m;
    };
    return getMins(a.total_duration) - getMins(b.total_duration);
  });

  // ── Preferred airline strict priority ─────────────────────────────────────
  if (data.preferred_airline) {
    const prefLow = data.preferred_airline.toLowerCase().trim();
    const preferred = pool.filter(f => f.flights[0].airline.toLowerCase().includes(prefLow));
    const others = pool.filter(f => !f.flights[0].airline.toLowerCase().includes(prefLow));
    pool = [...preferred, ...others]; 
    console.log(`[Flight Service]: Strict Priority for "${data.preferred_airline}" — ${preferred.length} flights moved to top`);
  } else {
    // Auto nudge: Air India within 15% of cheapest
    if (pool.length > 0) {
      const lowestPrice = pool[0].price;
      const cap = lowestPrice * 1.15;
      const aiFlights = pool.filter(f => f.flights[0].airline.toLowerCase().includes('air india') && f.price <= cap);
      if (aiFlights.length > 0) {
        pool = [...aiFlights, ...pool.filter(f => !aiFlights.includes(f))];
      }
    }
  }

  return pool.slice(0, 6);
}

module.exports = { searchFlights };
