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
const ARTICLE_REQUEST_TIMEOUT_MS = 8_000;
const MAX_ARTICLE_CHARACTERS = 1_200_000;
const WEB_CACHE_TTL_MS = 45_000;
const webCache = new Map<string, { expiresAt: number; value: string | null }>();

export type SportsWebSearchOptions = {
  sport?: "cricket" | "football";
  intent?: string;
};

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
  publishedAt: string | undefined;
};

function keylessSearchSuffix(sport: string, intent?: string): string {
  switch (intent) {
    case "team-profile":
      return `${sport} national team history major achievements championships official`;
    case "player-profile":
      return `${sport} player profile position role career recent performance official`;
    case "historical-result":
      return `${sport} historical match tournament winner final result official`;
    case "recent-form":
      return `${sport} latest results recent form last matches`;
    case "fixtures":
      return `${sport} upcoming fixtures schedule official`;
    case "prediction":
      return `${sport} team form injuries head to head latest`;
    case "current-result":
      return `${sport} latest match result score official`;
    default:
      return `${sport} official team player competition information`;
  }
}

async function synthesizeKeylessEvidence(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  referenceDate: string,
  options: SportsWebSearchOptions,
  items: KeylessResult[],
  apiKey: string | undefined
): Promise<string | null> {
  if (!apiKey || !items.length) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const evidence = items
      .map(
        (item, index) =>
          `[${index + 1}] ${item.title}\n${item.description}\nSource URL: ${item.url}`
      )
      .join("\n\n");
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
                text: `You are SportBot AI's evidence-based answer agent. Answer only cricket and football questions from the supplied web evidence.

Current local date: ${referenceDate}
Research sport: ${options.sport ?? "cricket and football"}
Detected intent: ${options.intent ?? "general"}

Rules:
- Give the direct answer first.
- Use only claims supported by the supplied evidence. Do not guess.
- For team history, summarize origins and major verified achievements instead of listing unrelated head-to-head articles.
- For team-and-player questions, give a short overview and at most five relevant players.
- Prefix cricket player names with a cricket emoji and football player names with a football emoji.
- Include dates, competition, score, and winner when the evidence provides them.
- Never mention agents, scraping, APIs, databases, fallbacks, models, or implementation details.
- End with a Sources section containing only the supplied URLs that support the answer.
- If the evidence does not answer the question, output exactly: INSUFFICIENT_EVIDENCE`
              }
            ]
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Conversation:\n${formatConversation(messages)}\n\nWeb evidence:\n${evidence}`
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1000
          }
        })
      }
    );
    const body = (await response.json()) as GeminiGroundedResponse;
    if (!response.ok) {
      return null;
    }

    const answer = body.candidates?.[0]?.content?.parts
      ?.map((part) => part.text?.trim())
      .filter((text): text is string => Boolean(text))
      .join("\n\n");

    return answer && answer !== "INSUFFICIENT_EVIDENCE" ? answer : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseRssItems(xml: string): KeylessResult[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const title = xmlValue(match[1], "title");
      const description = xmlValue(match[1], "description");
      const url = safeWebUrl(xmlValue(match[1], "link"));
      return { title, description, url, publishedAt: xmlValue(match[1], "pubDate") || undefined };
    })
    .filter(
      (item): item is KeylessResult =>
        Boolean(item.title && item.description && item.url)
    );
}

function rankKeylessResults(
  items: KeylessResult[],
  question: string,
  intent?: string
): KeylessResult[] {
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
  const containsTerm = (text: string, term: string): boolean =>
    new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);

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
        namedTerms.length > 0 && !namedTerms.some((term) => containsTerm(searchable, term));
      const wrongGender =
        !/\b(women|women's|womens|female)\b/i.test(question) &&
        /\b(women|women's|womens|female)\b/i.test(searchable);
      const resultBonus = /\b(beat|defeat|defeated|draw|won|wins|result|score)\b/i.test(item.title) ? 2 : 0;
      const previewPenalty =
        /\b(predicted|prediction|preview|playing xi|live streaming|how to watch)\b/i.test(item.title) ? 3 : 0;
      const rejectsPreview =
        (intent === "current-result" || intent === "recent-form") &&
        /\b(predicted|prediction|preview|likely to win|playing xi|how to watch)\b/i.test(item.title);
      const performanceBonus =
        intent === "player-profile" || intent === "recent-form"
          ? /\b(\d+\s+runs?|\d+\s+goals?|average|strike rate|innings|form|statistics|stats)\b/i.test(
              searchable
            )
            ? 3
            : 0
          : 0;
      return {
        item,
        score:
          missesCricketContext ||
          isFootballCrossSportResult ||
          missesFootballContext ||
          missesNamedSubject ||
          wrongGender ||
          rejectsPreview
            ? -100
            : terms.filter((term) => searchable.includes(term)).length +
              resultBonus +
              performanceBonus -
              previewPenalty
      };
    })
    .filter(({ score }) => score >= Math.min(2, terms.length))
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => item)
    .slice(0, 3);
}

function htmlAttributeContent(html: string, attribute: string, value: string): string {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+${attribute}=["']${escapedValue}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${escapedValue}["'][^>]*>`,
      "i"
    )
  ];

  for (const pattern of patterns) {
    const content = html.match(pattern)?.[1];
    if (content) {
      return decodeXml(content);
    }
  }

  return "";
}

function articleTextFromHtml(html: string): string {
  const jsonLdBodies = [...html.matchAll(/"articleBody"\s*:\s*"((?:\\.|[^"\\])*)"/gi)]
    .map((match) => {
      try {
        return JSON.parse(`"${match[1]}"`) as string;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  const metaDescription =
    htmlAttributeContent(html, "property", "og:description") ||
    htmlAttributeContent(html, "name", "description");
  const articleSections = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(
    (match) => decodeXml(match[1])
  );

  return [...jsonLdBodies, metaDescription, ...articleSections]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPublicArticleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      host !== "localhost" &&
      host !== "0.0.0.0" &&
      host !== "::1" &&
      !host.endsWith(".local") &&
      !/^127\./.test(host) &&
      !/^10\./.test(host) &&
      !/^192\.168\./.test(host) &&
      !/^169\.254\./.test(host) &&
      !/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

async function readLimitedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARTICLE_CHARACTERS) {
    return "";
  }

  const text = await response.text();
  return text.length <= MAX_ARTICLE_CHARACTERS ? text : text.slice(0, MAX_ARTICLE_CHARACTERS);
}

async function fetchArticleEvidence(item: KeylessResult): Promise<string> {
  if (!isPublicArticleUrl(item.url)) {
    return "";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ARTICLE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(item.url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 SportBot/1.0"
      },
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/html")) {
      return "";
    }

    return articleTextFromHtml(await readLimitedText(response));
  } catch {
    return "";
  } finally {
    clearTimeout(timeoutId);
  }
}

function evidenceTerms(question: string): string[] {
  const ignored = new Set([
    "about",
    "cricket",
    "football",
    "form",
    "performance",
    "recent",
    "show",
    "team",
    "what",
    "when"
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

function bestEvidenceSentence(text: string, question: string): string {
  const terms = evidenceTerms(question);
  const noise =
    /\b(cookie|privacy policy|sign up|subscribe|advertisement|javascript|all rights reserved|comprehensive, up-to-date news coverage|aggregated from sources)\b/i;

  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 45 && sentence.length <= 420 && !noise.test(sentence))
    .map((sentence) => {
      const lowerSentence = sentence.toLowerCase();
      return {
        sentence,
        score:
          terms.filter((term) => lowerSentence.includes(term)).length * 3 +
          (/\b\d+(?:\.\d+)?\b/.test(sentence) ? 2 : 0) +
          (/\b(won|lost|scored|runs?|goals?|average|strike rate|wickets?|series|tournament)\b/i.test(
            sentence
          )
            ? 2
            : 0)
      };
    })
    .sort((left, right) => right.score - left.score)[0]?.sentence ?? "";
}

function answerHeading(question: string, sport?: "cricket" | "football"): string {
  const cleaned = question
    .replace(/\b(show|explain|tell me about|what is|who is)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\?+$/, "");
  const emoji = sport === "football" ? "\u26BD" : sport === "cricket" ? "\u{1F3CF}" : "\u{1F3C6}";
  return `## ${emoji} ${cleaned || "Sports update"}`;
}

async function composeKeylessAnswer(
  question: string,
  options: SportsWebSearchOptions,
  items: KeylessResult[]
): Promise<string> {
  const articleEvidence = await Promise.all(items.map(fetchArticleEvidence));
  const bullets = items
    .map((item, index) => {
      const evidence =
        bestEvidenceSentence(articleEvidence[index], question) ||
        bestEvidenceSentence(item.description, question) ||
        item.title;
      return evidence ? `- ${evidence}` : "";
    })
    .filter(Boolean);

  return [
    answerHeading(question, options.sport),
    "",
    ...bullets,
    "",
    "### Sources",
    ...items.map((item) => `- [${item.title}](${item.url})`)
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n")
    .trim();
}

async function searchKeylessWeb(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  referenceDate: string,
  options: SportsWebSearchOptions,
  apiKey?: string
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
  const sportSuffix =
    options.sport ??
    (/\bfootball\b/i.test(focusedQuestion)
      ? "football"
      : /\bcricket\b/i.test(focusedQuestion)
        ? "cricket"
        : "sports");
  const suffix = keylessSearchSuffix(sportSuffix, options.intent);
  const query = /\b(today|yesterday|tomorrow|latest|current|live|recent|next|upcoming|future|fixtures?|performance)\b/i.test(question)
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

      const items = rankKeylessResults(
        parseRssItems(await response.text()).filter((item) => {
          // Undated or old news cannot establish what is happening now.
          const timeSensitive = /\b(today|yesterday|tomorrow|latest|current|live|recent|next|upcoming|future|fixtures?|performance)\b/i.test(question);
          if (!timeSensitive || explicitDate) return true;
          const published = Date.parse(item.publishedAt ?? "");
          const reference = Date.parse(`${referenceDate}T23:59:59Z`);
          const days = /\b(today|live|current)\b/i.test(question) ? 2 : 30;
          return Number.isFinite(published) && published <= reference && published >= reference - days * 86_400_000;
        }),
        focusedQuestion,
        options.intent
      );

      if (!items.length) {
        continue;
      }

      const synthesized = await synthesizeKeylessEvidence(
        messages,
        referenceDate,
        options,
        items,
        apiKey
      );
      if (synthesized) {
        return synthesized;
      }

      // News snippets cannot verify live status, final results or future fixtures.
      if (/\b(today|yesterday|tomorrow|latest|current|live|recent|next|upcoming|future|fixtures?|performance)\b/i.test(question)) return null;
      return composeKeylessAnswer(question, options, items);
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
  referenceDate: string,
  options: SportsWebSearchOptions = {}
): Promise<string | null> {
  const cacheKey = `${referenceDate}:${options.sport ?? "sports"}:${options.intent ?? "general"}:${formatConversation(messages)}`;
  const cached = webCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const remember = (value: string | null): string | null => {
    webCache.set(cacheKey, {
      expiresAt: Date.now() + WEB_CACHE_TTL_MS,
      value
    });
    return value;
  };
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    return remember(await searchKeylessWeb(messages, referenceDate, options));
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
This research worker is focused on ${options.sport ?? "cricket and football"}.
The detected user intent is ${options.intent ?? "general sports information"}.

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
- For current, latest, or recent questions, verify information as of the current local date; do not pass off old articles as current. Upcoming fixtures must be in the future. Live scores require current match-status evidence, and completed results require a final status. Previous conversation answers are not evidence.
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
      return remember(await searchKeylessWeb(messages, referenceDate, options, apiKey));
    }

    return remember([
      answer,
      "",
      "### Sources",
      ...sources.map((source) => `- [${source.title}](${source.url})`)
    ].join("\n"));
  } catch (error) {
    console.error(
      "Grounded sports research failed:",
      error instanceof Error ? error.message : "Unknown search error"
    );
    return remember(await searchKeylessWeb(messages, referenceDate, options, apiKey));
  } finally {
    clearTimeout(timeoutId);
  }
}
