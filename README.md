# CricBot AI

CricBot AI is a cricket-focused chatbot web app for a college mini project demo. It answers questions about live matches, schedules, players, scorecards, squads, team history, comparisons, recent performance, and basic match predictions.

The app uses Next.js App Router, TypeScript, Tailwind CSS, Vercel AI SDK, Google Gemini Flash, and CricketData/CricAPI REST endpoints. API keys stay on the server.

## Features

- Cricket-themed chat UI with suggested prompt chips.
- Server-side `/api/chat` route powered by Gemini Flash.
- AI tool calling for live matches, match lists, player search, scorecards, squads, series info, and predictions.
- CricAPI service layer with timeout handling, friendly errors, normalized data, and short in-memory caching.
- Heuristic match prediction with confidence, key factors, risks, and disclaimer.
- No database required for MVP.

## Tech Stack

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Vercel AI SDK
- Google Gemini Flash
- CricketData / CricAPI REST API

## Setup

Install dependencies:

```bash
npm install
```

Create `.env.local` in the project root:

```env
CRICKETDATA_API_KEY=your_cricketdata_api_key_here
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key_here
GOOGLE_GENERATIVE_AI_MODEL=gemini-2.5-flash
THESPORTSDB_API_KEY=123
```

Run locally:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## API Endpoints Used

- `https://api.cricapi.com/v1/currentMatches`
- `https://api.cricapi.com/v1/matches`
- `https://api.cricapi.com/v1/series_info`
- `https://api.cricapi.com/v1/players`
- `https://api.cricapi.com/v1/match_scorecard`
- `https://api.cricapi.com/v1/match_squad`
- `https://api.cricapi.com/v1/match_points`

## Example Prompts

- Show current cricket matches
- Who is likely to win today's match?
- Show India recent form
- Search Virat Kohli stats
- Explain CSK team history
- Compare India and Australia
- Show the scorecard for match ID `MATCH_ID`
- Show squads for match ID `MATCH_ID`

## Test API Keys

After adding `.env.local` and starting the dev server, open:

```text
http://localhost:3000/api/debug/apis
```

This server-only debug endpoint checks:

- CricketData current matches
- CricketData match list
- CricketData player search for Virat Kohli
- Google Gemini Flash text generation
- TheSportsDB team metadata for Chennai Super Kings

It returns whether keys are configured and small sample responses, but never returns the API keys.

## Deploy On Vercel

1. Push the project to GitHub.
2. Import the repository in Vercel.
3. Add these environment variables in Vercel project settings:
   - `CRICKETDATA_API_KEY`
   - `GOOGLE_GENERATIVE_AI_API_KEY`
4. Deploy.

## Future Improvements

- Add Supabase/PostgreSQL for chat history and saved favorite teams.
- Add authentication for personal dashboards.
- Add richer player profiles when a player-detail endpoint is available.
- Add scheduled background refresh for popular live matches.
- Add chart views for recent form and head-to-head records.
