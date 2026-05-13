const { google } = require('googleapis');

let sheets;
try {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || "{}");
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  sheets = google.sheets({ version: "v4", auth });
} catch (e) {
  console.log("Google Sheets auth skipped (invalid/missing credentials).");
}

async function saveBooking(user) {
  if (!sheets || !process.env.SHEET_ID) return;
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: "Sheet1!A:J",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          user.passengerNames.join(", "),
          user.mobile,
          user.data.email,
          user.data.from,
          user.data.to,
          user.data.date,
          "Processing", // Status
          "oneway",
          user.data.passengers,
          user.data.price || "",
          new Date().toLocaleString('en-IN') // Booking time
        ]]
      }
    });
  } catch (err) {
    console.log("SHEETS ERROR:", err.message);
  }
}

module.exports = {
  saveBooking
};
