const axios = require('axios');

/**
 * Specifically searches for MakeMyTrip prices via the Skyscanner44 RapidAPI.
 */
async function searchMMT(data) {
  if (!process.env.RAPIDAPI_KEY) {
    console.log("[Skyscanner Service]: RAPIDAPI_KEY missing. Skipping MMT search.");
    return [];
  }

  const options = {
    method: 'GET',
    url: 'https://skyscanner-flights-travel-api.p.rapidapi.com/search-one-way',
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
    
    // The skyscanner44 API structure can vary, but usually it's under itineraries.buckets
    const itineraries = response.data.itineraries?.buckets || [];
    let mmtResults = [];

    itineraries.forEach(bucket => {
      if (bucket.items && Array.isArray(bucket.items)) {
        bucket.items.forEach(item => {
          // Look for an agent that is MakeMyTrip
          const mmtOption = item.priceOptions?.find(opt => 
            opt.agents?.some(agent => agent.name.toLowerCase().includes('makemytrip'))
          );

          if (mmtOption) {
            // Transform into our internal flight format
            const leg = item.legs?.[0];
            if (!leg) return;

            mmtResults.push({
              flights: leg.segments.map(s => ({
                airline: s.marketingCarrier.name,
                flight_number: `${s.marketingCarrier.displayCode || ''} ${s.flightNumber}`,
                departure_airport: { time: (s.departure || "").split('T')[1]?.substring(0, 5) || "N/A" },
                arrival_airport: { time: (s.arrival || "").split('T')[1]?.substring(0, 5) || "N/A" }
              })),
              price: mmtOption.price,
              total_duration: leg.durationInMinutes,
              luggage: "MMT Standard (Verified)",
              source: 'MakeMyTrip'
            });
          }
        });
      }
    });

    return mmtResults;
  } catch (error) {
    console.error("[Skyscanner Service Error]:", error.response?.data || error.message);
    return [];
  }
}

module.exports = { searchMMT };
