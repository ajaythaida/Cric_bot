import type { PredictionInput, PredictionResult } from "@/types/cricket";

const DISCLAIMER =
  "This is a probability-based cricket estimate from limited available context, not a guaranteed result.";

function formScore(form?: string[]): number {
  if (!form?.length) {
    return 0.5;
  }

  const recent = form.slice(0, 5);
  const wins = recent.filter((item) => item.toLowerCase().startsWith("w")).length;
  return wins / recent.length;
}

function headToHeadScore(teamWins?: number, opponentWins?: number): number {
  const total = (teamWins ?? 0) + (opponentWins ?? 0);
  if (total === 0) {
    return 0.5;
  }

  return (teamWins ?? 0) / total;
}

function contextScore(team: string, notes?: string): number {
  if (!notes) {
    return 0.5;
  }

  const lowerNotes = notes.toLowerCase();
  const lowerTeam = team.toLowerCase();
  if (lowerNotes.includes(lowerTeam) && /(strong|fit|momentum|advantage|home|available)/i.test(notes)) {
    return 0.65;
  }

  if (lowerNotes.includes(lowerTeam) && /(injury|weak|unavailable|poor|concern)/i.test(notes)) {
    return 0.35;
  }

  return 0.5;
}

export function predictMatch(input: PredictionInput): PredictionResult {
  const formA = formScore(input.recentFormA);
  const formB = formScore(input.recentFormB);
  const h2hA = headToHeadScore(input.headToHead?.teamAWins, input.headToHead?.teamBWins);
  const h2hB = headToHeadScore(input.headToHead?.teamBWins, input.headToHead?.teamAWins);
  const venueA = input.venue?.toLowerCase().includes(input.teamA.toLowerCase()) ? 0.6 : 0.5;
  const venueB = input.venue?.toLowerCase().includes(input.teamB.toLowerCase()) ? 0.6 : 0.5;
  const squadA = contextScore(input.teamA, input.notes);
  const squadB = contextScore(input.teamB, input.notes);
  const momentumA = contextScore(input.teamA, input.notes);
  const momentumB = contextScore(input.teamB, input.notes);

  const scoreA = formA * 40 + h2hA * 20 + venueA * 15 + squadA * 15 + momentumA * 10;
  const scoreB = formB * 40 + h2hB * 20 + venueB * 15 + squadB * 15 + momentumB * 10;
  const total = scoreA + scoreB || 1;
  const favorite = scoreA >= scoreB ? input.teamA : input.teamB;
  const confidence = Math.round((Math.max(scoreA, scoreB) / total) * 100);

  const keyFactors = [
    `Recent form weight: ${Math.round((scoreA >= scoreB ? formA : formB) * 100)}% signal`,
    `Head-to-head weight: ${Math.round((scoreA >= scoreB ? h2hA : h2hB) * 100)}% signal`,
    input.venue ? `Venue/context considered: ${input.venue}` : "Venue data was not provided",
    input.notes ? `Context notes considered: ${input.notes}` : "No player availability or news context was provided"
  ];

  return {
    favorite,
    confidence,
    explanation: `${favorite} has the stronger weighted profile from the available form, head-to-head, venue, squad, and momentum inputs.`,
    keyFactors,
    risks: [
      "Cricket results can swing quickly because of toss, pitch, weather, and individual performances.",
      "The estimate is less reliable when recent form, squad, or venue data is incomplete."
    ],
    disclaimer: DISCLAIMER
  };
}
