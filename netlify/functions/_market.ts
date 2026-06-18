import { riskConfig } from "./_env";

const GAMMA = "https://gamma-api.polymarket.com";
const SEARCH_LIMIT = 20;

export type Market = {
  id: string;
  question: string;
  slug?: string;
  image?: string;
  volume: number;
  liquidity: number;
  outcomes: string[];
  outcomePrices: string[];
  clobTokenIds: string[];
  active: boolean;
  closed: boolean;
  endDate?: string | null;
  conditionId?: string;
  negRisk?: boolean;
  acceptingOrders?: boolean;
  eventTitle?: string;
  disabledReason?: string;
};

export async function fetchMarkets(q = "", limit = 100) {
  const keyword = q.trim();
  if (keyword) return searchMarkets(keyword, limit);

  return fetchMarketPage(limit);
}

export async function findMarket(marketId: string) {
  const direct = await fetchMarketById(marketId).catch(() => null);
  if (direct) return direct;

  const markets = await fetchMarketPage(100);
  return markets.find((market) => market.id === marketId);
}

async function fetchMarketPage(limit = 100, offset = 0) {
  const url = new URL(`${GAMMA}/markets`);
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("enableOrderBook", "true");
  url.searchParams.set("order", "volume24hr");
  url.searchParams.set("ascending", "false");
  url.searchParams.set("limit", String(Math.min(limit, 100)));
  url.searchParams.set("offset", String(offset));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gamma failed: ${res.status}`);

  const raw = (await res.json()) as unknown[];
  return raw.map(normalizeMarket);
}

async function fetchMarketById(marketId: string) {
  const res = await fetch(`${GAMMA}/markets/${encodeURIComponent(marketId)}`);
  if (!res.ok) return null;
  return normalizeMarket(await res.json());
}

async function searchMarkets(keyword: string, limit: number) {
  const [publicSearch, directSlug, broadPages] = await Promise.all([
    fetchPublicSearchMarkets(keyword).catch(() => []),
    fetchSlugMatches(keyword).catch(() => []),
    fetchBroadMatches(keyword).catch(() => []),
  ]);

  const ranked = rankMarkets(
    uniqueMarkets([...publicSearch, ...directSlug, ...broadPages]),
    keyword,
  );
  const open = ranked.filter((market) => market.active && !market.closed);
  return (open.length ? open : ranked).slice(0, limit);
}

async function fetchPublicSearchMarkets(keyword: string) {
  const url = new URL(`${GAMMA}/public-search`);
  url.searchParams.set("q", keyword);
  url.searchParams.set("limit", String(SEARCH_LIMIT));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gamma search failed: ${res.status}`);

  const data = await res.json() as { events?: unknown[]; markets?: unknown[] };
  const fromEvents = (data.events || []).flatMap((event: any) => {
    const markets = Array.isArray(event?.markets) ? event.markets : [];
    return markets.map((market: any) => normalizeMarket({ ...market, eventTitle: event?.title, events: [stripEvent(event)] }));
  });
  const fromMarkets = (data.markets || []).map(normalizeMarket);

  return [...fromEvents, ...fromMarkets];
}

async function fetchSlugMatches(keyword: string) {
  const slug = slugify(keyword);
  if (!slug) return [];

  const urls = [
    `${GAMMA}/markets?slug=${encodeURIComponent(slug)}`,
    `${GAMMA}/events?slug=${encodeURIComponent(slug)}`,
  ];
  const responses = await Promise.all(urls.map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [data];
    return rows.flatMap((row: any) => Array.isArray(row?.markets) ? row.markets : row);
  }));

  return responses.flat().map(normalizeMarket);
}

async function fetchBroadMatches(keyword: string) {
  const pages = await Promise.all([0, 100, 200].map((offset) => fetchMarketPage(100, offset).catch(() => [])));
  const terms = termsFor(keyword);
  return pages.flat().filter((market) => searchableText(market).includes(terms.join(" ")) || terms.every((term) => searchableText(market).includes(term)));
}

export function validateMarket(market: Market) {
  const risk = riskConfig();
  const yesIndex = findOutcome(market, "YES");
  const noIndex = findOutcome(market, "NO");
  const yesPrice = Number(market.outcomePrices[yesIndex]);
  const noPrice = Number(market.outcomePrices[noIndex]);
  const spreadCents = Math.abs(100 - Math.round((yesPrice + noPrice) * 100));

  if (!market.active) return fail("Market is inactive");
  if (market.closed) return fail("Market is closed");
  if (market.acceptingOrders === false) return fail("Market is not accepting orders");
  if (yesIndex < 0 || noIndex < 0) return fail("Missing YES/NO outcomes");
  if (!market.clobTokenIds[yesIndex]) return fail("Missing YES token ID");
  if (!market.clobTokenIds[noIndex]) return fail("Missing NO token ID");
  if (!isValidPrice(yesPrice) || !isValidPrice(noPrice)) return fail("Invalid YES/NO prices");
  if (spreadCents > risk.maxSpreadCents) return fail(`Spread too wide: ${spreadCents}c`);
  if (market.liquidity < risk.minLiquidityUsd) return fail(`Liquidity below $${risk.minLiquidityUsd}`);
  if (isTooCloseToResolution(market.endDate, risk.minHoursToResolution)) {
    return fail(`Market resolves within ${risk.minHoursToResolution} hours`);
  }

  return {
    ok: true,
    market,
    yesPrice,
    noPrice,
    yesTokenId: market.clobTokenIds[yesIndex],
    noTokenId: market.clobTokenIds[noIndex],
    spreadCents,
  };
}

function fail(reason: string) {
  return { ok: false, reason };
}

function normalizeMarket(item: any): Market {
  const market: Market = {
    id: String(item.id || ""),
    question: item.question || item.title || "Untitled market",
    slug: item.slug,
    image: item.image,
    volume: Number(item.volume || item.volumeNum || 0),
    liquidity: Number(item.liquidity || item.liquidityNum || 0),
    outcomes: parseArray(item.outcomes),
    outcomePrices: parseArray(item.outcomePrices),
    clobTokenIds: parseArray(item.clobTokenIds),
    active: item.active !== false,
    closed: item.closed === true,
    endDate: item.endDate || item.end_date || null,
    conditionId: item.conditionId || item.condition_id || item.conditionID,
    negRisk: item.negRisk === true || item.neg_risk === true,
    acceptingOrders: item.acceptingOrders,
    eventTitle: item.eventTitle || item.events?.[0]?.title,
  };
  const validation = validateMarketLight(market);
  return validation ? { ...market, disabledReason: validation } : market;
}

function stripEvent(event: any) {
  const { markets: _markets, ...rest } = event || {};
  return rest;
}

function uniqueMarkets(markets: Market[]) {
  const byId = new Map<string, Market>();
  for (const market of markets) {
    if (!market.id || byId.has(market.id)) continue;
    byId.set(market.id, market);
  }
  return [...byId.values()];
}

function rankMarkets(markets: Market[], keyword: string) {
  return markets
    .map((market) => ({ market, score: scoreMarket(market, keyword) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.market.volume - a.market.volume)
    .map(({ market }) => market);
}

function scoreMarket(market: Market, keyword: string) {
  const terms = termsFor(keyword);
  const question = normalizeText(market.question);
  const slug = normalizeText(market.slug || "");
  const eventText = normalizeText(market.eventTitle || "");
  const full = [question, slug, eventText].join(" ");

  let score = 0;
  if (question === normalizeText(keyword)) score += 1000;
  if (question.includes(normalizeText(keyword))) score += 450;
  if (slug.includes(slugify(keyword))) score += 220;
  if (terms.every((term) => full.includes(term))) score += 160;
  score += terms.filter((term) => full.includes(term)).length * 40;

  if (market.active && !market.closed) score += 100;
  if (market.acceptingOrders !== false) score += 30;
  if (market.liquidity >= 1000) score += 30;
  score += Math.min(120, Math.log10(Math.max(1, market.volume)) * 18);
  score += Math.min(80, Math.log10(Math.max(1, market.liquidity)) * 12);

  return score;
}

function searchableText(market: Market) {
  return normalizeText([market.question, market.slug].join(" "));
}

function termsFor(value: string) {
  return normalizeText(value).split(" ").filter((term) => term.length > 1);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function slugify(value: string) {
  return normalizeText(value).replace(/\s+/g, "-");
}

function validateMarketLight(market: Market) {
  const yesIndex = findOutcome(market, "YES");
  const noIndex = findOutcome(market, "NO");
  if (!market.active) return "inactive";
  if (market.closed) return "closed";
  if (market.acceptingOrders === false) return "not accepting orders";
  if (yesIndex < 0 || noIndex < 0) return "missing YES/NO";
  if (!market.clobTokenIds[yesIndex] || !market.clobTokenIds[noIndex]) return "missing token IDs";
  return undefined;
}

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function findOutcome(market: Market, side: "YES" | "NO") {
  return market.outcomes.findIndex((outcome) => outcome.toLowerCase() === side.toLowerCase());
}

function isValidPrice(value: number) {
  return Number.isFinite(value) && value >= 0.01 && value <= 0.99;
}

function isTooCloseToResolution(endDate: string | null | undefined, minHours: number) {
  if (!endDate) return false;
  const end = new Date(endDate).getTime();
  if (!Number.isFinite(end)) return false;
  return end - Date.now() < minHours * 60 * 60 * 1000;
}
