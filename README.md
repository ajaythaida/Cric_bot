# SportBot AI

SportBot AI is a football and cricket chatbot web app for a college mini project demo. It answers questions about current matches, past matches, upcoming fixtures, players, cricket scorecards, team history, comparisons, recent performance, and basic match predictions.

The app uses Next.js App Router, TypeScript, Tailwind CSS, Vercel AI SDK, Google Gemini Flash, CricketData/CricAPI, and TheSportsDB. API keys stay on the server.

## Features

- Sports-themed chat UI with suggested prompt chips.
- Match updates panel for cricket and football, with Live, Upcoming, and Results tabs and automatic refresh every 60 seconds while the page is open.
- Current questions use the current date in Asia/Kolkata. Fixed July snapshots are no longer used for current answers.
- Match status is checked on every refresh. Finished matches move to Results; a score alone is never treated as a final result. Stale, postponed, and unknown-status entries are excluded from live/upcoming lists.
- Server-side `/api/chat` route powered by Gemini Flash.
- AI tool calling for cricket live matches, football fixtures, player search, scorecards, squads, team info, and predictions.
- CricAPI service layer with timeout handling, friendly errors, normalized data, and short in-memory caching.
- TheSportsDB service layer for football teams, today's matches, past matches, and upcoming fixtures.
- Heuristic match prediction with confidence, key factors, risks, and disclaimer.
- No database required for MVP.

## Tech Stack

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Vercel AI SDK
- Google Gemini Flash
- CricketData / CricAPI REST API
- TheSportsDB REST API

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
npm test
```

## API Endpoints Used

- `https://api.cricapi.com/v1/currentMatches`
- `https://api.cricapi.com/v1/matches`
- `https://api.cricapi.com/v1/series_info`
- `https://api.cricapi.com/v1/players`
- `https://api.cricapi.com/v1/match_scorecard`
- `https://api.cricapi.com/v1/match_squad`
- `https://api.cricapi.com/v1/match_points`
- `https://www.thesportsdb.com/api/v1/json/123/searchteams.php`
- `https://www.thesportsdb.com/api/v1/json/123/eventsday.php`
- `https://www.thesportsdb.com/api/v1/json/123/eventslast.php`
- `https://www.thesportsdb.com/api/v1/json/123/eventsnext.php`

## Example Prompts

- Show current cricket matches
- Show football matches today
- Show Arsenal past matches
- Show Barcelona upcoming fixtures
- Who is likely to win today's match?
- Show India recent form
- Search Virat Kohli stats
- Explain CSK team history
- Compare India and Australia
- Show the scorecard for match ID `MATCH_ID`
- Show squads for match ID `MATCH_ID`

## Test API Keys

`/api/matches?sport=cricket` and `/api/matches?sport=football` return the match panel's latest checked data with no browser caching. Cricket reads three pages of current matches and fixtures, retaining available results from the last 30 days; football reads yesterday, today, and tomorrow. Coverage and update speed depend on the configured data subscription. This is a current match window, not a complete historical archive. Chat can research explicitly dated older results.

The panel retries every minute, identifies partial responses, and warns when previously loaded scores may be stale. Current research answers are cached for 45 seconds; old or undated news snippets are not used as a substitute for verified current match status. Future results appear only after a source reports completion.

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
- TheSportsDB football matches today and Arsenal past matches

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
