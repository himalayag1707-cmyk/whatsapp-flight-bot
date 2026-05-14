const axios = require('axios');

/**
 * Specifically searches for MakeMyTrip prices via the Skyscanner Flights & Travel API.
 */
async function searchMMT(data) {
  if (!process.env.RAPIDAPI_KEY) {
    console.log("[Skyscanner Service]: RAPIDAPI_KEY missing. Skipping MMT search.");
    return [];
  }

  const options = {
    method: 'GET',
    url: 'https://skyscanner-flights-travel-api.p.rapidapi.com/v1/flights/search-one-way',
    params: {
      fromId: data.from,
      toId: data.to,
      departDate: data.date,
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
    console.log(`[Skyscanner Service]: Requesting MMT data for ${data.from} -> ${data.to}`);
    const response = await axios.request(options);
    
    // Some Skyscanner APIs return 'itineraries' as a direct array, others in buckets
    const allItineraries = response.data.itineraries || [];
    const buckets = response.data.itineraries?.buckets || [];
    
    // Combine all potential items
    let allItems = [];
    if (Array.isArray(allItineraries)) allItems = [...allItineraries];
    buckets.forEach(b => { if (b.items) allItems = [...allItems, ...b.items]; });

    let mmtResults = [];

    allItems.forEach(item => {
      // Find agents for this flight
      item.priceOptions?.forEach(opt => {
        opt.agents?.forEach(agent => {
          // DEBUG LOG: See what agents are available
          // console.log(`[Skyscanner Debug]: Found agent: ${agent.name}`);
          
          if (agent.name.toLowerCase().includes('makemytrip')) {
            const leg = item.legs?.[0];
            if (leg) {
              mmtResults.push({
                flights: leg.segments.map(s => ({
                  airline: s.marketingCarrier.name,
                  flight_number: `${s.marketingCarrier.displayCode || ''} ${s.flightNumber}`,
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
