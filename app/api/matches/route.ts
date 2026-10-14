import { getMatchWindow } from "@/lib/cricketData";
import { getFootballMatchesByDate } from "@/lib/theSportsDb";
import { cricketDate, cricketPhase, footballPhase, shiftDate, sportsDate } from "@/lib/matchStatus";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sport = new URL(request.url).searchParams.get("sport") ?? "cricket";
  if (sport !== "cricket" && sport !== "football") return Response.json({ error: "Unknown sport" }, { status: 400 });
  const today = sportsDate();
  try {
    let partial = false;
    let matches;
    if (sport === "cricket") {
      const result = await getMatchWindow();
      partial = result.partial;
      matches = result.matches.map((match) => ({
        id: match.id, name: match.name, date: cricketDate(match), phase: cricketPhase(match, today),
        status: match.status, venue: match.venue,
        score: match.score.map((score) => `${score.inning ?? "Innings"}: ${score.runs ?? "–"}/${score.wickets ?? "–"} (${score.overs ?? "–"} ov)`).join("; ")
      })).filter((match) => match.date && match.date >= shiftDate(today, -30));
    } else {
      // Include yesterday for matches that cross midnight and tomorrow's fixtures.
      const results = await Promise.allSettled([-1, 0, 1].map((days) => getFootballMatchesByDate(shiftDate(today, days))));
      if (results.every((result) => result.status === "rejected")) throw new Error("Unavailable");
      partial = results.some((result) => result.status === "rejected");
      matches = results.flatMap((result) => result.status === "fulfilled" ? result.value : []).map((event) => ({
        id: event.id, name: event.name, date: event.date, phase: footballPhase(event, today), status: event.status, venue: event.venue,
        score: event.homeScore !== undefined && event.awayScore !== undefined ? `${event.homeTeam} ${event.homeScore} – ${event.awayScore} ${event.awayTeam}` : ""
      }));
    }
    matches = matches.filter((match, index, all) => match.phase !== "unknown" && all.findIndex((other) => other.id === match.id) === index);
    return Response.json({ sport, today, checkedAt: new Date().toISOString(), partial, matches }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Match updates are unavailable right now. Please retry shortly." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
