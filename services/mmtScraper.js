const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

async function getMMTPrice(fromCode, toCode, date) {
    const [y, m, d] = date.split('-');
    const mmtDate = `${d}/${m}/${y}`;
    
    console.log(`[MMT Unlocker]: Correcting Data Mapping for ${fromCode} -> ${toCode}`);
    
    const url = `https://www.makemytrip.com/flight/search?tripType=O&itinerary=${fromCode}-${toCode}-${mmtDate}&paxType=A-1_C-0_I-0&intl=true&cabinClass=E`;

    try {
        const response = await axios.get(url, {
            proxy: {
                host: 'brd.superproxy.io',
                port: 22225,
                auth: {
                    username: `brd-customer-hl_02263a93-zone-web_unlocker1-country-in`,
                    password: 'l2nj8vxdvibm'
                }
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            timeout: 60000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        const flights = [];

        const scripts = $('script').toArray();
        for (const script of scripts) {
            const content = $(script).html();
            if (content && content.includes('window.__INITIAL_STATE__')) {
                try {
                    const jsonStr = content.split('window.__INITIAL_STATE__=')[1].split(';window.')[0];
                    const state = JSON.parse(jsonStr);
                    const results = state.preSearchedData?.searchResult || [];
                    
                    results.forEach(cluster => {
                        // The actual flight info is usually in the first element of the flights array within the cluster
                        const flightInfo = cluster.flights ? cluster.flights[0] : cluster;
                        
                        if (cluster.price > 1000) {
                            flights.push({
                                airline: flightInfo.airlineName || flightInfo.alName || 'Unknown Airline',
                                flightNumber: flightInfo.flightCode || flightInfo.fNo || 'N/A',
                                depTime: flightInfo.depTime || flightInfo.dt || 'N/A',
                                arrTime: flightInfo.arrTime || flightInfo.at || 'N/A',
                                duration: cluster.duration || flightInfo.du || 'N/A',
                                price: cluster.price
                            });
                        }
                    });
                } catch (e) {
                    console.log("[MMT Unlocker]: JSON parsing failed.");
                }
            }
        }

        // Fallback for visual cards if JSON didn't work correctly
        if (flights.length === 0) {
            $('.listingCard, .clusterView').each((i, el) => {
                const card = $(el);
                const airline = card.find('.airlineName').first().text().trim() || card.find('.boldFont').first().text().trim();
                const priceText = card.find('.price, .cluster-price').first().text().trim();
                const price = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;
                
                if (price > 1000 && airline && !airline.includes('%')) {
                    flights.push({
                        airline,
                        flightNumber: card.find('.fliCode').first().text().trim() || 'N/A',
                        depTime: card.find('.departureTime').first().text().trim() || 'N/A',
                        arrTime: card.find('.arrivalTime').first().text().trim() || 'N/A',
                        duration: card.find('.stop-info p').first().text().trim() || 'N/A',
                        price
                    });
                }
            });
        }

        console.log(`[MMT Unlocker]: Successfully extracted ${flights.length} flights with correct mapping.`);
        return flights;

    } catch (err) {
        console.error("[MMT Unlocker Error]:", err.message);
        return [];
    }
}

module.exports = { getMMTPrice };
