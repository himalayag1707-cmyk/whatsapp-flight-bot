const axios = require('axios');

async function resolveAirport(iataCode) {
  const options = {
    method: 'GET',
    url: 'https://skyscanner-flights-travel-api.p.rapidapi.com/flights/searchAirport',
    params: { query: iataCode },
    headers: {
      'x-rapidapi-key': process.env.RAPIDAPI_KEY,
      'x-rapidapi-host': 'skyscanner-flights-travel-api.p.rapidapi.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
      'Referer': 'https://www.makemytrip.com/'
    }
  };

  try {
    console.log(`[Skyscanner Service]: Resolving ${iataCode}...`);
    const response = await axios.request(options);
    
    // Robust logging
    console.log(`Airport Resolve [${iataCode}] FULL Response:`, JSON.stringify(response.data, null, 2));

    // Flexible extraction: handles both {data: [...]} and {data: {data: [...]}}
    let airports = [];
    if (Array.isArray(response.data?.data)) {
        airports = response.data.data;
    } else if (response.data?.data?.data && Array.isArray(response.data.data.data)) {
        airports = response.data.data.data;
    } else if (Array.isArray(response.data)) {
        airports = response.data;
    }

    if (!airports || airports.length === 0) {
      console.log(`[Skyscanner Service]: No airport data found in response for ${iataCode}`);
      return null;
    }

    // Find the best match (prioritize the one where skyId exactly matches the query)
    const airport = airports.find(a => a.skyId === iataCode.toUpperCase()) || airports[0];
    
    console.log(`[Skyscanner Service]: Extracted for ${iataCode} -> skyId: ${airport.skyId}, entityId: ${airport.entityId}`);

    return {
      skyId: airport.skyId,
      entityId: airport.entityId,
    };

  } catch (error) {
    console.error(`[Skyscanner Service]: Error resolving ${iataCode}:`, error.message);
    if (error.response) {
      console.error(`[Skyscanner Service]: Error Body:`, JSON.stringify(error.response.data, null, 2));
    }
  }
  return null;
}

/**
 * Specifically searches for MakeMyTrip prices via the Skyscanner Flights & Travel API.
 */
async function searchMMT(data) {
  if (!process.env.RAPIDAPI_KEY) {
    console.log("[Skyscanner Service]: RAPIDAPI_KEY missing.");
    return [];
  }

  const origin = await resolveAirport(data.from);
  const destination = await resolveAirport(data.to);

  if (!origin || !destination) {
    console.log("[Skyscanner Service]: Airport resolution failed. MMT search aborted.");
    return [];
  }

  const options = {
    method: 'GET',
    url: 'https://skyscanner-flights-travel-api.p.rapidapi.com/flights/searchFlights',
    params: {
      originSkyId: origin.skyId,
      destinationSkyId: destination.skyId,
      originEntityId: origin.entityId,
      destinationEntityId: destination.entityId,
      date: data.date,
      adults: data.passengers || '1',
      currency: 'INR',
      cabinClass: 'economy'
    },
    headers: {
      'x-rapidapi-key': process.env.RAPIDAPI_KEY,
      'x-rapidapi-host': 'skyscanner-flights-travel-api.p.rapidapi.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
      'Referer': 'https://www.makemytrip.com/'
    }
  };

  try {
    console.log(`[Skyscanner Service]: Fetching flights for ${origin.skyId} -> ${destination.skyId}...`);
    const response = await axios.request(options);
    
    // Check if results are nested in data.data or elsewhere
    const itineraries = response.data?.data?.itineraries || response.data?.itineraries || [];
    
    if (!itineraries.length) {
        console.log("[Skyscanner Service]: No itineraries found. Full search response:", JSON.stringify(response.data, null, 2));
    }

    let mmtResults = [];

    itineraries.forEach(item => {
      // Look for MMT in the price options
      const agents = item.priceOptions?.flatMap(opt => opt.agents || []) || [];
      const mmtAgent = agents.find(a => a.name.toLowerCase().replace(/\s+/g, '').includes('makemytrip'));

      if (mmtAgent) {
        const leg = item.legs?.[0];
        const price = item.priceOptions?.find(opt => opt.agents?.some(a => a.id === mmtAgent.id))?.price;
        
        if (leg && price) {
          mmtResults.push({
            flights: leg.segments.map(s => ({
              airline: s.marketingCarrier?.name || s.operatingCarrier?.name,
              flight_number: `${s.marketingCarrier?.displayCode || ''} ${s.flightNumber}`,
              departure_airport: { time: (s.departure || "").split('T')[1]?.substring(0, 5) || "N/A" },
              arrival_airport: { time: (s.arrival || "").split('T')[1]?.substring(0, 5) || "N/A" }
            })),
            price: price,
            total_duration: leg.durationInMinutes,
            luggage: "MMT Standard (Verified)",
            source: 'MakeMyTrip'
          });
        }
      }
    });

    console.log(`[Skyscanner Service]: Found ${mmtResults.length} MMT results.`);
    return mmtResults;
  } catch (error) {
    console.error("[Skyscanner Service]: Flight search error:", error.message);
    return [];
  }
}

module.exports = { searchMMT };
