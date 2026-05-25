import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { CricketDataError, getCurrentMatches, getMatches, searchPlayers } from "@/lib/cricketData";
import { getTeamProfile } from "@/lib/theSportsDb";

export const runtime = "nodejs";

const GEMINI_MODEL = process.env.GOOGLE_GENERATIVE_AI_MODEL ?? "gemini-2.5-flash";
const CRICAPI_BASE_URL = "https://api.cricapi.com/v1";

type ApiCheck =
  | {
      ok: true;
      name: string;
      message: string;
      sample?: unknown;
    }
  | {
      ok: false;
      name: string;
      message: string;
    };

function formatError(error: unknown): string {
  if (error instanceof CricketDataError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Unknown API test error.";
}

function redactApiKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactApiKeys);
  }

  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      redacted[key] = key.toLowerCase().includes("apikey") ? "[redacted]" : redactApiKeys(nestedValue);
    }

    return redacted;
  }

  return value;
}

async function fetchRawCricApi(path: string, params: Record<string, string | number>): Promise<unknown> {
  if (!process.env.CRICKETDATA_API_KEY) {
    return {
      error: "CricketData API key is not configured. Add CRICKETDATA_API_KEY in .env.local."
    };
  }

  const query = new URLSearchParams({
    apikey: process.env.CRICKETDATA_API_KEY
  });
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value));
  }

  const response = await fetch(`${CRICAPI_BASE_URL}${path}?${query.toString()}`, {
    cache: "no-store"
  });
  const text = await response.text();

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    httpStatus: response.status,
    ok: response.ok,
    body: redactApiKeys(body)
  };
}

async function checkCricketApis(): Promise<ApiCheck[]> {
  const checks: ApiCheck[] = [];

  try {
    const matches = await getCurrentMatches(0);
    checks.push({
      ok: true,
      name: "CricketData currentMatches",
      message: `Fetched ${matches.length} current match item(s).`,
      sample: matches.slice(0, 2)
    });
  } catch (error) {
    checks.push({
      ok: false,
      name: "CricketData currentMatches",
      message: formatError(error)
    });
  }

  try {
    const matches = await getMatches(0);
    checks.push({
      ok: true,
      name: "CricketData matches",
      message: `Fetched ${matches.length} match item(s).`,
      sample: matches.slice(0, 2)
    });
  } catch (error) {
    checks.push({
      ok: false,
      name: "CricketData matches",
      message: formatError(error)
    });
  }

  try {
    const players = await searchPlayers("Virat Kohli", 0);
    checks.push({
      ok: true,
      name: "CricketData players search",
      message: `Fetched ${players.length} player item(s).`,
      sample: players.slice(0, 3)
    });
  } catch (error) {
    checks.push({
      ok: false,
      name: "CricketData players search",
      message: formatError(error)
    });
  }

  return checks;
}

async function checkGemini(): Promise<ApiCheck> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return {
      ok: false,
      name: "Google Gemini",
      message: "Gemini API key is not configured. Add GOOGLE_GENERATIVE_AI_API_KEY in .env.local."
    };
  }

  try {
    const result = await generateText({
      model: google(GEMINI_MODEL),
      prompt: "Reply with exactly: CricBot API test OK"
    });

    return {
      ok: true,
      name: "Google Gemini",
      message: `Gemini generated a test response with ${GEMINI_MODEL}.`,
      sample: result.text
    };
  } catch (error) {
    return {
      ok: false,
      name: "Google Gemini",
      message: formatError(error)
    };
  }
}

async function checkTheSportsDb(): Promise<ApiCheck> {
  try {
    const team = await getTeamProfile("Chennai Super Kings");
    if (!team) {
      return {
        ok: false,
        name: "TheSportsDB team profile",
        message: "No cricket team profile found for Chennai Super Kings."
      };
    }

    return {
      ok: true,
      name: "TheSportsDB team profile",
      message: "Fetched Chennai Super Kings team metadata.",
      sample: team
    };
  } catch (error) {
    return {
      ok: false,
      name: "TheSportsDB team profile",
      message: formatError(error)
    };
  }
}

export async function GET() {
  const cricketChecks = await checkCricketApis();
  const geminiCheck = await checkGemini();
  const sportsDbCheck = await checkTheSportsDb();
  const checks = [...cricketChecks, geminiCheck, sportsDbCheck];

  return Response.json({
    ok: checks.every((check) => check.ok),
    configured: {
      cricketDataApiKey: Boolean(process.env.CRICKETDATA_API_KEY),
      googleGenerativeAiApiKey: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
      googleGenerativeAiModel: GEMINI_MODEL,
      theSportsDbApiKey: process.env.THESPORTSDB_API_KEY || "123"
    },
    checks,
    rawCricketDataDebug: {
      currentMatches: await fetchRawCricApi("/currentMatches", { offset: 0 }),
      matches: await fetchRawCricApi("/matches", { offset: 0 }),
      playersViratKohli: await fetchRawCricApi("/players", { offset: 0, search: "Virat Kohli" })
    }
  });
}
