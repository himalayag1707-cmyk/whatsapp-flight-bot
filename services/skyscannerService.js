const axios = require('axios');

async function resolveAirport(iataCode) {
  const options = {
    method: 'GET',
    url: 'https://skyscanner-flights-travel-api.p.rapidapi.com/flights/searchAirport',
    params: { query: iataCode },
    headers: {
      'x-rapidapi-key': process.env.RAPIDAPI_KEY,
      'x-rapidapi-host': 'skyscanner-flights-travel-api.p.rapidapi.com'
    }
  };

  try {
    const res = await axios.request(options);
    if (res.data && res.data.data && res.data.data.length > 0) {
      return {
        skyId: res.data.data[0].skyId,
        entityId: res.data.data[0].entityId
      };
    }
  } catch (error) {
    console.error(`[Skyscanner Service]: Failed to resolve airport code ${iataCode}`);
  }
  return null;
}

/**
 * Specifically searches for MakeMyTrip prices via the Skyscanner Flights & Travel API.
 */
async function searchMMT(data) {
  if (!process.env.RAPIDAPI_KEY) {
    console.log("[Skyscanner Service]: RAPIDAPI_KEY missing. Skipping MMT search.");
    return [];
  }

  console.log(`[Skyscanner Service]: Resolving airport codes for ${data.from} -> ${data.to}...`);
  const origin = await resolveAirport(data.from);
  const destination = await resolveAirport(data.to);

  if (!origin || !destination) {
    console.log("[Skyscanner Service]: Could not resolve SkyIds for the route. Falling back.");
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
      'x-rapidapi-host': 'skyscanner-flights-travel-api.p.rapidapi.com'
    }
  };

  try {
    console.log(`[Skyscanner Service]: Requesting MMT data for ${origin.skyId} -> ${destination.skyId} on ${data.date}`);
    const response = await axios.request(options);
    
    // The API structure usually has itineraries
    const allItineraries = response.data?.data?.itineraries || response.data?.itineraries || [];
    const buckets = response.data?.data?.itineraries?.buckets || response.data?.itineraries?.buckets || [];
    
    // Combine all potential items
    let allItems = [];
    if (Array.isArray(allItineraries)) allItems = [...allItineraries];
    buckets.forEach(b => { if (b.items) allItems = [...allItems, ...b.items]; });

    let mmtResults = [];

    allItems.forEach(item => {
      // Find agents for this flight
      item.priceOptions?.forEach(opt => {
        opt.agents?.forEach(agent => {
          if (agent.name.toLowerCase().includes('makemytrip')) {
            const leg = item.legs?.[0];
            if (leg) {
              mmtResults.push({
                flights: leg.segments.map(s => ({
                  airline: s.marketingCarrier?.name || s.operatingCarrier?.name,
                  flight_number: `${s.marketingCarrier?.displayCode || ''} ${s.flightNumber}`,
                  departure_airport: { time: (s.departure || "").split('T')[1]?.substring(0, 5) || "N/A" },
                  arrival_airport: { time: (s.arrival || "").split('T')[1]?.substring(0, 5) || "N/A" }
                })),
                price: opt.price,
                total_duration: leg.durationInMinutes,
                luggage: "MMT Standard (Verified)",
                source: 'MakeMyTrip'
              });
            }
          }
        });
      });
    });

    if (mmtResults.length === 0) {
      console.log(`[Skyscanner Service]: No agent matching 'MakeMyTrip' was found in ${allItems.length} results.`);
    }

    return mmtResults;
  } catch (error) {
    console.error("[Skyscanner Service Error]:", error.response?.data || error.message);
    return [];
  }
}

module.exports = { searchMMT };
