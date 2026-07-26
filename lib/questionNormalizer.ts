const SHORTCUTS: Record<string, string> = {
  ind: "India",
  aus: "Australia",
  eng: "England",
  pak: "Pakistan",
  nz: "New Zealand",
  sa: "South Africa",
  sl: "Sri Lanka",
  ban: "Bangladesh",
  afg: "Afghanistan",
  arg: "Argentina",
  bra: "Brazil",
  fra: "France",
  ger: "Germany",
  ita: "Italy",
  esp: "Spain",
  uru: "Uruguay",
  por: "Portugal",
  csk: "Chennai Super Kings",
  rcb: "Royal Challengers Bengaluru",
  srh: "Sunrisers Hyderabad",
  mi: "Mumbai Indians",
  kkr: "Kolkata Knight Riders",
  dc: "Delhi Capitals",
  rr: "Rajasthan Royals",
  pbks: "Punjab Kings",
  gt: "Gujarat Titans",
  lsg: "Lucknow Super Giants",
  manu: "Manchester United",
  mufc: "Manchester United",
  mcfc: "Manchester City",
  barca: "Barcelona",
  rma: "Real Madrid",
  psg: "Paris Saint-Germain",
  ucl: "Champions League",
  epl: "Premier League",
  isl: "Indian Super League",
  wc: "World Cup",
  t20wc: "T20 World Cup",
  yday: "yesterday",
  yest: "yesterday",
  tdy: "today",
  tmrow: "tomorrow",
  nxt: "next",
  prev: "previous",
  res: "result",
  scr: "score",
  scorecard: "scorecard"
};

const COMMON_TYPOS: Record<string, string> = {
  criket: "cricket",
  crickit: "cricket",
  fotball: "football",
  futball: "football",
  footbal: "football",
  socer: "soccer",
  recnt: "recent",
  reccent: "recent",
  resent: "recent",
  frm: "form",
  scroe: "score",
  socre: "score",
  scor: "score",
  mtch: "match",
  mach: "match",
  mathc: "match",
  rslt: "result",
  reslt: "result",
  ysterday: "yesterday",
  yestarday: "yesterday",
  tommorow: "tomorrow",
  upcomming: "upcoming",
  fixtur: "fixture",
  plyr: "player",
  players: "players",
  palyer: "player",
  stat: "stats",
  histroy: "history",
  predction: "prediction",
  indiaa: "India",
  indai: "India",
  astralia: "Australia",
  austrailia: "Australia",
  pakstan: "Pakistan",
  englad: "England",
  arsnal: "Arsenal",
  liverpol: "Liverpool",
  barcalona: "Barcelona",
  madridrid: "Madrid"
};

const FUZZY_TERMS = [
  "cricket",
  "football",
  "soccer",
  "recent",
  "score",
  "match",
  "result",
  "yesterday",
  "tomorrow",
  "upcoming",
  "fixture",
  "player",
  "stats",
  "history",
  "prediction",
  "current",
  "India",
  "Australia",
  "Pakistan",
  "England",
  "Arsenal",
  "Chelsea",
  "Liverpool",
  "Barcelona",
  "Juventus"
];

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function fuzzyCorrection(word: string): string {
  if (word.length < 5 || /\d/.test(word)) {
    return word;
  }

  const lowerWord = word.toLowerCase();
  const candidate = FUZZY_TERMS.map((term) => ({
    term,
    distance: editDistance(lowerWord, term.toLowerCase())
  })).sort((left, right) => left.distance - right.distance)[0];
  const threshold = word.length >= 9 ? 2 : 1;

  return candidate && candidate.distance <= threshold ? candidate.term : word;
}

export function normalizeSportsQuestion(question: string): string {
  const normalizedSpacing = question
    .replace(/[🏏⚽]/gu, " ")
    .replace(/\bt\s*20\b/gi, "T20")
    .replace(/\bone[\s-]*day\b/gi, "ODI")
    .replace(/\bman\s+utd\b/gi, "Manchester United")
    .replace(/\bman\s+u\b/gi, "Manchester United")
    .replace(/\bman\s+city\b/gi, "Manchester City")
    .replace(/\breal\s+madrid\b/gi, "Real Madrid")
    .replace(/\bteam\s+india\b/gi, "India")
    .replace(/\bindian\s+team\b/gi, "India")
    .replace(/\bchampions\s+league\b/gi, "Champions League")
    .replace(/\s+/g, " ")
    .trim();

  return normalizedSpacing
    .split(/(\s+|[.,?!:;()[\]{}])/)
    .map((part) => {
      if (!/^[A-Za-z0-9]+$/.test(part)) {
        return part;
      }

      const lowerPart = part.toLowerCase();
      return SHORTCUTS[lowerPart] ?? COMMON_TYPOS[lowerPart] ?? fuzzyCorrection(part);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
