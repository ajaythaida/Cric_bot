import "server-only";

type GeminiGroundingChunk = {
  web?: {
    uri?: string;
    title?: string;
  };
};

type GeminiPart = {
  text?: string;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiPart[];
  };
  groundingMetadata?: {
    groundingChunks?: GeminiGroundingChunk[];
  };
};

type GeminiGroundedResponse = {
  candidates?: GeminiCandidate[];
  error?: {
    message?: string;
  };
};

const REQUEST_TIMEOUT_MS = 30_000;
const KEYLESS_REQUEST_TIMEOUT_MS = 15_000;
const WEB_CACHE_TTL_MS = 10 * 60_000;
const webCache = new Map<string, { expiresAt: number; value: string }>();

function configuredModel(): string {
  const requested = process.env.GOOGLE_GENERATIVE_AI_MODEL?.trim();
  return requested || "gemini-2.5-flash";
}

function formatConversation(messages: Array<{ role: "user" | "assistant"; content: string }>): string {
  return messages
    .slice(-6)
    .map((message) => `${message.role === "user" ? "User" : "SportBot"}: ${message.content}`)
    .join("\n\n");
}

function uniqueSources(chunks: GeminiGroundingChunk[]): Array<{ title: string; url: string }> {
  const seen = new Set<string>();
  const sources: Array<{ title: string; url: string }> = [];

  for (const chunk of chunks) {
    const url = chunk.web?.uri?.trim();
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    sources.push({
      title: chunk.web?.title?.trim() || new URL(url).hostname,
      url
    });
  }

  return sources.slice(0, 5);
}

function decodeXml(value: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " "
  };

  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;nbsp;/g, " ")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (entity) => entities[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlValue(item: string, tag: string): string {
  return decodeXml(item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "");
}

function safeWebUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

type KeylessResult = {
  title: string;
  description: string;
  url: string;
};

function parseRssItems(xml: string): KeylessResult[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const title = xmlValue(match[1], "title");
      const description = xmlValue(match[1], "description");
      const url = safeWebUrl(xmlValue(match[1], "link"));
      return { title, description, url };
    })
    .filter(
      (item): item is KeylessResult =>
        Boolean(item.title && item.description && item.url)
    );
}

function rankKeylessResults(items: KeylessResult[], question: string): KeylessResult[] {
  const ignored = new Set([
    "about",
    "after",
    "before",
    "current",
    "latest",
    "match",
    "result",
    "score",
    "show",
    "sports",
    "today",
    "versus",
    "what",
    "when",
    "where",
    "which",
    "yesterday"
  ]);
  const terms = [...new Set(
    question
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((term) => term.length >= 4 && !ignored.has(term)) ?? []
  )];
  const genericSportsTerms = new Set([
    "cricket",
    "football",
    "official",
    "player",
    "players",
    "profile",
    "soccer",
    "statistics",
    "team"
  ]);
  const namedTerms = terms.filter((term) => !genericSportsTerms.has(term));

  return items
    .map((item) => {
      const searchable = `${item.title} ${item.description}`.toLowerCase();
      const wantsCricket = /\b(cricket|t20|odi|ipl|test match)\b/i.test(question);
      const wantsFootball = /\b(football|soccer)\b/i.test(question);
      const missesCricketContext =
        wantsCricket &&
        !/\b(cricket|cricketer|t20|odi|test|ipl|batter|bowler|wicket)\b/i.test(searchable);
      const isFootballCrossSportResult =
        wantsFootball &&
        /\b(cricket|cricketer|cricinfo|batter|bowler|wicket)\b/i.test(searchable) &&
        !/\b(football|soccer)\b/i.test(searchable);
      const missesFootballContext =
        wantsFootball &&
        !/\b(football|soccer|fc|club|squad|player|goal|match|league|fifa|uefa|afc)\b/i.test(
          searchable
        );
      const missesNamedSubject =
        namedTerms.length > 0 && !namedTerms.some((term) => searchable.includes(term));
      const resultBonus = /\b(beat|defeat|defeated|draw|won|wins|result|score)\b/i.test(item.title) ? 2 : 0;
      const previewPenalty =
        /\b(predicted|prediction|preview|playing xi|live streaming|how to watch)\b/i.test(item.title) ? 3 : 0;
      return {
        item,
        score:
          missesCricketContext ||
          isFootballCrossSportResult ||
          missesFootballContext ||
          missesNamedSubject
            ? -100
            : terms.filter((term) => searchable.includes(term)).length + resultBonus - previewPenalty
      };
    })
    .filter(({ score }) => score >= Math.min(2, terms.length))
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => item)
    .slice(0, 3);
}

async function searchKeylessWeb(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  referenceDate: string
): Promise<string | null> {
  const question = [...messages].reverse().find((message) => message.role === "user")?.content.trim();
  if (!question) {
    return null;
  }

  const explicitDate = question.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const readableDate = explicitDate
    ? new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC"
      }).format(
        new Date(
          Date.UTC(Number(explicitDate[1]), Number(explicitDate[2]) - 1, Number(explicitDate[3]))
        )
      )
    : "";
  const focusedQuestion = question
    .replace(/\bvs\b/gi, "versus")
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/, readableDate);
  const resultFocused = /(score|result|match|won|winner|recent|performance|today|yesterday|tomorrow|\b20\d{2}\b)/i.test(
    focusedQuestion
  );
  const sportSuffix = /\bfootball\b/i.test(focusedQuestion)
    ? "football"
    : /\bcricket\b/i.test(focusedQuestion)
      ? "cricket"
      : "sports";
  const suffix = resultFocused
    ? `${sportSuffix} match result score`
    : `${sportSuffix} official team player profile statistics`;
  const query = /\b(today|yesterday|tomorrow)\b/i.test(question)
    ? `${focusedQuestion} current date ${referenceDate} ${suffix}`
    : `${focusedQuestion} ${suffix}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), KEYLESS_REQUEST_TIMEOUT_MS);

  try {
    const googleNewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
    const urls = resultFocused ? [googleNewsUrl, bingUrl] : [bingUrl, googleNewsUrl];

    for (const url of urls) {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 SportBot/1.0"
        },
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) {
        continue;
      }

      const items = rankKeylessResults(parseRssItems(await response.text()), focusedQuestion);

      if (!items.length) {
        continue;
      }

      return [
        "## Relevant results",
        "",
        ...items.flatMap((item) => [
          `### ${item.title}`,
          item.description,
          `[Source](${item.url})`,
          ""
        ])
      ]
        .join("\n")
        .trim();
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function searchSportsWeb(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  referenceDate: string
): Promise<string | null> {
  const cacheKey = `${referenceDate}:${formatConversation(messages)}`;
  const cached = webCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const remember = (value: string | null): string | null => {
    if (value) {
      webCache.set(cacheKey, {
        expiresAt: Date.now() + WEB_CACHE_TTL_MS,
        value
      });
    }
    return value;
  };
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    return remember(await searchKeylessWeb(messages, referenceDate));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        configuredModel()
      )}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        cache: "no-store",
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: `You are SportBot AI's verified-search assistant. Use Google Search to answer football and cricket questions, including current fixtures, scores, recent form, players, teams, competitions, and historical matches.

The user's current local date is ${referenceDate}. Resolve words such as today, yesterday, and tomorrow from this date.

Rules:
- Read the conversation to identify the sport, competition, teams, player, match, and requested date.
- Understand common abbreviations and shortcuts such as IND, AUS, ENG, PAK, CSK, RCB, UCL, EPL, Man Utd, and Barca.
- The latest user question may contain corrected spelling. Answer its intended meaning naturally.
- Prefix cricket player names with 🏏 and football player names with ⚽.
- For team-and-player questions, give a short team overview and list at most five important or requested players with position/role and recent verified performance.
- For an individual player, include team/country, role or position, and a concise recent-performance summary with dates or competition context.
- If the question is ambiguous because many matches occurred, say so and list up to five prominent completed football or cricket matches from that date, then ask the user to name the team or tournament.
- State the two teams, winner or draw/no-result, score/result margin when verified, competition, and date.
- For historical questions, provide the exact requested result or fact and its date when verified.
- Do not guess. If reliable search results do not identify the answer, reply: "I could not find verified data for that question. Please add the sport, team, competition, and date."
- Keep the answer concise, use at most five matches or list items, and always finish the final sentence. Do not discuss the implementation or API failure.
- Include no separate sources section because SportBot will append the grounding sources.`
              }
            ]
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Conversation:\n\n${formatConversation(messages)}\n\nSearch the web and answer the latest user question.`
                }
              ]
            }
          ],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1200
          }
        })
      }
    );

    const body = (await response.json()) as GeminiGroundedResponse;
    if (!response.ok) {
      throw new Error(body.error?.message || `Google Search grounding returned HTTP ${response.status}.`);
    }

    const candidate = body.candidates?.[0];
    const answer = candidate?.content?.parts
      ?.map((part) => part.text?.trim())
      .filter((text): text is string => Boolean(text))
      .join("\n\n");

    if (!answer) {
      return null;
    }

    const sources = uniqueSources(candidate?.groundingMetadata?.groundingChunks ?? []);
    if (!sources.length) {
      return remember(answer);
    }

    return remember([
      answer,
      "",
      "### Sources",
      ...sources.map((source) => `- [${source.title}](${source.url})`)
    ].join("\n"));
  } catch {
    return remember(await searchKeylessWeb(messages, referenceDate));
  } finally {
    clearTimeout(timeoutId);
  }
}
