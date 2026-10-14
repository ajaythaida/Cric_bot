"use client";

import { useEffect, useState } from "react";

type Match = { id: string; name: string; date?: string; phase: string; status?: string; score: string };
type Feed = { today: string; checkedAt: string; partial: boolean; matches: Match[] };

export function MatchUpdates() {
  const [sport, setSport] = useState("cricket");
  const [phase, setPhase] = useState("live");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    setFeed(null);
    setError("");
    async function update() {
      setLoading(true);
      try {
        const response = await fetch(`/api/matches?sport=${sport}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unavailable");
        const data = await response.json() as Feed;
        if (!disposed) { setFeed(data); setError(""); }
      } catch {
        if (!disposed) setError("Updates unavailable. Previously shown scores may be out of date.");
      } finally {
        if (!disposed) { setLoading(false); timer = setTimeout(update, 60_000); }
      }
    }
    void update();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [sport, refresh]);

  const matches = (feed?.matches ?? []).filter((match) => match.phase === phase).sort((a, b) => phase === "upcoming" ? (a.date ?? "").localeCompare(b.date ?? "") : (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 5);
  return (
    <details className="mb-5 rounded-2xl border border-pitch-100 bg-white p-4" open>
      <summary className="cursor-pointer font-semibold text-pitch-900">Match updates {feed ? `· ${feed.today}` : ""}</summary>
      <div className="my-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="match-sport">Sport</label>
        <select id="match-sport" value={sport} onChange={(event) => setSport(event.target.value)} className="rounded-lg border border-pitch-100 p-2 text-sm">
          <option value="cricket">Cricket</option><option value="football">Football</option>
        </select>
        {[["live", "Live"], ["upcoming", "Upcoming"], ["completed", "Results"]].map(([value, label]) => (
          <button key={value} type="button" aria-pressed={phase === value} onClick={() => setPhase(value)} className={`rounded-lg px-3 py-2 text-sm ${phase === value ? "bg-pitch-700 text-white" : "bg-pitch-50 text-pitch-900"}`}>{label}</button>
        ))}
        <button type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)} className="ml-auto text-sm text-pitch-700 disabled:opacity-50">{loading ? "Checking…" : "Refresh"}</button>
      </div>
      <div aria-live="polite" className="space-y-2 text-sm">
        {error && <p className="text-amber-800">{error}</p>}
        {!error && !loading && !matches.length && <p className="text-slate-600">No verified {phase === "completed" ? "results" : `${phase} matches`} available in this match window.</p>}
        {matches.map((match) => <article key={match.id} className="rounded-xl bg-pitch-50 p-3">
          <p className="font-semibold text-pitch-900">{match.name}</p>
          {match.score && <p>{match.score}</p>}
          <p className="text-slate-600">{match.status ?? phase} · {match.date}</p>
        </article>)}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Refreshes every minute while open. {feed && `Last checked ${new Date(feed.checkedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST. `}
        {sport === "football" ? "Window: yesterday through tomorrow (match dates as listed)." : "Window: available recent results and scheduled fixtures."}
        {feed?.partial && " Some match updates could not be loaded."}
      </p>
    </details>
  );
}
