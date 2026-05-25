export interface CricketApiEnvelope<T> {
  apikey?: string;
  data?: T;
  status?: string;
  info?: {
    hitsToday?: number;
    hitsLimit?: number;
    credits?: number;
    server?: number;
    offsetRows?: number;
    totalRows?: number;
    queryTime?: number;
  };
  reason?: string;
}

export interface NormalizedMatch {
  id: string;
  name: string;
  matchType?: string;
  status?: string;
  venue?: string;
  date?: string;
  dateTimeGMT?: string;
  teams: string[];
  score: NormalizedScore[];
  matchStarted?: boolean;
  matchEnded?: boolean;
}

export interface NormalizedScore {
  inning?: string;
  runs?: number;
  wickets?: number;
  overs?: number;
}

export interface NormalizedPlayer {
  id: string;
  name: string;
  country?: string;
  role?: string;
}

export interface NormalizedScorecard {
  id: string;
  name: string;
  status?: string;
  venue?: string;
  score: NormalizedScore[];
  scorecard: unknown[];
}

export interface NormalizedSquad {
  matchId: string;
  teams: Array<{
    teamName: string;
    players: NormalizedPlayer[];
  }>;
}

export interface NormalizedSeriesInfo {
  id: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  matches?: NormalizedMatch[];
  raw?: unknown;
}

export interface PredictionInput {
  teamA: string;
  teamB: string;
  recentFormA?: string[];
  recentFormB?: string[];
  headToHead?: {
    teamAWins?: number;
    teamBWins?: number;
    noResult?: number;
  };
  venue?: string;
  notes?: string;
}

export interface PredictionResult {
  favorite: string;
  confidence: number;
  explanation: string;
  keyFactors: string[];
  risks: string[];
  disclaimer: string;
}
