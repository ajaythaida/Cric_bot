import "server-only";

import { searchSportsWeb } from "@/lib/webSportsSearch";

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

type ResearchSport = "cricket" | "football";
type ResearchIntent =
  | "current-result"
  | "historical-result"
  | "team-profile"
  | "player-profile"
  | "recent-form"
  | "fixtures"
  | "prediction"
  | "general";

export type SportsResearchPlan = {
  sports: ResearchSport[];
  intent: ResearchIntent;
};

type WorkerResult = {
  sport: ResearchSport;
  answer: string | null;
  score: number;
};

const RESEARCH_CACHE_TTL_MS = 45_000;
const researchCache = new Map<string, { expiresAt: number; value: string | null }>();

const CRICKET_TERMS =
  /\b(cricket|cricketer|ipl|bcci|icc|t20|odi|test match|wicket|runs?|innings|csk|rcb|srh|kkr|pbks|mumbai indians|chennai super kings|virat|kohli|rohit|dhoni)\b/i;
const FOOTBALL_TERMS =
  /\b(football|soccer|fifa|uefa|afc|goal|premier league|champions league|la liga|serie a|bundesliga|isl|indian super league|arsenal|chelsea|liverpool|manchester|barcelona|real madrid|psg|messi|ronaldo|mbappe|chhetri|haaland)\b/i;

function latestUserQuestion(messages: ClientMessage[]): string {
  return [...messages].reverse().find((message) => message.role === "user")?.content.trim() ?? "";
}

function detectIntent(question: string): ResearchIntent {
  if (/\b(predict|prediction|likely|favorite|will win|can win|chances)\b/i.test(question)) {
    return "prediction";
  }
  if (/\b(yesterday|today|live|current|who won|winner|score|result)\b/i.test(question)) {
    return "current-result";
  }
  if (
    /\b(team history|history of|team profile|about the team)\b/i.test(question) ||
    /\bexplain\b.*\bhistory\b/i.test(question)
  ) {
    return "team-profile";
  }
  if (/\b(old|historical|history|which year|when did|world cup final|19\d{2}|20[0-1]\d)\b/i.test(question)) {
    return "historical-result";
  }
  if (/\b(recent form|recent matches|last matches|recent results|performance)\b/i.test(question)) {
    return "recent-form";
  }
  if (/\b(next|upcoming|future|tomorrow|schedule|fixtures?)\b/i.test(question)) {
    return "fixtures";
  }
  if (/\b(player|players|squad|roster|career|stats|statistics|records)\b/i.test(question)) {
    return "player-profile";
  }
  if (/\b(team|profile|about|history)\b/i.test(question)) {
    return "team-profile";
  }
  return "general";
}

export function coordinateSportsResearch(question: string): SportsResearchPlan {
  const cricket = CRICKET_TERMS.test(question);
  const football = FOOTBALL_TERMS.test(question);
  let sports: ResearchSport[];

  if (cricket && !football) {
    sports = ["cricket"];
  } else if (football && !cricket) {
    sports = ["football"];
  } else if (cricket && football) {
    sports = ["cricket", "football"];
  } else if (/\b(india|australia|england|pakistan|new zealand|south africa|sri lanka)\b/i.test(question)) {
    sports = ["cricket"];
  } else {
    sports = ["cricket", "football"];
  }

  return {
    sports,
    intent: detectIntent(question)
  };
}

function importantTerms(question: string): string[] {
  const ignored = new Set([
    "about",
    "current",
    "explain",
    "football",
    "cricket",
    "history",
    "match",
    "players",
    "recent",
    "show",
    "team",
    "what",
    "when",
    "which",
    "winner"
  ]);

  return [
    ...new Set(
      question
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter((term) => term.length >= 4 && !ignored.has(term)) ?? []
    )
  ];
}

function verifyWorkerAnswer(
  sport: ResearchSport,
  intent: ResearchIntent,
  question: string,
  answer: string | null
): WorkerResult {
  if (
    !answer ||
    answer.length < 60 ||
    /could not find verified data|could not generate|failed to fetch/i.test(answer)
  ) {
    return { sport, answer: null, score: 0 };
  }

  const lowerAnswer = answer.toLowerCase();
  const terms = importantTerms(question);
  const matchingTerms = terms.filter((term) => lowerAnswer.includes(term)).length;
  const sourceLinks = (answer.match(/\[[^\]]+\]\(https?:\/\//g) ?? []).length;
  const hasDateOrYear = /\b(?:19|20)\d{2}\b/.test(answer);
  const hasResultEvidence =
    !/\b(won|winner|score|result)\b/i.test(question) ||
    /\b(won|winner|score|result|defeated|draw)\b/i.test(answer);
  const wrongSport =
    sport === "cricket"
      ? /\b(football|soccer)\b/i.test(answer) && !CRICKET_TERMS.test(answer)
      : /\b(cricket|wicket|innings)\b/i.test(answer) && !FOOTBALL_TERMS.test(answer);
  const isUnhelpfulTeamHistory =
    intent === "team-profile" &&
    /\b(head.to.head|\bvs\b|prediction|preview)\b/i.test(answer) &&
    !/\b(formed|founded|established|major achievements?|titles?|champions?|national team)\b/i.test(
      answer
    );
  const isGenericSearchPage =
    /\bcomprehensive, up-to-date news coverage, aggregated from sources\b/i.test(answer);
  const hasWrongGender =
    !/\b(women|women's|womens|female)\b/i.test(question) &&
    /\b(women|women's|womens|female)\b/i.test(answer);

  if (
    wrongSport ||
    !hasResultEvidence ||
    isUnhelpfulTeamHistory ||
    isGenericSearchPage ||
    hasWrongGender
  ) {
    return { sport, answer: null, score: 0 };
  }

  return {
    sport,
    answer,
    score: matchingTerms * 2 + Math.min(sourceLinks, 3) * 3 + (hasDateOrYear ? 2 : 0) + 1
  };
}

async function runResearchWorker(
  sport: ResearchSport,
  intent: ResearchIntent,
  messages: ClientMessage[],
  referenceDate: string
): Promise<WorkerResult> {
  try {
    const answer = await searchSportsWeb(messages, referenceDate, { sport, intent });
    return verifyWorkerAnswer(sport, intent, latestUserQuestion(messages), answer);
  } catch {
    return { sport, answer: null, score: 0 };
  }
}

function composeResearchAnswer(plan: SportsResearchPlan, results: WorkerResult[]): string | null {
  const verified = results
    .filter((result): result is WorkerResult & { answer: string } => Boolean(result.answer))
    .sort((left, right) => right.score - left.score);

  if (!verified.length) {
    return null;
  }

  if (plan.sports.length === 1 || verified.length === 1) {
    return verified[0].answer;
  }

  return verified
    .map(
      (result) =>
        `## ${result.sport === "cricket" ? "\u{1F3CF} Cricket" : "\u26BD Football"}\n\n${result.answer}`
    )
    .join("\n\n");
}

export async function runSportsResearchAgent(
  messages: ClientMessage[],
  referenceDate: string
): Promise<string | null> {
  const question = latestUserQuestion(messages);
  if (!question) {
    return null;
  }

  const cacheKey = `${referenceDate}:${messages
    .slice(-6)
    .map((message) => `${message.role}:${message.content}`)
    .join("|")}`;
  const cached = researchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const plan = coordinateSportsResearch(question);
  const results = await Promise.all(
    plan.sports.map((sport) => runResearchWorker(sport, plan.intent, messages, referenceDate))
  );
  const answer = composeResearchAnswer(plan, results);

  researchCache.set(cacheKey, {
    expiresAt: Date.now() + RESEARCH_CACHE_TTL_MS,
    value: answer
  });

  return answer;
}
