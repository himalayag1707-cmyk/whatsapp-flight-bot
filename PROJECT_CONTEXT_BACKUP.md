# PROJECT CONTEXT BACKUP - Hopspot Flight Bot (Manoj AI)
*Last Updated: 2026-05-14*

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
  - MakeMyTrip (Skyscanner via RapidAPI - **Primary Source**).
  - Mystifly (Professional GDS - Secondary).
  - SerpApi / Google Flights (Fallback if MMT fails).
- **Persistence:** Local JSON files (`data/`) on Railway (Note: Ephemeral, needs DB migration to MongoDB/PostgreSQL).
- **Admin Dashboard:** Custom-built dashboard to monitor chats and human-override.

## 3. Core Business Logic (The "Manoj" Rules)
- **The "Today" Ban:** Manoj must NEVER use the word "today" in responses.
- **Air India Nudge:** On specific routes (UK/Canada), Manoj MUST nudge users toward Air India for the 46kg baggage allowance.
- **Screenshot Logic:** If a user sends a screenshot of a flight, Manoj must extract the details and find that exact flight to "beat" the price.
- **Admin Commands:** 
  - `PAUSE/RESUME`: Toggle bot control.
  - `CONFIRM`: Verify payment and trigger E-Ticket generation.
  - `WHISPER`: Internal admin-to-AI instruction channel.

## 4. Key Improvements & Fixes (History)
- **Port/Host:** Fixed Railway deployment by setting host to `0.0.0.0` and using `process.env.PORT`.
- **AI Context:** Fixed a bug where the current user message was duplicated in the OpenAI history.
- **CRM Integration:** Implemented `userStore.js` to track multi-step states (ASK_ROUTE, ASK_DATE, SELECT_FLIGHT, etc.).

## 5. Future Roadmap & Pending Features
- **MakeMyTrip Integration:** Successfully implemented using Skyscanner44 RapidAPI. Bot now tries MMT first for exact website parity.
- **Database Migration:** Move from JSON files to a real database to prevent data loss on Railway restarts.
- **Multi-Passenger Handling:** Improve the extraction of multiple names from a single text block.
- **Payment Automation:** Better verification of Razorpay/UPI status.

## 6. How to "Feed" this to a new AI
Copy the contents of this file and say: 
*"I am working on the Hopspot Flight Bot. Here is the full project context. Read this and help me with [Task]."*

---
*Created by Antigravity AI Assistant.*
