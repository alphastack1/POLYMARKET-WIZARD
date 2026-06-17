import { riskConfig } from "./_env";

const GAMMA = "https://gamma-api.polymarket.com";

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
  disabledReason?: string;
};

export async function fetchMarkets(q = "", limit = 100) {
  const url = new URL(`${GAMMA}/markets`);
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gamma failed: ${res.status}`);

  const raw = (await res.json()) as unknown[];
  const keyword = q.trim().toLowerCase();

  return raw
    .map(normalizeMarket)
    .filter((market) => {
      if (!keyword) return true;
      return [market.question, market.slug].join(" ").toLowerCase().includes(keyword);
    });
}

export async function findMarket(marketId: string) {
  const markets = await fetchMarkets("", 500);
  return markets.find((market) => market.id === marketId);
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
  };
  const validation = validateMarketLight(market);
  return validation ? { ...market, disabledReason: validation } : market;
}

function validateMarketLight(market: Market) {
  const yesIndex = findOutcome(market, "YES");
  const noIndex = findOutcome(market, "NO");
  if (!market.active) return "inactive";
  if (market.closed) return "closed";
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
