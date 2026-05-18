const axios = require('axios');

/**
 * Mystifly OnePoint API Service
 * This service provides professional GDS & LCC flight data (Amadeus, Travelport, etc.)
 */

async function getMystiflyToken() {
    try {
        const response = await axios.post('https://restapi.airshortage.com/v1/auth/createtoken', {
            AccountNumber: process.env.MYSTIFLY_ACCOUNT_NUMBER,
            UserName: process.env.MYSTIFLY_USERNAME,
            Password: process.env.MYSTIFLY_PASSWORD,
            Target: process.env.MYSTIFLY_TARGET || 'Test'
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        return response.data.Data.Token;
    } catch (err) {
        console.error("[Mystifly Auth Error]:", err.response?.data || err.message);
        return null;
    }
}

async function searchMystifly(data) {
    const token = await getMystiflyToken();
    if (!token) return [];

    try {
        const payload = {
            Origin: data.from,
            Destination: data.to,
            DepartureDate: data.date, // Expects YYYY-MM-DD
            ReturnDate: "",
            Type: "OneWay",
            CabinClass: data.preference === 'Premium' ? "Business" : "Economy",
            PassengerCount: {
                Adult: parseInt(data.passengers) || 1,
                Child: 0,
                Infant: 0
            },
            Preferences: {
                PreferredAirlines: data.preferred_airline ? [data.preferred_airline] : []
            }
        };

        const response = await axios.post('https://restapi.airshortage.com/v1/search/flightsearch', payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const flightResults = response.data.Data.FlightItineraries || [];
        
        return flightResults.map(f => {
            const firstLeg = f.Segments[0];
            return {
                airline: firstLeg.AirlineName,
                flight_number: firstLeg.FlightNumber,
                depTime: firstLeg.DepartureDateTime.split('T')[1].substring(0, 5),
                arrTime: firstLeg.ArrivalDateTime.split('T')[1].substring(0, 5),
                duration: f.TotalDuration,
                price: f.FareDetails.TotalFare,
                luggage: f.BaggageDetails?.[0]?.CheckinBaggage || "Included",
                source: "Mystifly"
            };
        });

    } catch (err) {
        console.error("[Mystifly Search Error]:", err.response?.data || err.message);
        return [];
    }
}

module.exports = { searchMystifly };
