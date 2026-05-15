# PROJECT CONTEXT BACKUP - Hopspot Flight Bot (Manoj AI)
*Last Updated: 2026-05-15*

> [!IMPORTANT]
> This file is a comprehensive memory dump for any AI assistant to understand this project's history, architecture, and logic.

## 1. Project Overview
**Business Name:** Hopspot Travel Technologies
**Product:** A WhatsApp-based flight booking concierge.
**Core AI Name:** Manoj (Persona: Sharp, friendly Indian travel agent).

## 2. Technical Architecture
- **Environment:** Node.js (Express) hosted on Railway.app.
- **WhatsApp Integration:** Meta Cloud API (Webhooks).
- **Intelligence:** OpenAI GPT-4o for natural language and screenshot processing.
- **Data Sources:** 
  - MakeMyTrip (Primary): Integrated via Skyscanner Flights & Travel API (RapidAPI).
  - Mystifly (Professional GDS - Secondary).
  - SerpApi / Google Flights (Fallback): Restored to ensure service availability if MMT fails.
- **Persistence:** Local JSON files (`data/`) on Railway.
- **Admin Dashboard:** Custom-built dashboard to monitor chats and human-override.

## 3. Core Business Logic (The "Manoj" Rules)
- **The "Today" Ban:** Manoj must NEVER use the word "today" in responses.
- **Air India Nudge:** On specific routes (UK/Canada), Manoj MUST nudge users toward Air India for the 46kg baggage allowance.
- **Screenshot Logic:** If a user sends a screenshot of a flight, Manoj must extract details, set `search_flights_now: true` immediately, and match the exact flight.
- **Admin Commands:** `PAUSE/RESUME`, `CONFIRM`, `WHISPER`, `ASK`.

## 4. Key Improvements & Fixes (History)
- **Skyscanner Fix (May 15):** 
  - Refined MMT integration using two-step resolution (`searchAirport` -> `searchFlights`).
  - Added browser-like headers to bypass anti-bot measures.
  - Implemented detailed debug logging for request/response cycles (including Airport Resolve body).
  - Restored SerpApi fallback for reliability.
- **CRM Integration:** Implemented `userStore.js` for multi-step flow management.

## 5. Future Roadmap & Pending Features
- **Database Migration:** Move from JSON files to MongoDB/PostgreSQL.
- **Multi-Passenger Handling:** Improve name extraction logic.
- **Payment Automation:** Better verification of Razorpay/UPI status.

## 6. How to "Feed" this to a new AI
Copy the contents of this file and say: 
*"I am working on the Hopspot Flight Bot. Here is the full project context. Read this and help me with [Task]."*

---
*Created by Antigravity AI Assistant.*
