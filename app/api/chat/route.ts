import { google } from "@ai-sdk/google";
import { streamText, tool, type CoreMessage } from "ai";
import { z } from "zod";
import {
  CricketDataError,
  getCurrentMatches,
  getMatches,
  getMatchScorecard,
  getMatchSquad,
  getSeriesInfo,
  searchPlayers
} from "@/lib/cricketData";
import { predictMatch } from "@/lib/prediction";
import { getTeamProfile, searchTeams } from "@/lib/theSportsDb";
import type { NormalizedMatch, NormalizedPlayer } from "@/types/cricket";

export const runtime = "nodejs";

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `You are CricBot, an AI cricket analyst. Your job is to answer cricket questions using real CricketData API data whenever possible. You can explain live scores, match schedules, player details, scorecards, squads, team form, player form, team history, and basic match predictions. Never hallucinate live scores or exact statistics. If the API does not return required data, say that the data is currently unavailable. For predictions, explain that it is an estimate based on available data and not guaranteed. Keep answers clear, student-project friendly, and useful for cricket fans.

Use your general cricket knowledge for stable historical context, but use tools when they can provide team metadata, live matches, schedules, players, scorecards, or squads. Do not say a general team-history or comparison question is unsupported just because no live-score tool is needed.

Formatting rules:
- Keep responses concise and easy to scan.
- For match lists, show at most 5 matches unless the user asks for more.
- Prefer this compact format for matches:
  ### Match title
  **Status:** ...
  **Score:** Team 1 123/4 (20 ov); Team 2 124/3 (18.2 ov)
  **Venue:** ...
  **Date:** ...
- Do not print very long raw lists.
- Format player search with player name, country if available, role if available, and ID.
- Format team profiles with team name, league, country, formed year, stadium, short history, and badge URL if available.
- For team comparisons, use a compact table or short sections: overview, history, strengths, recent API-backed matches if available, and caveat.
- For recent form questions, use recent/current match results from the match tools as a proxy if no dedicated form endpoint exists. Do not say the tools do not support recent form; explain the limitation and summarize available recent matches.
- Format scorecards with team innings, runs/wickets/overs, and top performers if available.
- Format predictions with favorite, confidence, why, risks, and disclaimer.`;

const EMPTY_RESPONSE_MESSAGE =
  "I could not generate a response this time. Please check the server console and try again.";
const FRIENDLY_MODEL_ERROR =
  "I could not generate a cricket answer right now. Please check that your Gemini API key is valid and try again.";
const GEMINI_MODEL = process.env.GOOGLE_GENERATIVE_AI_MODEL ?? "gemini-2.5-flash";

function formatToolError(error: unknown): string {
  if (error instanceof CricketDataError) {
    return error.message;
  }

  return "I could not fetch live cricket data right now. Please try again later.";
}

function formatModelError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `${FRIENDLY_MODEL_ERROR}\n\nServer detail: ${error.message}`;
  }

  return FRIENDLY_MODEL_ERROR;
}

function latestUserQuestion(messages: ClientMessage[]): string {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function isRecentFormQuestion(question: string): boolean {
  return /(recent|form|last results|last matches)/i.test(question);
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
    `**Date:** ${match.date ?? "Unavailable"}`,
    `**Match ID:** \`${match.id}\``
  ].join("\n");
}

function formatPlayer(player: NormalizedPlayer): string {
  return [
    `- ${player.name}`,
    `  Country: ${player.country ?? "Unavailable"}`,
    `  Role: ${player.role ?? "Unavailable"}`,
    `  ID: ${player.id}`
  ].join("\n");
}

function extractPlayerName(question: string): string {
  const cleaned = question
    .replace(/search/gi, "")
    .replace(/stats/gi, "")
    .replace(/player/gi, "")
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

function matchMentionsTeam(match: NormalizedMatch, teamName: string): boolean {
  const lowerTeam = teamName.toLowerCase();
  return match.name.toLowerCase().includes(lowerTeam) || match.teams.some((team) => team.toLowerCase().includes(lowerTeam));
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
    .filter((match) => {
      if (seen.has(match.id)) {
        return false;
      }

      seen.add(match.id);
      return true;
    })
    .slice(0, 5);
}

async function answerRecentFormQuestion(question: string): Promise<string> {
  const teamName = extractTeamName(question);
  const matches = await getRecentTeamMatches(teamName);

  if (!matches.length) {
    return [
      `## ${teamName || "Team"} recent form`,
      "",
      "I could not find recent/current matches for this team in the CricketData API window right now.",
      "",
      "The API available in this project does not provide a dedicated recent-form endpoint, so CricBot checks current and listed matches as a proxy. Since no matching team results were returned, I should not invent form data.",
      "",
      "Try asking for:",
      "- Show current cricket matches",
      "- Compare India and Australia",
      "- Search Virat Kohli stats"
    ].join("\n");
  }

  return [
    `## ${teamName} recent form`,
    "",
    "The API does not provide a dedicated recent-form endpoint, so this uses recent/current CricketData matches as a form proxy.",
    "",
    matches.map(formatMatch).join("\n\n")
  ].join("\n");
}

function textResponse(content: string): Response {
  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

async function localCricketFallback(messages: ClientMessage[], error?: unknown): Promise<string> {
  const question = latestUserQuestion(messages);
  const lowerQuestion = question.toLowerCase();
  const errorNote =
    error instanceof Error && error.message.includes("denied access")
      ? "Gemini is currently unavailable because the Google project has been denied access, so I am using direct CricketData results instead.\n\n"
      : "";

  try {
    if (isRecentFormQuestion(question)) {
      return `${errorNote}${await answerRecentFormQuestion(question)}`;
    }

    if (/(current|live|today|match|matches|score)/i.test(question) && !/(likely|predict|prediction|win)/i.test(question)) {
      const matches = await getCurrentMatches(0);
      if (!matches.length) {
        return `${errorNote}I could not find current cricket matches from the live API right now.`;
      }

      return `${errorNote}## Current cricket matches\n\n${matches.slice(0, 5).map(formatMatch).join("\n\n")}`;
    }

    if (/(search|player|kohli|stats)/i.test(question)) {
      const players = await searchPlayers(extractPlayerName(question), 0);
      if (!players.length) {
        return `${errorNote}I could not find matching player data from CricketData right now.`;
      }

      return `${errorNote}Player search results:\n\n${players.slice(0, 5).map(formatPlayer).join("\n\n")}`;
    }

    if (/(likely|predict|prediction|win)/i.test(question)) {
      const matches = await getCurrentMatches(0);
      const candidate = matches.find((match) => !match.matchEnded) ?? matches[0];

      if (!candidate || candidate.teams.length < 2) {
        return `${errorNote}I need two teams or an upcoming/live match with team names to make a basic prediction. The live API did not return enough match data right now.`;
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
        return `${errorNote}I could not find a team profile from TheSportsDB for that query.`;
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
        team.description ? team.description.slice(0, 900) : "No team description is available from TheSportsDB."
      ]
        .filter(Boolean)
        .join("\n");
    }

    const matches = await getCurrentMatches(0);
    return `${errorNote}Gemini is unavailable, but CricketData is working. Try asking "Show current cricket matches" or "Search Virat Kohli stats".\n\n## Recent API sample\n\n${matches
      .slice(0, 3)
      .map(formatMatch)
      .join("\n\n")}`;
  } catch (fallbackError) {
    return `${formatModelError(error)}\n\nFallback detail: ${formatToolError(fallbackError)}`;
  }
}

export async function POST(request: Request) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return new Response("Gemini API key is not configured. Add GOOGLE_GENERATIVE_AI_API_KEY in .env.local.", {
      status: 500
    });
  }

  const body = (await request.json()) as { messages?: CoreMessage[] };
  const clientMessages = (body.messages ?? []).filter((message): message is ClientMessage => {
    return (
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.trim().length > 0 &&
      message.content !== EMPTY_RESPONSE_MESSAGE &&
      !message.content.startsWith(FRIENDLY_MODEL_ERROR)
    );
  });
  const firstUserIndex = clientMessages.findIndex((message) => message.role === "user");
  const messages = firstUserIndex >= 0 ? clientMessages.slice(firstUserIndex) : [];

  if (messages.length === 0) {
    return new Response("Please send a cricket question to CricBot AI.", { status: 400 });
  }

  const question = latestUserQuestion(messages);
  if (isRecentFormQuestion(question)) {
    return textResponse(await answerRecentFormQuestion(question));
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
          description:
            "Get recent/current matches for a cricket team and use them as a recent-form proxy when no dedicated form endpoint exists.",
          parameters: z.object({
            teamName: z.string().min(1)
          }),
          execute: async ({ teamName }) => {
            try {
              const matches = await getRecentTeamMatches(teamName);
              return {
                teamName,
                note: "No dedicated form endpoint is available, so these recent/current matches are used as a form proxy.",
                matches
              };
            } catch (error) {
              return { error: formatToolError(error) };
            }
          }
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
          description: "Search cricket teams using TheSportsDB for metadata, badge, country, league, stadium, and history.",
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
          description: "Get a cricket team profile/history using TheSportsDB.",
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
        try {
          for await (const textDelta of result.textStream) {
            controller.enqueue(encoder.encode(textDelta));
          }
        } catch (error) {
          controller.enqueue(encoder.encode(await localCricketFallback(messages, error)));
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
    return new Response(await localCricketFallback(messages, error), { status: 200 });
  }
}
