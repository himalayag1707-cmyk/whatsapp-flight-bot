# WhatsApp Flight Booking Bot (v2.0)

A professional-grade WhatsApp chatbot for flight bookings, featuring AI-powered extraction, screenshot processing, and a live admin dashboard.

## 🚀 Railway Deployment Instructions

### 1. Environment Variables
Set these in the Railway Dashboard under **Settings > Variables**:

| Variable | Description |
| :--- | :--- |
| `WHATSAPP_TOKEN` | Your Meta WhatsApp Cloud API Access Token |
| `PHONE_NUMBER_ID` | Your WhatsApp Phone Number ID |
| `OPENAI_API_KEY` | OpenAI API Key (for Manoj AI) |
| `ADMIN_NUMBER` | Your phone number (e.g., `918882783582`) to receive admin alerts |
| `SERPAPI_KEY` | SerpApi key for Google Flights data |
| `GOOGLE_CREDENTIALS` | Full JSON string of your Google Service Account key |
| `SHEET_ID` | The ID of your Google Sheet for bookings |
| `WHATSAPP_VERIFY_TOKEN` | (Optional) Token for webhook verification |

### 2. Deployment
- Connect your GitHub repository to Railway.
- Railway will automatically detect the `Procfile` and `package.json`.
- The bot will start on `0.0.0.0:${PORT}`.

### ⚠️ Persistence Note
Railway uses an ephemeral filesystem. This means `crm_data.json` will be reset every time the server restarts. 
- For production, it is recommended to connect a **Railway PostgreSQL** or **MongoDB** database.
- For hobby use, the current JSON setup works, but data will not persist across deployments.

## 📁 Project Structure
- `index.js`: Main Express server and webhook entry point.
- `controllers/flowController.js`: The "brain" that manages the conversation flow.
- `services/aiService.js`: Integration with OpenAI (GPT-4o) for intelligent parsing.
- `services/flightService.js`: Fetches data from Mystifly (primary) or SerpApi (fallback).
- `dashboard/`: A simple web interface to view active chats and override the bot.

## 🛠 Commands for Admin
As the admin (`ADMIN_NUMBER`), you can message the bot:
- `PAUSE <mobile>`: Stop the bot for a specific user to take over manually.
- `RESUME <mobile>`: Let the bot take back control.
- `CONFIRM <mobile> <seats>`: Verify payment and send an E-Ticket to the user.
- `WHISPER <mobile> <instruction>`: Tell Manoj (the AI) what to do/say next (internal command).
