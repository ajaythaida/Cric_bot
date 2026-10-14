import type { NormalizedMatch } from "@/types/cricket";
import type { SportsDbEvent } from "@/lib/theSportsDb";

export type MatchPhase = "live" | "upcoming" | "completed" | "unknown";
export const SPORTS_TIME_ZONE = "Asia/Kolkata";

export function sportsDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SPORTS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function cricketDate(match: NormalizedMatch): string | undefined {
  return match.dateTimeGMT?.slice(0, 10) || match.date?.slice(0, 10);
}

const COMPLETED = /\b(won(?!\s+(?:the\s+)?toss)|tied|drawn?|no result|abandoned|cancelled|canceled|completed|finished|match ended|full time|ft|aet|after penalties|match finished)\b/i;
const DELAYED = /\b(postponed|suspended|delayed)\b/i;

export function cricketPhase(match: NormalizedMatch, today = sportsDate()): MatchPhase {
  const date = cricketDate(match);
  if (!date) return "unknown";
  if (match.matchEnded || COMPLETED.test(match.status ?? "")) return date <= today ? "completed" : "unknown";
  if (DELAYED.test(match.status ?? "")) return "unknown";
  // Tests may run for five days. Never resurrect an old in-progress entry.
  const oldestLiveDate = shiftDate(today, /test|first.class/i.test(match.matchType ?? "") ? -5 : -1);
  if (match.matchStarted || /\b(live|in progress|innings|stumps|lunch|tea)\b/i.test(match.status ?? "")) {
    return date >= oldestLiveDate && date <= today ? "live" : "unknown";
  }
  if (date >= today) return "upcoming";
  return "unknown";
}

export function footballPhase(event: SportsDbEvent, today = sportsDate()): MatchPhase {
  const date = event.date?.slice(0, 10);
  if (!date) return "unknown";
  const status = event.status ?? "";
  if (COMPLETED.test(status) || /^(?:a\.e\.t\.|match finished)$/i.test(status)) return date <= today ? "completed" : "unknown";
  if (DELAYED.test(status)) return "unknown";
  // A score (including 0–0) is not evidence that a football match has finished.
  if (/\b(live|in play|in progress|1h|2h|ht|half time|first half|second half|extra time|penalties)\b/i.test(status) || /^\d+\s*'?\s*$/.test(status)) {
    return date >= shiftDate(today, -1) && date <= today ? "live" : "unknown";
  }
  if (date >= today && event.homeScore === undefined && event.awayScore === undefined) return "upcoming";
  return "unknown";
}

export function selectCricketMatches(matches: NormalizedMatch[], question: string, today = sportsDate()): NormalizedMatch[] {
  const explicitDate = question.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
  const requestedDate = explicitDate ?? (/\byesterday\b/i.test(question) ? shiftDate(today, -1) : /\btomorrow\b/i.test(question) ? shiftDate(today, 1) : /\btoday\b/i.test(question) ? today : undefined);
  const upcoming = /\b(next|upcoming|future|schedule|fixtures?|tomorrow)\b/i.test(question);
  const live = /\blive\b/i.test(question);
  const completed = /\b(past|previous|recent|form|last|results?|won|winner|completed|yesterday)\b/i.test(question);
  const oldestRecentDate = shiftDate(today, -30);
  return matches.filter((match, index, all) => all.findIndex((other) => other.id === match.id) === index)
    .filter((match) => {
      const date = cricketDate(match);
      const phase = cricketPhase(match, today);
      if (!date || (requestedDate && date !== requestedDate)) return false;
      if (upcoming) return phase === "upcoming";
      if (live) return phase === "live";
      if (completed) return phase === "completed" && (Boolean(requestedDate) || date >= oldestRecentDate);
      return phase === "live" || (date <= today && date >= (requestedDate ?? oldestRecentDate) && phase === "completed") || (date === today && phase === "upcoming");
    })
    .sort((a, b) => {
      if (!upcoming && !completed) {
        const priority = Number(cricketPhase(b, today) === "live") - Number(cricketPhase(a, today) === "live");
        if (priority) return priority;
      }
      return upcoming ? cricketDate(a)!.localeCompare(cricketDate(b)!) : cricketDate(b)!.localeCompare(cricketDate(a)!);
    });
}
