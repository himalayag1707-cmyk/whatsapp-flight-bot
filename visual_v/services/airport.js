const airports = require('../data/airports');

function getIATACode(cityName) {
  if (!cityName) return null;
  
  let query = cityName.toLowerCase().trim();
  
  // Fail-proof Typo Corrections
  if (query === 'calculla' || query === 'calcuta') query = 'kolkata';
  if (query === 'bombay') query = 'mumbai';
  if (query === 'madras') query = 'chennai';
  if (query === 'bengaluru') query = 'bangalore';
  
  // Exact match
  const match = airports.find(a => a.city === query || a.code.toLowerCase() === query);
  if (match) return match.code;
  
  // Partial match: query contains city, or city contains query, or airport name contains query
  const partialMatch = airports.find(
    a => a.city.includes(query) || query.includes(a.city) || a.name.toLowerCase().includes(query)
  );
  if (partialMatch) return partialMatch.code;

  return null;
}

module.exports = {
  getIATACode
};
