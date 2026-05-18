const { ApifyClient } = require('apify-client');

const client = new ApifyClient({
    token: 'apify_api_5em2jQelDfdmV0vn0GHkB1GlOlmFkT40gttJ',
});

async function getApifyMMTPrice(from, to, date) {
    console.log(`[Apify]: Requesting MMT Flights for ${from} -> ${to} on ${date}`);

    try {
        const input = {
            "fromCity": from,
            "toCity": to,
            "departureDate": date,
            "tripType": "O",
            "paxType": "A-1_C-0_I-0",
            "cabinClass": "E"
        };

        // Switched to 'dtrungtin/makemytrip-scraper' which is the current top-rated MMT actor
        const run = await client.actor("dtrungtin/makemytrip-scraper").call(input);
        const { items } = await client.dataset(run.defaultDatasetId).listItems();

        console.log(`[Apify]: Successfully fetched ${items.length} flight records.`);
        
        return items.map(f => {
            return {
                airline: f.airlineName || f.airline || 'Unknown',
                flightNumber: f.flightCode || f.flightNumber || 'N/A',
                price: parseInt(f.price || 0),
                depTime: f.departureTime || f.depTime || 'N/A',
                arrTime: f.arrivalTime || f.arrTime || 'N/A',
                duration: f.duration || 'N/A',
                stops: f.stops || 'Non-stop'
            };
        }).filter(f => f.price > 1000);

    } catch (err) {
        console.error("[Apify Scraper Error]:", err.message);
        return [];
    }
}

module.exports = { getApifyMMTPrice };
