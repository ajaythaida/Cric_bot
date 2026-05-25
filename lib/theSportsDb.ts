import "server-only";

const BASE_URL = "https://www.thesportsdb.com/api/v1/json";
const CACHE_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const cache = new Map<string, CacheEntry<unknown>>();

export interface SportsDbTeam {
  id: string;
  name: string;
  shortName?: string;
  alternateNames?: string;
  formedYear?: string;
  sport?: string;
  league?: string;
  country?: string;
  stadium?: string;
  stadiumLocation?: string;
  description?: string;
  badge?: string;
  website?: string;
}

const BUILT_IN_TEAM_PROFILES: SportsDbTeam[] = [
  {
    id: "builtin-csk",
    name: "Chennai Super Kings",
    shortName: "CSK",
    alternateNames: "CSK",
    formedYear: "2008",
    sport: "Cricket",
    league: "Indian Premier League",
    country: "India",
    stadium: "M. A. Chidambaram Stadium",
    stadiumLocation: "Chennai, India",
    description:
      "Chennai Super Kings are one of the most successful Indian Premier League franchises. Founded in 2008, CSK are known for consistency, a strong core, experienced leadership, and a large fan base. The team has been closely associated with MS Dhoni and has won multiple IPL titles while regularly reaching playoff stages.",
    website: "chennaisuperkings.com"
  },
  {
    id: "builtin-india",
    name: "India",
    shortName: "IND",
    alternateNames: "Indian cricket team, Team India",
    sport: "Cricket",
    league: "International Cricket",
    country: "India",
    stadium: "Various home venues",
    description:
      "India are one of world cricket's strongest and most followed teams. They have won major ICC tournaments across formats and are known for deep batting talent, high-quality spin bowling, fast-bowling depth, and a very competitive domestic structure."
  },
  {
    id: "builtin-australia",
    name: "Australia",
    shortName: "AUS",
    alternateNames: "Australian cricket team",
    sport: "Cricket",
    league: "International Cricket",
    country: "Australia",
    stadium: "Various home venues",
    description:
      "Australia are historically one of cricket's most successful international teams. They are known for aggressive cricket, pace bowling depth, strong fielding standards, and a long record of success in Tests, ODIs, and ICC tournaments."
  }
];

type SportsDbEnvelope<T> = {
  teams?: T[];
  player?: unknown[];
  event?: unknown[];
};

function apiKey(): string {
  return process.env.THESPORTSDB_API_KEY || "123";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeTeam(team: unknown): SportsDbTeam {
  const item = asRecord(team);
  return {
    id: asString(item.idTeam) ?? "unknown-team",
    name: asString(item.strTeam) ?? "Unknown team",
    shortName: asString(item.strTeamShort),
    alternateNames: asString(item.strAlternate),
    formedYear: asString(item.intFormedYear),
    sport: asString(item.strSport),
    league: asString(item.strLeague),
    country: asString(item.strCountry),
    stadium: asString(item.strStadium),
    stadiumLocation: asString(item.strStadiumLocation),
    description: asString(item.strDescriptionEN),
    badge: asString(item.strBadge),
    website: asString(item.strWebsite)
  };
}

async function fetchSportsDb<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params);
  const cacheKey = `${endpoint}?${query.toString()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}/${apiKey()}/${endpoint}?${query.toString()}`, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`TheSportsDB returned HTTP ${response.status}.`);
    }

    const body = (await response.json()) as T;
    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: body
    });

    return body;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function searchTeams(teamName: string): Promise<SportsDbTeam[]> {
  const body = await fetchSportsDb<SportsDbEnvelope<unknown>>("searchteams.php", { t: teamName });
  const apiTeams = (body.teams ?? []).map(normalizeTeam).filter((team) => team.sport?.toLowerCase() === "cricket");
  const lowerName = teamName.toLowerCase();
  const builtIns = BUILT_IN_TEAM_PROFILES.filter((team) => {
    return [team.name, team.shortName, team.alternateNames]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(lowerName) || lowerName.includes(value?.toLowerCase() ?? ""));
  });

  return [...apiTeams, ...builtIns];
}

export async function getTeamProfile(teamName: string): Promise<SportsDbTeam | null> {
  const teams = await searchTeams(teamName);
  return teams[0] ?? null;
}
