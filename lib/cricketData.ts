import "server-only";
import type {
  CricketApiEnvelope,
  NormalizedMatch,
  NormalizedPlayer,
  NormalizedScore,
  NormalizedScorecard,
  NormalizedSeriesInfo,
  NormalizedSquad
} from "@/types/cricket";

const BASE_URL = "https://api.cricapi.com/v1";
const CACHE_TTL_MS = 45_000;
const REQUEST_TIMEOUT_MS = 30_000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const cache = new Map<string, CacheEntry<unknown>>();

export class CricketDataError extends Error {
  constructor(
    message: string,
    public readonly code: "MISSING_KEY" | "API_ERROR" | "TIMEOUT"
  ) {
    super(message);
    this.name = "CricketDataError";
  }
}

function getApiKey(): string {
  const apiKey = process.env.CRICKETDATA_API_KEY;
  if (!apiKey) {
    throw new CricketDataError(
      "CricketData API key is not configured. Add CRICKETDATA_API_KEY in .env.local.",
      "MISSING_KEY"
    );
  }

  return apiKey;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeScore(score: unknown): NormalizedScore {
  const item = asRecord(score);
  return {
    inning: asString(item.inning),
    runs: asNumber(item.r),
    wickets: asNumber(item.w),
    overs: asNumber(item.o)
  };
}

function normalizeMatch(match: unknown): NormalizedMatch {
  const item = asRecord(match);
  return {
    id: asString(item.id) ?? asString(item.unique_id) ?? "unknown-match",
    name: asString(item.name) ?? "Unnamed match",
    matchType: asString(item.matchType),
    status: asString(item.status),
    venue: asString(item.venue),
    date: asString(item.date),
    dateTimeGMT: asString(item.dateTimeGMT),
    teams: asArray(item.teams).map((team) => String(team)),
    score: asArray(item.score).map(normalizeScore),
    matchStarted: asBoolean(item.matchStarted),
    matchEnded: asBoolean(item.matchEnded)
  };
}

function normalizePlayer(player: unknown): NormalizedPlayer {
  const item = asRecord(player);
  return {
    id: asString(item.id) ?? "unknown-player",
    name: asString(item.name) ?? "Unknown player",
    country: asString(item.country),
    role: asString(item.role)
  };
}

async function fetchCricketData<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const apiKey = getApiKey();
  const query = new URLSearchParams({ apikey: apiKey });
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value));
  }

  const url = `${BASE_URL}${path}?${query.toString()}`;
  const cacheKey = `${path}?${new URLSearchParams(params as Record<string, string>).toString()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 0 }
    });

    if (!response.ok) {
      throw new CricketDataError(
        `I could not fetch live cricket data right now. CricAPI returned HTTP ${response.status}.`,
        "API_ERROR"
      );
    }

    const body = (await response.json()) as CricketApiEnvelope<unknown>;
    if (body.status === "failure" || body.reason) {
      throw new CricketDataError(
        body.reason ?? "I could not fetch live cricket data right now. CricAPI returned a failure response.",
        "API_ERROR"
      );
    }

    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: body.data as T
    });

    return body.data as T;
  } catch (error) {
    if (error instanceof CricketDataError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new CricketDataError("I could not fetch live cricket data right now. Please try again later.", "TIMEOUT");
    }

    throw new CricketDataError("I could not fetch live cricket data right now. Please try again later.", "API_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getCurrentMatches(offset = 0): Promise<NormalizedMatch[]> {
  const data = await fetchCricketData<unknown[]>("/currentMatches", { offset });
  return asArray(data).map(normalizeMatch);
}

export async function getMatches(offset = 0): Promise<NormalizedMatch[]> {
  try {
    const data = await fetchCricketData<unknown[]>("/matches", { offset });
    return asArray(data).map(normalizeMatch);
  } catch (error) {
    if (error instanceof CricketDataError && error.code === "MISSING_KEY") {
      throw error;
    }

    return getCurrentMatches(offset);
  }
}

export async function getMatchWindow(): Promise<{ matches: NormalizedMatch[]; partial: boolean }> {
  const results = await Promise.allSettled([
    ...[0, 25, 50].map((offset) => getCurrentMatches(offset)),
    ...[0, 25, 50].map((offset) => getMatches(offset))
  ]);
  if (results.every((result) => result.status === "rejected")) {
    throw new CricketDataError("Match updates are temporarily unavailable.", "API_ERROR");
  }
  const matches = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  return {
    matches: matches.filter((match, index) => matches.findIndex((other) => other.id === match.id) === index),
    partial: results.some((result) => result.status === "rejected")
  };
}

export async function getSeriesInfo(seriesId: string): Promise<NormalizedSeriesInfo> {
  const data = await fetchCricketData<unknown>("/series_info", { offset: 0, id: seriesId });
  const item = asRecord(data);
  const matchSource = item.matchList ?? item.matches;
  return {
    id: seriesId,
    name: asString(item.name),
    startDate: asString(item.startDate),
    endDate: asString(item.endDate),
    matches: asArray(matchSource).map(normalizeMatch),
    raw: data
  };
}

export async function searchPlayers(playerName: string, offset = 0): Promise<NormalizedPlayer[]> {
  const data = await fetchCricketData<unknown[]>("/players", { offset, search: playerName });
  return asArray(data).map(normalizePlayer);
}

export async function getMatchScorecard(matchId: string): Promise<NormalizedScorecard> {
  const data = await fetchCricketData<unknown>("/match_scorecard", { id: matchId });
  const item = asRecord(data);
  return {
    id: asString(item.id) ?? matchId,
    name: asString(item.name) ?? "Match scorecard",
    status: asString(item.status),
    venue: asString(item.venue),
    score: asArray(item.score).map(normalizeScore),
    scorecard: asArray(item.scorecard)
  };
}

export async function getMatchSquad(matchId: string): Promise<NormalizedSquad> {
  const data = await fetchCricketData<unknown>("/match_squad", { id: matchId });
  const item = asRecord(data);
  const squadSource = Array.isArray(data) ? data : item.squad;
  const squads = asArray(squadSource).map((team) => {
    const teamRecord = asRecord(team);
    return {
      teamName: asString(teamRecord.teamName) ?? asString(teamRecord.name) ?? "Team",
      players: asArray(teamRecord.players).map(normalizePlayer)
    };
  });

  return {
    matchId,
    teams: squads
  };
}

export async function getMatchPoints(matchId: string): Promise<unknown> {
  return fetchCricketData<unknown>("/match_points", { id: matchId });
}
