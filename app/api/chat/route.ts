import { google } from "@ai-sdk/google";
import { streamText, tool, type CoreMessage } from "ai";
import { z } from "zod";
import {
  getCurrentMatches,
  getMatches,
  getMatchScorecard,
  getMatchSquad,
  getSeriesInfo,
  searchPlayers
} from "@/lib/cricketData";
import { predictMatch } from "@/lib/prediction";
import { normalizeSportsQuestion } from "@/lib/questionNormalizer";
import {
  getFootballMatchesByDate,
  getFootballTeamNextMatches,
  getFootballTeamPastMatches,
  getFootballTeamProfile,
  getTeamProfile,
  searchFootballTeams,
  searchTeams,
  type SportsDbEvent,
  type SportsDbTeam
} from "@/lib/theSportsDb";
import { searchSportsWeb } from "@/lib/webSportsSearch";
import type { NormalizedMatch, NormalizedPlayer } from "@/types/cricket";

export const runtime = "nodejs";

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `You are SportBot AI, a sports analyst for football and cricket. Your job is to answer football and cricket questions using verified data whenever possible. You can explain live/current matches, past matches, upcoming matches, team form, player details when available, team history, comparisons, and basic match predictions. Never hallucinate live scores or exact statistics. If verified data is unavailable, say so briefly.

Use your general sports knowledge for stable historical context, but use the available data when it can provide team metadata, live matches, schedules, players, scorecards, or squads. Do not say a general team-history or comparison question is unsupported just because no live-score data is needed.
This version of SportBot covers cricket and football. If asked about another sport, briefly say that more sports are planned for a future version.

Formatting rules:
- Keep responses concise and easy to scan.
- Answer the user's sports question directly. Never mention APIs, endpoints, tools, databases, providers, fallback logic, model names, implementation details, or that this is a student/mini project.
- Understand common team abbreviations, competition shortcuts, informal wording, and minor spelling mistakes.
- For match lists, show at most 5 matches unless the user asks for more.
- Prefer this compact format for matches:
  ### Match title
  **Status:** ...
  **Score:** Team 1 123/4 (20 ov); Team 2 124/3 (18.2 ov)
  **Venue:** ...
  **Date:** ...
- Do not print very long raw lists.
- For football match lists, show match, status, teams, score if available, league, venue, and date.
- Format player search with player name, country if available, and role if available.
- Prefix cricket player names with 🏏 and football player names with ⚽.
- For player or squad questions, include a compact profile and recent verified performance when available.
- For team-and-player questions, show a short team overview followed by at most five important or requested players.
- Format team profiles with team name, league, country, formed year, stadium, short history, and badge URL if available.
- For team comparisons, use a compact table or short sections: overview, history, strengths, recent verified matches if available, and caveat.
- For recent form questions, summarize the team's available recent/current results directly. Do not explain how the results were obtained.
- Format scorecards with team innings, runs/wickets/overs, and top performers if available.
- Format predictions with favorite, confidence, why, risks, and disclaimer.`;

const EMPTY_RESPONSE_MESSAGE =
  "I could not generate a response this time. Please try again.";
const FRIENDLY_MODEL_ERROR =
  "I could not generate a sports answer right now. Please try again shortly.";
const NOT_FOUND_MESSAGE =
  "I could not find verified data for that question. Please add the sport, team, competition, and date.";
const GEMINI_MODEL = process.env.GOOGLE_GENERATIVE_AI_MODEL ?? "gemini-2.5-flash";
const CRICKET_TEAM_NAMES = [
  "India",
  "Australia",
  "England",
  "New Zealand",
  "Pakistan",
  "South Africa",
  "Sri Lanka",
  "Bangladesh",
  "Afghanistan",
  "Chennai Super Kings",
  "Royal Challengers Bengaluru",
  "Sunrisers Hyderabad",
  "Mumbai Indians",
  "Kolkata Knight Riders",
  "Delhi Capitals",
  "Rajasthan Royals",
  "Punjab Kings",
  "Gujarat Titans",
  "Lucknow Super Giants"
];
const FOOTBALL_WORLD_CUP_WINS: Record<
  string,
  { years: number[]; latestResult: string }
> = {
  Argentina: {
    years: [1978, 1986, 2022],
    latestResult: "Argentina defeated France on penalties after a 3-3 draw in the 2022 final."
  },
  Brazil: {
    years: [1958, 1962, 1970, 1994, 2002],
    latestResult: "Brazil defeated Germany 2-0 in the 2002 final."
  },
  England: {
    years: [1966],
    latestResult: "England defeated West Germany 4-2 after extra time in the 1966 final."
  },
  France: {
    years: [1998, 2018],
    latestResult: "France defeated Croatia 4-2 in the 2018 final."
  },
  Germany: {
    years: [1954, 1974, 1990, 2014],
    latestResult: "Germany defeated Argentina 1-0 after extra time in the 2014 final."
  },
  Italy: {
    years: [1934, 1938, 1982, 2006],
    latestResult: "Italy defeated France on penalties after a 1-1 draw in the 2006 final."
  },
  Spain: {
    years: [2010, 2026],
    latestResult: "Spain defeated Argentina 1-0 after extra time in the 2026 final."
  },
  Uruguay: {
    years: [1930, 1950],
    latestResult: "Uruguay's most recent title came in 1950 after defeating Brazil 2-1 in the decisive match."
  }
};

function formatToolError(_error: unknown): string {
  return "Verified sports information is temporarily unavailable. Please try again later.";
}

function latestUserQuestion(messages: ClientMessage[]): string {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function isRecentFormQuestion(question: string): boolean {
  return /(recent|form|last results?|last matches?)/i.test(question);
}

function isCompletedMatchQuestion(question: string): boolean {
  return (
    /(yesterday|who won|winner|won the|match result|results? (?:from|for|on)|\bscore\b.*\b20\d{2}-\d{2}-\d{2}\b)/i.test(
      question
    ) &&
    !/(predict|prediction|likely|will win|can win)/i.test(question)
  );
}

function isFootballQuestion(question: string): boolean {
  return /(football|soccer|premier league|indian super league|la liga|champions league|arsenal|chelsea|liverpool|manchester|barcelona|real madrid|paris saint-germain|psg|bayern|juventus|inter milan|ac milan|argentina|brazil|france|germany|italy|spain|uruguay|portugal|netherlands|messi|ronaldo|mbappe|chhetri|haaland|yamal|neymar)/i.test(
    question
  );
}

function isDirectFootballDataQuestion(question: string): boolean {
  return (
    isFootballQuestion(question) &&
    /(today|live|current|past|previous|recent|form|last|next|upcoming|schedule|fixtures?|profile|history|about|team)/i.test(
      question
    )
  );
}

function isFootballPredictionQuestion(question: string): boolean {
  return (
    isFootballQuestion(question) &&
    /\b(will win|can win|likely|predict|prediction|chances|favorite)\b/i.test(question)
  );
}

function isOtherSportQuestion(question: string): boolean {
  return (
    /\b(badminton|baseball|basketball|boxing|formula 1|f1|golf|hockey|kabaddi|motogp|rugby|tennis|volleyball)\b/i.test(
      question
    ) &&
    !isFootballQuestion(question) &&
    !/\b(cricket|ipl|t20|odi|test match)\b/i.test(question)
  );
}

function isHistoricalSportsQuestion(question: string): boolean {
  const currentYear = Number(todayIsoDate().slice(0, 4));
  const years = [...question.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((match) => Number(match[1]));

  return (
    years.some((year) => year < currentYear) ||
    /\b(old|historical|all-time|classic match|world cup final)\b/i.test(question)
  );
}

function isTournamentHistoryQuestion(question: string): boolean {
  const mentionsTournament =
    /\b(fifa|world cup|champions league|champions trophy|asia cup|euros?|copa america|ipl|league title|trophy|championship)\b/i.test(
      question
    );
  const asksHistory = /\b(when|which year|how many|last|previous|history|won|win|champion|title)\b/i.test(
    question
  ) || /\b(latest|current|present|winner)\b/i.test(question);

  return (
    mentionsTournament &&
    asksHistory &&
    !/\b(will win|can win|likely|predict|prediction|chances|favorite)\b/i.test(question)
  );
}

function mentionedCricketTeams(question: string): string[] {
  const lowerQuestion = question.toLowerCase();
  return CRICKET_TEAM_NAMES.filter((team) => {
    const escapedTeam = team.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escapedTeam}\\b`, "i").test(lowerQuestion);
  });
}

function isTeamMatchLookupQuestion(question: string): boolean {
  return (
    mentionedCricketTeams(question).length > 0 &&
    /(score|latest|last|next|upcoming|today|current|result|matches?)/i.test(question) &&
    !/(predict|prediction|likely|will win|can win|recent form)/i.test(question)
  );
}

function isPlayerStatsQuestion(question: string): boolean {
  return (
    /(player|kohli|rohit|dhoni|stats|statistics|career|records?|runs|goals)/i.test(question) &&
    /(stats|statistics|career|records?|runs|goals|performance)/i.test(question)
  );
}

function isTeamOrPlayerInfoQuestion(question: string): boolean {
  return /\b(players?|squad|roster|team info|team profile|player info|player profile|recent performance|career stats|statistics|records?)\b/i.test(
    question
  );
}

function addImplicitSportContext(question: string): string {
  if (
    mentionedCricketTeams(question).length > 0 &&
    !isFootballQuestion(question) &&
    !/\b(cricket|ipl|t20|odi|test match|world cup)\b/i.test(question) &&
    /(score|result|match|form|stats|history|won|next|latest|last)/i.test(question)
  ) {
    return `${question} cricket`;
  }

  return question;
}

function formatMatch(match: NormalizedMatch): string {
  const score = match.score.length
    ? match.score
        .map((item) => {
          const runs = item.runs ?? "-";
          const wickets = item.wickets ?? "-";
          const overs = item.overs ?? "-";
          return `${item.inning ?? "Innings"} ${runs}/${wickets} (${overs} ov)`;
        })
        .join("; ")
    : "Score not available";

  return [
    `### ${match.name}`,
    `**Status:** ${match.status ?? "Unavailable"}`,
    `**Teams:** ${match.teams.join(" vs ") || "Unavailable"}`,
    `**Score:** ${score}`,
    `**Venue:** ${match.venue ?? "Unavailable"}`,
    `**Date:** ${match.date ?? "Unavailable"}`
  ].join("\n");
}

function formatPlayer(player: NormalizedPlayer, emoji = "🏏"): string {
  return [
    `- ${emoji} **${player.name}**`,
    `  Country: ${player.country ?? "Unavailable"}`,
    `  Role: ${player.role ?? "Unavailable"}`
  ].join("\n");
}

function conciseDescription(description: string, maxLength = 500): string {
  if (description.length <= maxLength) {
    return description;
  }

  const shortened = description.slice(0, maxLength);
  const sentenceEnd = shortened.lastIndexOf(".");
  return sentenceEnd >= Math.floor(maxLength * 0.55)
    ? shortened.slice(0, sentenceEnd + 1)
    : `${shortened.trimEnd()}…`;
}

function formatTeamBrief(team: SportsDbTeam, emoji: "🏏" | "⚽"): string {
  return [
    `### ${emoji} ${team.name}`,
    `**League:** ${team.league ?? "Unavailable"}`,
    `**Country:** ${team.country ?? "Unavailable"}`,
    `**Formed:** ${team.formedYear ?? "Unavailable"}`,
    `**Stadium:** ${team.stadium ?? "Unavailable"}`,
    team.description ? conciseDescription(team.description) : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function formatFootballEvent(event: SportsDbEvent): string {
  const score =
    event.homeScore || event.awayScore
      ? `${event.homeTeam ?? "Home"} ${event.homeScore ?? "-"} - ${event.awayScore ?? "-"} ${event.awayTeam ?? "Away"}`
      : "Score not available";

  return [
    `### ${event.name}`,
    `**Status:** ${event.status ?? "Scheduled/unknown"}`,
    `**Teams:** ${[event.homeTeam, event.awayTeam].filter(Boolean).join(" vs ") || "Unavailable"}`,
    `**Score:** ${score}`,
    `**League:** ${event.league ?? "Unavailable"}`,
    `**Venue:** ${event.venue ?? "Unavailable"}`,
    `**Date:** ${event.date ?? "Unavailable"}`
  ].join("\n");
}

function extractPlayerName(question: string): string {
  const cleaned = question
    .replace(/tell me about|show|find/gi, "")
    .replace(/search/gi, "")
    .replace(/stats/gi, "")
    .replace(/player/gi, "")
    .replace(/recent|latest|performance|profile|career|records?|information|info/gi, "")
    .replace(/\?/g, "")
    .trim();

  return cleaned || "Virat Kohli";
}

function extractTeamName(question: string): string {
  const knownTeams: Record<string, string> = {
    csk: "Chennai Super Kings",
    srh: "Sunrisers Hyderabad",
    rcb: "Royal Challengers Bengaluru",
    mi: "Mumbai Indians",
    kkr: "Kolkata Knight Riders",
    dc: "Delhi Capitals",
    rr: "Rajasthan Royals",
    pbks: "Punjab Kings",
    gt: "Gujarat Titans",
    lsg: "Lucknow Super Giants",
    india: "India",
    australia: "Australia",
    england: "England",
    "new zealand": "New Zealand",
    pakistan: "Pakistan",
    "south africa": "South Africa",
    sri: "Sri Lanka",
    "sri lanka": "Sri Lanka",
    bangladesh: "Bangladesh",
    afghanistan: "Afghanistan"
  };
  const lowerQuestion = question.toLowerCase();
  const matchedKey = Object.keys(knownTeams).find((team) => lowerQuestion.includes(team));

  if (matchedKey) {
    return knownTeams[matchedKey];
  }

  return question
    .replace(/show|recent|form|matches|match|results|last|for|of|\?/gi, "")
    .trim();
}

function extractFootballTeamName(question: string): string {
  const knownTeams: Record<string, string> = {
    india: "India",
    "india national": "India",
    argentina: "Argentina",
    brazil: "Brazil",
    france: "France",
    germany: "Germany",
    italy: "Italy",
    spain: "Spain",
    uruguay: "Uruguay",
    portugal: "Portugal",
    netherlands: "Netherlands",
    arsenal: "Arsenal",
    chelsea: "Chelsea",
    liverpool: "Liverpool",
    "man city": "Manchester City",
    "manchester city": "Manchester City",
    "man united": "Manchester United",
    "manchester united": "Manchester United",
    barcelona: "Barcelona",
    "real madrid": "Real Madrid",
    psg: "Paris Saint-Germain",
    bayern: "Bayern Munich",
    juventus: "Juventus",
    "inter milan": "Inter Milan",
    "ac milan": "AC Milan"
  };
  const lowerQuestion = question.toLowerCase();
  const matchedKey = Object.keys(knownTeams).find((team) => lowerQuestion.includes(team));

  if (matchedKey) {
    return knownTeams[matchedKey];
  }

  return question
    .replace(/show|football|soccer|past|previous|recent|form|upcoming|next|matches|match|fixtures|fixture|live|today|for|of|\?/gi, "")
    .trim();
}

function todayIsoDate(): string {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.SPORTS_TIME_ZONE ?? "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((parts, part) => {
      if (part.type !== "literal") {
        parts[part.type] = part.value;
      }
      return parts;
    }, {});

  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function requestedResultDate(question: string): string {
  const explicitDate = question.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (explicitDate) {
    return explicitDate;
  }

  return /\byesterday\b/i.test(question) ? shiftIsoDate(todayIsoDate(), -1) : todayIsoDate();
}

function matchDate(match: NormalizedMatch): string | undefined {
  return match.date?.slice(0, 10) || match.dateTimeGMT?.slice(0, 10);
}

function formatCompletedCricketMatch(match: NormalizedMatch): string {
  const winner = match.status?.match(/(.+?) won(?: by|$)/i)?.[1]?.trim();
  return [
    `### ${match.name}`,
    `**Result:** ${match.status ?? "Completed; result details unavailable"}`,
    winner ? `**Winner:** ${winner}` : "",
    `**Score:** ${
      match.score.length
        ? match.score
            .map(
              (score) =>
                `${score.inning ?? "Innings"} ${score.runs ?? "-"}/${score.wickets ?? "-"} (${score.overs ?? "-"} ov)`
            )
            .join("; ")
        : "Unavailable"
    }`,
    `**Date:** ${match.date ?? match.dateTimeGMT ?? "Unavailable"}`
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCompletedFootballMatch(event: SportsDbEvent): string {
  const homeScore = Number(event.homeScore);
  const awayScore = Number(event.awayScore);
  let result = "Result unavailable";

  if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
    result =
      homeScore > awayScore
        ? `${event.homeTeam ?? "Home team"} won`
        : awayScore > homeScore
          ? `${event.awayTeam ?? "Away team"} won`
          : "Draw";
  }

  return [
    `### ${event.name}`,
    `**Result:** ${result}`,
    `**Score:** ${event.homeTeam ?? "Home"} ${event.homeScore ?? "-"} - ${event.awayScore ?? "-"} ${
      event.awayTeam ?? "Away"
    }`,
    `**Competition:** ${event.league ?? "Unavailable"}`,
    `**Date:** ${event.date ?? "Unavailable"}`
  ].join("\n");
}

async function answerCompletedMatchQuestion(messages: ClientMessage[]): Promise<string> {
  const question = latestUserQuestion(messages);
  if (isHistoricalSportsQuestion(question) && !/\b20\d{2}-\d{2}-\d{2}\b/.test(question)) {
    return webAnswerOrNotFound(messages);
  }

  const date = requestedResultDate(question);
  const footballOnly = isFootballQuestion(question);
  const requestedCricketTeams = mentionedCricketTeams(question);
  const cricketOnly =
    /\b(cricket|ipl|t20|odi|test match|world cup)\b/i.test(question) ||
    (requestedCricketTeams.length > 0 && !footballOnly);

  const [cricketResult, footballResult] = await Promise.allSettled([
    footballOnly ? Promise.resolve([]) : Promise.all([getMatches(0), getCurrentMatches(0)]),
    cricketOnly ? Promise.resolve([]) : getFootballMatchesByDate(date)
  ]);

  const cricketMatches =
    cricketResult.status === "fulfilled"
      ? cricketResult.value
          .flat()
          .filter((match, index, matches) => matchDate(match) === date && matches.findIndex((item) => item.id === match.id) === index)
          .filter((match) => requestedCricketTeams.every((team) => matchMentionsTeam(match, team)))
          .filter((match) => match.matchEnded || /\b(won|draw|no result|abandon)/i.test(match.status ?? ""))
      : [];
  const footballMatches =
    footballResult.status === "fulfilled"
      ? footballResult.value.filter(
          (event) => event.homeScore !== undefined && event.awayScore !== undefined
        )
      : [];

  if (cricketMatches.length || footballMatches.length) {
    const sections = [
      cricketMatches.length
        ? `## Cricket results for ${date}\n\n${cricketMatches.slice(0, 5).map(formatCompletedCricketMatch).join("\n\n")}`
        : "",
      footballMatches.length
        ? `## Football results for ${date}\n\n${footballMatches.slice(0, 5).map(formatCompletedFootballMatch).join("\n\n")}`
        : ""
    ].filter(Boolean);

    return [
      sections.join("\n\n"),
      "",
      cricketMatches.length + footballMatches.length > 1
        ? "There was more than one completed match. Tell me the team, tournament, or league if you meant a specific one."
        : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  const webAnswer = await searchSportsWeb(messages, todayIsoDate());
  if (webAnswer) {
    return `## Web result for ${date}\n\n${webAnswer}`;
  }

  return [
    `I could not verify a completed match result for ${date}.`,
    "",
    "Please include the sport, team, tournament, or league—for example: “Who won yesterday’s India cricket match?”"
  ].join("\n");
}

function matchMentionsTeam(match: NormalizedMatch, teamName: string): boolean {
  const lowerTeam = teamName.toLowerCase();
  const escapedTeam = lowerTeam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const teamPattern = new RegExp(`\\b${escapedTeam}\\b`, "i");

  return (
    match.teams.some((team) => team.toLowerCase() === lowerTeam) ||
    teamPattern.test(match.name)
  );
}

async function webAnswerOrNotFound(messages: ClientMessage[]): Promise<string> {
  try {
    return (await searchSportsWeb(messages, todayIsoDate())) ?? NOT_FOUND_MESSAGE;
  } catch (error) {
    console.error("Sports web search failed:", error instanceof Error ? error.message : error);
    return NOT_FOUND_MESSAGE;
  }
}

async function answerHistoricalSportsQuestion(messages: ClientMessage[]): Promise<string> {
  return webAnswerOrNotFound(messages);
}

async function answerTournamentHistoryQuestion(messages: ClientMessage[]): Promise<string> {
  const question = latestUserQuestion(messages);
  const lowerQuestion = question.toLowerCase();
  const asksCurrentWinner = /\b(latest|current|present|2026|who won|winner|champion)\b/i.test(
    question
  );

  if (/\b(t20|twenty20)\b/i.test(question) && /\bworld cup\b/i.test(question)) {
    if (/\b(women|women's|womens)\b/i.test(question)) {
      return [
        "## 2026 Women's T20 World Cup winner",
        "",
        "**Australia** won the 2026 ICC Women's T20 World Cup.",
        "",
        "Australia defeated England by 7 wickets in the final at Lord's on 5 July 2026.",
        "",
        "[Source: ICC](https://www.icc-cricket.com/tournaments/womens-t20-worldcup-2026/news/england-australia-final-womens-t20-world-cup-2026)"
      ].join("\n");
    }

    if (asksCurrentWinner && !lowerQuestion.includes("india")) {
      return [
        "## 2026 Men's T20 World Cup winner",
        "",
        "**India** won the 2026 ICC Men's T20 World Cup.",
        "",
        "India defeated New Zealand by 96 runs in the final at Ahmedabad on 8 March 2026. India scored 255/5 and dismissed New Zealand for 159.",
        "",
        "[Source: ICC](https://www.icc-cricket.com/tournaments/mens-t20-world-cup-2026/news/live-india-new-zealand-chase-world-cup-glory)"
      ].join("\n");
    }
  }

  if (lowerQuestion.includes("india") && /\bworld cup\b/i.test(question)) {
    if (/\bt20\b/i.test(question)) {
      return [
        "## India men's T20 World Cup titles",
        "",
        "India have won the men's T20 World Cup three times: **2007, 2024, and 2026**.",
        "",
        "**Most recent title:** 8 March 2026 — India defeated New Zealand by 96 runs in the final at Ahmedabad. India scored 255/5 and dismissed New Zealand for 159.",
        "",
        "[Source: ICC](https://www.icc-cricket.com/tournaments/mens-t20-world-cup-2026/news/live-india-new-zealand-chase-world-cup-glory)"
      ].join("\n");
    }

    if (/\b(odi|one-day|50-over|cricket)\b/i.test(question)) {
      return [
        "## India men's ODI World Cup titles",
        "",
        "India have won the men's ODI Cricket World Cup twice: **1983** and **2011**.",
        "",
        "**Most recent title:** 2 April 2011 — India defeated Sri Lanka by 6 wickets in the final at Wankhede Stadium, Mumbai."
      ].join("\n");
    }

    return [
      "## India's men's Cricket World Cup titles",
      "",
      "- **ODI World Cup:** 1983 and 2011",
      "- **T20 World Cup:** 2007, 2024, and 2026",
      "",
      "Tell me ODI or T20 if you want the final score and opponent."
    ].join("\n");
  }

  if (/\b(world cup|fifa)\b/i.test(question)) {
    const explicitFootball = /\b(football|soccer|fifa)\b/i.test(question);
    const teamName = Object.keys(FOOTBALL_WORLD_CUP_WINS).find((team) =>
      new RegExp(`\\b${team}\\b`, "i").test(question)
    );
    const isUnambiguousFootballTeam =
      teamName !== undefined && !CRICKET_TEAM_NAMES.includes(teamName);

    if (teamName && (explicitFootball || isUnambiguousFootballTeam)) {
      const record = FOOTBALL_WORLD_CUP_WINS[teamName];
      return [
        `## ${teamName} FIFA World Cup titles`,
        "",
        `${teamName} ${record.years.length === 1 ? "have" : "have"} won the men's FIFA World Cup ${
          record.years.length
        } ${record.years.length === 1 ? "time" : "times"}: **${record.years.join(", ")}**.`,
        "",
        `**Most recent title:** ${record.latestResult}`
      ].join("\n");
    }

    if (explicitFootball && asksCurrentWinner) {
      return [
        "## 2026 FIFA World Cup winner",
        "",
        "**Spain** won the 2026 men's FIFA World Cup.",
        "",
        "Spain defeated Argentina 1-0 after extra time in the final on 19 July 2026. Ferran Torres scored the winning goal in the 106th minute.",
        "",
        "[Source: FIFA](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/spain-argentina-final-report-highlights)"
      ].join("\n");
    }
  }

  return webAnswerOrNotFound(messages);
}

async function answerPlayerStatsQuestion(messages: ClientMessage[]): Promise<string> {
  const question = latestUserQuestion(messages);
  let players: NormalizedPlayer[] = [];

  try {
    players = await searchPlayers(extractPlayerName(question), 0);
  } catch {
    players = [];
  }

  const webAnswer = await webAnswerOrNotFound(messages);
  if (webAnswer !== NOT_FOUND_MESSAGE) {
    return webAnswer;
  }

  return players.length
    ? `## Player information\n\n${players.slice(0, 5).map((player) => formatPlayer(player)).join("\n\n")}`
    : NOT_FOUND_MESSAGE;
}

async function answerTeamOrPlayerInfoQuestion(messages: ClientMessage[]): Promise<string> {
  const question = latestUserQuestion(messages);
  const football = isFootballQuestion(question);
  const emoji: "🏏" | "⚽" = football ? "⚽" : "🏏";
  const blocks: string[] = [];
  const wantsTeam = /\b(team|squad|roster|players)\b/i.test(question);

  if (wantsTeam) {
    try {
      const team = football
        ? await getFootballTeamProfile(extractFootballTeamName(question))
        : await getTeamProfile(extractTeamName(question));
      if (team) {
        blocks.push(formatTeamBrief(team, emoji));
      }
    } catch {
      // The verified web response below remains available.
    }

    if (/\bindia\b/i.test(question)) {
      const indiaPlayers = football
        ? [
            "- ⚽ **Sunil Chhetri** — Forward",
            "- ⚽ **Gurpreet Singh Sandhu** — Goalkeeper",
            "- ⚽ **Sandesh Jhingan** — Defender",
            "- ⚽ **Lallianzuala Chhangte** — Winger",
            "- ⚽ **Manvir Singh** — Forward"
          ]
        : [
            "- 🏏 **Shubman Gill** — Batter",
            "- 🏏 **Suryakumar Yadav** — Batter",
            "- 🏏 **Jasprit Bumrah** — Fast bowler",
            "- 🏏 **Hardik Pandya** — All-rounder",
            "- 🏏 **Sanju Samson** — Wicketkeeper-batter"
          ];

      if (!blocks.length) {
        blocks.push(
          football
            ? [
                "### ⚽ India national football team",
                "**Nickname:** Blue Tigers",
                "**Competition:** FIFA, AFC, and SAFF international football"
              ].join("\n")
            : [
                "### 🏏 India national cricket team",
                "**Formats:** Tests, ODIs, and T20Is",
                "**Country:** India"
              ].join("\n")
        );
      }

      blocks.push(`### ${emoji} Notable India players\n\n${indiaPlayers.join("\n")}`);
    }
  }

  const wantsSpecificPlayer =
    !/\bplayers\b/i.test(question) &&
    /\b(player|stats|statistics|recent performance|career|records?|kohli|rohit|dhoni|bumrah|gill|jadeja|hardik)\b/i.test(
      question
    );
  if (wantsSpecificPlayer && !football) {
    try {
      const players = await searchPlayers(extractPlayerName(question), 0);
      if (players.length) {
        blocks.push(`### 🏏 Player profile\n\n${players.slice(0, 3).map((player) => formatPlayer(player)).join("\n\n")}`);
      }
    } catch {
      // The verified web response below remains available.
    }
  }

  const latestUserIndex = messages.map((message) => message.role).lastIndexOf("user");
  const webMessages = messages.map((message, index) =>
    index === latestUserIndex
      ? {
          ...message,
          content: `${message.content} ${football ? "football" : "cricket"}`
        }
      : message
  );
  const webAnswer = await webAnswerOrNotFound(webMessages);
  const decoratedWebAnswer =
    webAnswer === NOT_FOUND_MESSAGE
      ? webAnswer
      : webAnswer.replace(/^### (?!🏏|⚽)/gmu, `### ${emoji} `);
  const heading = football ? "## ⚽ Football team and player update" : "## 🏏 Cricket team and player update";

  return [
    heading,
    "",
    ...blocks,
    decoratedWebAnswer !== NOT_FOUND_MESSAGE
      ? decoratedWebAnswer
      : blocks.length
        ? ""
        : NOT_FOUND_MESSAGE
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function answerTeamMatchLookup(messages: ClientMessage[]): Promise<string> {
  const question = latestUserQuestion(messages);
  const teams = mentionedCricketTeams(question);
  const [currentResult, listedResult] = await Promise.allSettled([getCurrentMatches(0), getMatches(0)]);
  const matches = [
    ...(currentResult.status === "fulfilled" ? currentResult.value : []),
    ...(listedResult.status === "fulfilled" ? listedResult.value : [])
  ]
    .filter((match, index, allMatches) => allMatches.findIndex((item) => item.id === match.id) === index)
    .filter((match) => teams.every((team) => matchMentionsTeam(match, team)));
  const wantsUpcoming = /(next|upcoming|schedule|fixture|tomorrow)/i.test(question);
  const wantsCompleted = /(last|latest|result|won)/i.test(question);
  const candidates = matches
    .filter((match) => {
      const date = matchDate(match);
      if (wantsUpcoming) {
        return !match.matchEnded && (!date || date >= todayIsoDate());
      }
      if (wantsCompleted) {
        return match.matchEnded || /\b(won|draw|no result|abandon)/i.test(match.status ?? "");
      }
      return true;
    })
    .sort((matchA, matchB) => {
      const dateA = matchDate(matchA) ?? "";
      const dateB = matchDate(matchB) ?? "";
      return wantsUpcoming ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
    });

  if (!candidates.length) {
    return webAnswerOrNotFound(messages);
  }

  const heading = wantsUpcoming
    ? `${teams.join(" vs ")} upcoming matches`
    : `${teams.join(" vs ")} latest match information`;
  return `## ${heading}\n\n${candidates.slice(0, wantsUpcoming ? 3 : 1).map(formatMatch).join("\n\n")}`;
}

async function getRecentTeamMatches(teamName: string): Promise<NormalizedMatch[]> {
  const [currentMatches, listedMatches] = await Promise.allSettled([getCurrentMatches(0), getMatches(0)]);
  const matches = [
    ...(currentMatches.status === "fulfilled" ? currentMatches.value : []),
    ...(listedMatches.status === "fulfilled" ? listedMatches.value : [])
  ];
  const seen = new Set<string>();

  return matches
    .filter((match) => matchMentionsTeam(match, teamName))
    .filter((match) => match.matchEnded || /\b(won|draw|no result|abandon)/i.test(match.status ?? ""))
    .filter((match) => !matchDate(match) || matchDate(match)! <= todayIsoDate())
    .filter((match) => {
      if (seen.has(match.id)) {
        return false;
      }

      seen.add(match.id);
      return true;
    })
    .sort((matchA, matchB) => (matchDate(matchB) ?? "").localeCompare(matchDate(matchA) ?? ""))
    .slice(0, 5);
}

async function answerRecentFormQuestion(messages: ClientMessage[]): Promise<string> {
  const question = latestUserQuestion(messages);
  const teamName = extractTeamName(question);
  const matches = await getRecentTeamMatches(teamName);

  if (!matches.length) {
    return webAnswerOrNotFound(messages);
  }

  return [
    `## ${teamName} recent form`,
    "",
    matches.map(formatMatch).join("\n\n")
  ].join("\n");
}

async function answerFootballQuestion(messages: ClientMessage[]): Promise<string> {
  const question = latestUserQuestion(messages);
  if (/(today|live|current)/i.test(question)) {
    const matches = await getFootballMatchesByDate(todayIsoDate());
    if (!matches.length) {
      return webAnswerOrNotFound(messages);
    }

    return `## Football matches today\n\n${matches.slice(0, 5).map(formatFootballEvent).join("\n\n")}`;
  }

  if (/(past|previous|recent|form|last)/i.test(question)) {
    const teamName = extractFootballTeamName(question);
    const matches = await getFootballTeamPastMatches(teamName);
    if (!matches.length) {
      return webAnswerOrNotFound(messages);
    }

    return `## ${teamName} past matches\n\n${matches.slice(0, 5).map(formatFootballEvent).join("\n\n")}`;
  }

  if (/(next|upcoming|schedule|fixtures)/i.test(question)) {
    const teamName = extractFootballTeamName(question);
    const matches = await getFootballTeamNextMatches(teamName);
    if (!matches.length) {
      return webAnswerOrNotFound(messages);
    }

    return `## ${teamName} upcoming matches\n\n${matches.slice(0, 5).map(formatFootballEvent).join("\n\n")}`;
  }

  if (/(profile|history|about|team)/i.test(question)) {
    const teamName = extractFootballTeamName(question);
    const team = await getFootballTeamProfile(teamName);
    if (!team) {
      return webAnswerOrNotFound(messages);
    }

    return [
      `## ${team.name}`,
      `**Sport:** ${team.sport ?? "Football"}`,
      `**League:** ${team.league ?? "Unavailable"}`,
      `**Country:** ${team.country ?? "Unavailable"}`,
      `**Formed:** ${team.formedYear ?? "Unavailable"}`,
      `**Stadium:** ${team.stadium ?? "Unavailable"}`,
      team.badge ? `**Badge:** ${team.badge}` : "",
      "",
      team.description ? team.description.slice(0, 900) : "A detailed team description is not available right now."
    ]
      .filter(Boolean)
      .join("\n");
  }

  return webAnswerOrNotFound(messages);
}

function textResponse(content: string): Response {
  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

async function localSportsFallback(messages: ClientMessage[], _error?: unknown): Promise<string> {
  const question = latestUserQuestion(messages);
  const lowerQuestion = question.toLowerCase();
  const errorNote = "";

  try {
    if (isOtherSportQuestion(question)) {
      return "SportBot currently covers cricket and football. More sports are planned for a future version.";
    }

    if (isTournamentHistoryQuestion(question)) {
      return `${errorNote}${await answerTournamentHistoryQuestion(messages)}`;
    }

    if (isTeamOrPlayerInfoQuestion(question)) {
      return `${errorNote}${await answerTeamOrPlayerInfoQuestion(messages)}`;
    }

    if (isCompletedMatchQuestion(question)) {
      return `${errorNote}${await answerCompletedMatchQuestion(messages)}`;
    }

    if (isHistoricalSportsQuestion(question)) {
      return `${errorNote}${await answerHistoricalSportsQuestion(messages)}`;
    }

    if (isFootballPredictionQuestion(question)) {
      return `${errorNote}${await webAnswerOrNotFound(messages)}`;
    }

    if (isDirectFootballDataQuestion(question)) {
      return `${errorNote}${await answerFootballQuestion(messages)}`;
    }

    if (isTeamMatchLookupQuestion(question)) {
      return `${errorNote}${await answerTeamMatchLookup(messages)}`;
    }

    if (isPlayerStatsQuestion(question)) {
      return `${errorNote}${await answerPlayerStatsQuestion(messages)}`;
    }

    if (isRecentFormQuestion(question)) {
      return `${errorNote}${await answerRecentFormQuestion(messages)}`;
    }

    if (/(current|live|today|match|matches|score)/i.test(question) && !/(likely|predict|prediction|win)/i.test(question)) {
      const matches = await getCurrentMatches(0);
      if (!matches.length) {
        return `${errorNote}${await webAnswerOrNotFound(messages)}`;
      }

      return `${errorNote}## Current cricket matches\n\n${matches.slice(0, 5).map(formatMatch).join("\n\n")}`;
    }

    if (/(search|player|kohli|stats)/i.test(question)) {
      const players = await searchPlayers(extractPlayerName(question), 0);
      if (!players.length) {
        return `${errorNote}${await webAnswerOrNotFound(messages)}`;
      }

      return `${errorNote}Player search results:\n\n${players
        .slice(0, 5)
        .map((player) => formatPlayer(player))
        .join("\n\n")}`;
    }

    if (/(likely|predict|prediction|will win|can win|chances|favorite)/i.test(question)) {
      const matches = await getCurrentMatches(0);
      const candidate = matches.find((match) => !match.matchEnded) ?? matches[0];

      if (!candidate || candidate.teams.length < 2) {
        return `${errorNote}I need two teams or an upcoming/live match with team names to make a basic prediction. There is not enough verified match information right now.`;
      }

      const prediction = predictMatch({
        teamA: candidate.teams[0],
        teamB: candidate.teams[1],
        venue: candidate.venue,
        notes: candidate.status
      });

      return [
        errorNote,
        `Basic prediction for ${candidate.name}:`,
        "",
        `Favorite: ${prediction.favorite}`,
        `Confidence: ${prediction.confidence}%`,
        `Why: ${prediction.explanation}`,
        "",
        "Key factors:",
        ...prediction.keyFactors.map((factor) => `- ${factor}`),
        "",
        "Risks:",
        ...prediction.risks.map((risk) => `- ${risk}`),
        "",
        `Disclaimer: ${prediction.disclaimer}`
      ].join("\n");
    }

    if (/(history|profile|about|csk|super kings|team)/i.test(question)) {
      const teamName = lowerQuestion.includes("csk") ? "Chennai Super Kings" : question.replace(/explain|history|profile|about|team/gi, "").trim();
      const team = await getTeamProfile(teamName || "Chennai Super Kings");

      if (!team) {
        return `${errorNote}${await webAnswerOrNotFound(messages)}`;
      }

      return [
        errorNote,
        `## ${team.name}`,
        `**League:** ${team.league ?? "Unavailable"}`,
        `**Country:** ${team.country ?? "Unavailable"}`,
        `**Formed:** ${team.formedYear ?? "Unavailable"}`,
        `**Stadium:** ${team.stadium ?? "Unavailable"}`,
        team.badge ? `**Badge:** ${team.badge}` : "",
        "",
        team.description ? team.description.slice(0, 900) : "A detailed team description is not available right now."
      ]
        .filter(Boolean)
        .join("\n");
    }

    return `${errorNote}${await webAnswerOrNotFound(messages)}`;
  } catch {
    return NOT_FOUND_MESSAGE;
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as { messages?: CoreMessage[] };
  const clientMessages = (body.messages ?? []).filter((message): message is ClientMessage => {
    return (
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.trim().length > 0 &&
      message.content !== EMPTY_RESPONSE_MESSAGE &&
      !message.content.startsWith("I could not generate a response this time.") &&
      !message.content.startsWith(FRIENDLY_MODEL_ERROR)
    );
  });
  const firstUserIndex = clientMessages.findIndex((message) => message.role === "user");
  const slicedMessages = firstUserIndex >= 0 ? clientMessages.slice(firstUserIndex) : [];
  const latestUserIndex = slicedMessages.map((message) => message.role).lastIndexOf("user");
  const messages = slicedMessages.map((message, index) =>
    index === latestUserIndex
      ? {
          ...message,
          content: addImplicitSportContext(normalizeSportsQuestion(message.content))
        }
      : message
  );

  if (messages.length === 0) {
    return new Response("Please send a football or cricket question to SportBot AI.", { status: 400 });
  }

  const question = latestUserQuestion(messages);
  try {
    if (isOtherSportQuestion(question)) {
      return textResponse(
        "SportBot currently covers cricket and football. More sports are planned for a future version."
      );
    }

    if (isTournamentHistoryQuestion(question)) {
      return textResponse(await answerTournamentHistoryQuestion(messages));
    }

    if (isTeamOrPlayerInfoQuestion(question)) {
      return textResponse(await answerTeamOrPlayerInfoQuestion(messages));
    }

    if (isCompletedMatchQuestion(question)) {
      return textResponse(await answerCompletedMatchQuestion(messages));
    }

    if (isHistoricalSportsQuestion(question)) {
      return textResponse(await answerHistoricalSportsQuestion(messages));
    }

    if (isFootballPredictionQuestion(question)) {
      return textResponse(await webAnswerOrNotFound(messages));
    }

    if (isDirectFootballDataQuestion(question)) {
      return textResponse(await answerFootballQuestion(messages));
    }

    if (isTeamMatchLookupQuestion(question)) {
      return textResponse(await answerTeamMatchLookup(messages));
    }

    if (isPlayerStatsQuestion(question)) {
      return textResponse(await answerPlayerStatsQuestion(messages));
    }

    if (isRecentFormQuestion(question)) {
      return textResponse(await answerRecentFormQuestion(messages));
    }
  } catch (error) {
    return textResponse(await webAnswerOrNotFound(messages));
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return textResponse(await localSportsFallback(messages));
  }

  try {
    const result = streamText({
      model: google(GEMINI_MODEL),
      system: SYSTEM_PROMPT,
      messages,
      maxSteps: 4,
      tools: {
        current_matches: tool({
          description: "Get current/live cricket matches.",
          parameters: z.object({
            offset: z.number().int().min(0).optional().default(0)
          }),
          execute: async ({ offset }) => {
            try {
              return await getCurrentMatches(offset);
            } catch (error) {
              return { error: formatToolError(error) };
            }
          }
        }),
        match_list: tool({
          description: "Get recent/upcoming cricket matches.",
          parameters: z.object({
            offset: z.number().int().min(0).optional().default(0)
          }),
          execute: async ({ offset }) => {
            try {
              return await getMatches(offset);
            } catch (error) {
              return { error: formatToolError(error) };
            }
          }
        }),
        team_recent_form: tool({
          description: "Get recent/current cricket matches for a team to summarize its recent form.",
          parameters: z.object({
            teamName: z.string().min(1)
          }),
          execute: async ({ teamName }) => {
            try {
              const matches = await getRecentTeamMatches(teamName);
              return {
                teamName,
                matches
              };
            } catch (error) {
              return { error: formatToolError(error) };
            }
          }
        }),
        football_matches_today: tool({
          description: "Get today's football/soccer matches.",
          parameters: z.object({}),
          execute: async () => getFootballMatchesByDate(todayIsoDate())
        }),
        football_team_past_matches: tool({
          description: "Get recent/past football matches for a team.",
          parameters: z.object({
            teamName: z.string().min(1)
          }),
          execute: async ({ teamName }) => getFootballTeamPastMatches(teamName)
        }),
        football_team_next_matches: tool({
          description: "Get upcoming football fixtures for a team.",
          parameters: z.object({
            teamName: z.string().min(1)
          }),
          execute: async ({ teamName }) => getFootballTeamNextMatches(teamName)
        }),
        football_team_search: tool({
          description: "Search football/soccer teams.",
          parameters: z.object({
            teamName: z.string().min(1)
          }),
          execute: async ({ teamName }) => searchFootballTeams(teamName)
        }),
        player_search: tool({
          description: "Search cricket players by name.",
          parameters: z.object({
            playerName: z.string().min(1),
            offset: z.number().int().min(0).optional().default(0)
          }),
          execute: async ({ playerName, offset }) => {
            try {
              return await searchPlayers(playerName, offset);
            } catch (error) {
              return { error: formatToolError(error) };
            }
          }
        }),
        match_scorecard: tool({
          description: "Get detailed scorecard for a match.",
          parameters: z.object({
            matchId: z.string().min(1)
          }),
          execute: async ({ matchId }) => {
            try {
              return await getMatchScorecard(matchId);
            } catch (error) {
              return { error: formatToolError(error) };
            }
          }
        }),
        match_squad: tool({
          description: "Get squad details for a match.",
          parameters: z.object({
            matchId: z.string().min(1)
          }),
          execute: async ({ matchId }) => {
            try {
              return await getMatchSquad(matchId);
            } catch (error) {
              return { error: formatToolError(error) };
            }
          }
        }),
        series_info: tool({
          description: "Get series/tournament details.",
          parameters: z.object({
            seriesId: z.string().min(1)
          }),
          execute: async ({ seriesId }) => {
            try {
              return await getSeriesInfo(seriesId);
            } catch (error) {
              return { error: formatToolError(error) };
            }
          }
        }),
        team_search: tool({
          description: "Search cricket teams for metadata, badge, country, league, stadium, and history.",
          parameters: z.object({
            teamName: z.string().min(1)
          }),
          execute: async ({ teamName }) => {
            try {
              return await searchTeams(teamName);
            } catch (error) {
              return {
                error: error instanceof Error ? error.message : "I could not fetch team metadata right now."
              };
            }
          }
        }),
        team_profile: tool({
          description: "Get a cricket team profile and history.",
          parameters: z.object({
            teamName: z.string().min(1)
          }),
          execute: async ({ teamName }) => {
            try {
              return await getTeamProfile(teamName);
            } catch (error) {
              return {
                error: error instanceof Error ? error.message : "I could not fetch team metadata right now."
              };
            }
          }
        }),
        team_compare: tool({
          description: "Get profile metadata for two cricket teams so they can be compared.",
          parameters: z.object({
            teamA: z.string().min(1),
            teamB: z.string().min(1)
          }),
          execute: async ({ teamA, teamB }) => {
            try {
              const [profileA, profileB] = await Promise.all([getTeamProfile(teamA), getTeamProfile(teamB)]);
              return { teamA: profileA, teamB: profileB };
            } catch (error) {
              return {
                error: error instanceof Error ? error.message : "I could not fetch team metadata right now."
              };
            }
          }
        }),
        predict_match: tool({
          description: "Give a basic match prediction using available match/team/player data.",
          parameters: z.object({
            teamA: z.string().min(1),
            teamB: z.string().min(1),
            recentFormA: z.array(z.string()).optional(),
            recentFormB: z.array(z.string()).optional(),
            headToHead: z
              .object({
                teamAWins: z.number().int().min(0).optional(),
                teamBWins: z.number().int().min(0).optional(),
                noResult: z.number().int().min(0).optional()
              })
              .optional(),
            venue: z.string().optional(),
            notes: z.string().optional()
          }),
          execute: async (input) => predictMatch(input)
        })
      }
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let streamedText = "";
        try {
          for await (const textDelta of result.textStream) {
            streamedText += textDelta;
            controller.enqueue(encoder.encode(textDelta));
          }

          if (!streamedText.trim()) {
            controller.enqueue(encoder.encode(await localSportsFallback(messages)));
          }
        } catch (error) {
          controller.enqueue(encoder.encode(await localSportsFallback(messages, error)));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  } catch (error) {
    return new Response(await localSportsFallback(messages, error), { status: 200 });
  }
}
