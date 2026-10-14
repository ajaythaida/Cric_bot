import "server-only";

// Only immutable, explicitly dated history belongs here. Current answers must be fetched.
const INDIA_2011_WORLD_CUP_FINAL = `## 🏏 2011 Cricket World Cup final

**India won the 2011 ICC Cricket World Cup.**

India defeated Sri Lanka by **6 wickets** at Wankhede Stadium in Mumbai on **2 April 2011**. Sri Lanka scored 274/6, and India reached 277/4 in 48.2 overs. MS Dhoni finished unbeaten on 91 and was Player of the Match.

[Source](https://www.icc-cricket.com/tournaments/cricketworldcup/news/india-v-sri-lanka-2011-world-cup-final)`;

export function getVerifiedSportsSnapshot(question: string): string | null {
  return /\b2011\b/.test(question) && /\b(world cup|final)\b/i.test(question) && !/\b(football|soccer)\b/i.test(question)
    ? INDIA_2011_WORLD_CUP_FINAL
    : null;
}
