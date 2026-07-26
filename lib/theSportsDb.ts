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

export interface SportsDbEvent {
  id: string;
  name: string;
  sport?: string;
  league?: string;
  season?: string;
  date?: string;
  time?: string;
  status?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: string;
  awayScore?: string;
  venue?: string;
  country?: string;
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
  },
  {
    id: "builtin-india-football",
    name: "India",
    shortName: "IND",
    alternateNames: "India national football team, Blue Tigers",
    sport: "Soccer",
    league: "International Football",
    country: "India",
    stadium: "Various home venues",
    description:
      "The India national football team, known as the Blue Tigers, represents India in men's international football. The team competes in FIFA, AFC, SAFF, and other international competitions."
  }
];

type SportsDbEnvelope<T> = {
  teams?: T[];
  player?: unknown[];
  events?: T[];
  event?: T[];
  results?: T[];
};

function apiKey(): string {
  return process.env.THESPORTSDB_API_KEY || "123";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
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

function normalizeEvent(event: unknown): SportsDbEvent {
  const item = asRecord(event);
  return {
    id: asString(item.idEvent) ?? "unknown-event",
    name: asString(item.strEvent) ?? "Unknown match",
    sport: asString(item.strSport),
    league: asString(item.strLeague),
    season: asString(item.strSeason),
    date: asString(item.dateEvent),
    time: asString(item.strTime),
    status: asString(item.strStatus),
    homeTeam: asString(item.strHomeTeam),
    awayTeam: asString(item.strAwayTeam),
    homeScore: asString(item.intHomeScore),
    awayScore: asString(item.intAwayScore),
    venue: asString(item.strVenue),
    country: asString(item.strCountry)
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

export async function searchTeamsBySport(teamName: string, sport: string): Promise<SportsDbTeam[]> {
  const lowerSport = sport.toLowerCase();
  const lowerName = teamName.toLowerCase();
  const builtIns = BUILT_IN_TEAM_PROFILES.filter((team) => {
    return (
      team.sport?.toLowerCase() === lowerSport &&
      [team.name, team.shortName, team.alternateNames]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(lowerName) || lowerName.includes(value?.toLowerCase() ?? ""))
    );
  });
  let apiTeams: SportsDbTeam[] = [];

  try {
    const body = await fetchSportsDb<SportsDbEnvelope<unknown>>("searchteams.php", { t: teamName });
    apiTeams = (body.teams ?? [])
      .map(normalizeTeam)
      .filter((team) => team.sport?.toLowerCase() === lowerSport);
  } catch {
    return builtIns;
  }

  return [...apiTeams, ...builtIns];
}

export async function searchTeams(teamName: string): Promise<SportsDbTeam[]> {
  return searchTeamsBySport(teamName, "Cricket");
}

export async function getTeamProfile(teamName: string): Promise<SportsDbTeam | null> {
  const teams = await searchTeams(teamName);
  return teams[0] ?? null;
}

export async function searchFootballTeams(teamName: string): Promise<SportsDbTeam[]> {
  return searchTeamsBySport(teamName, "Soccer");
}

export async function getFootballTeamProfile(teamName: string): Promise<SportsDbTeam | null> {
  const teams = await searchFootballTeams(teamName);
  return teams[0] ?? null;
}

export async function getFootballMatchesByDate(date: string): Promise<SportsDbEvent[]> {
  const body = await fetchSportsDb<SportsDbEnvelope<unknown>>("eventsday.php", { d: date, s: "Soccer" });
  return (body.events ?? []).map(normalizeEvent);
}

export async function getFootballTeamPastMatches(teamName: string): Promise<SportsDbEvent[]> {
  const team = await getFootballTeamProfile(teamName);
  if (!team) {
    return [];
  }

  const body = await fetchSportsDb<SportsDbEnvelope<unknown>>("eventslast.php", { id: team.id });
  return (body.results ?? body.event ?? body.events ?? []).map(normalizeEvent);
}

export async function getFootballTeamNextMatches(teamName: string): Promise<SportsDbEvent[]> {
  const team = await getFootballTeamProfile(teamName);
  if (!team) {
    return [];
  }

  const body = await fetchSportsDb<SportsDbEnvelope<unknown>>("eventsnext.php", { id: team.id });
  return (body.events ?? body.event ?? []).map(normalizeEvent);
}
