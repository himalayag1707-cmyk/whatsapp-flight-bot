function parseInput(text) {
  const lower = text.toLowerCase();
  const data = {};

  // Email
  const emailMatch = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  if (emailMatch) data.email = emailMatch[0];

  // Passengers
  if (/^\d+$/.test(text.trim())) {
    data.passengers = Number(text.trim());
  } else {
    const pMatch = lower.match(/(\d+)\s*(passenger|people|person|traveller)/);
    if (pMatch) data.passengers = Number(pMatch[1]);
  }

  // Date (very basic parser, assumes 2026 for now, or handles native dates)
  const dMatch = lower.match(/\b(\d{1,2})\s*(jan|feb|mar|apr|april|may|jun|jul|aug|sep|oct|nov|dec)\b/);
  if (dMatch) {
    const monthMap = {
      jan: '01', feb: '02', mar: '03', apr: '04', april: '04', may: '05', jun: '06', 
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    const day = dMatch[1].padStart(2, '0');
    const month = monthMap[dMatch[2]];
    const year = new Date().getFullYear(); // Or 2026? Let's use current year or 2026.
    data.date = `2026-${month}-${day}`;
  }

  // Route ("Delhi to Goa")
  if (lower.includes("to")) {
    const parts = lower.split("to").map(x => x.trim().replace(/[^a-z ]/g, ''));
    if (parts.length >= 2) {
      data.fromText = parts[0];
      data.toText = parts[1];
    }
  }

  return data;
}

module.exports = {
  parseInput
};
