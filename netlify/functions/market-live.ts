import { Chain, ClobClient, PriceHistoryInterval } from "@polymarket/clob-client-v2";
import { error, json } from "./_env";
import { findMarket, validateMarket } from "./_market";

const CLOB_HOST = "https://clob.polymarket.com";

type BookLevel = {
  price: number;
  size: number;
  total: number;
};

export default async function handler(req: Request) {
  try {
    return await loadMarket(req);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err), 500);
  }
}

async function loadMarket(req: Request) {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const url = new URL(req.url);
  const marketId = String(body.marketId || url.searchParams.get("marketId") || "");
  const side = String(body.side || url.searchParams.get("side") || "YES").toUpperCase() === "NO" ? "NO" : "YES";
  if (!marketId) return error("Missing marketId");

  const market = await findMarket(marketId);
  if (!market) return error("Market not found", 404);

  const check = validateMarket(market);
  if (!check.ok) return json({ ok: false, reason: check.reason, market });

  const tokenId = side === "YES" ? check.yesTokenId : check.noTokenId;
  const oppositeTokenId = side === "YES" ? check.noTokenId : check.yesTokenId;
  const client = new ClobClient({ host: CLOB_HOST, chain: Chain.POLYGON, throwOnError: true });

  const [historyResult, bookResult, yesBookResult, noBookResult, tradesResult] = await Promise.allSettled([
    client.getPricesHistory({ market: tokenId, interval: PriceHistoryInterval.ONE_DAY, fidelity: 10 }),
    client.getOrderBook(tokenId),
    client.getOrderBook(check.yesTokenId),
    client.getOrderBook(check.noTokenId),
    market.conditionId ? client.getMarketTradesEvents(market.conditionId) : Promise.resolve([]),
  ]);

  const book = bookResult.status === "fulfilled" ? bookResult.value : null;
  const yesBook = yesBookResult.status === "fulfilled" ? yesBookResult.value : null;
  const noBook = noBookResult.status === "fulfilled" ? noBookResult.value : null;
  const history = historyResult.status === "fulfilled"
    ? normalizeHistory(historyResult.value)
    : [];
  const trades = tradesResult.status === "fulfilled"
    ? normalizeTrades(tradesResult.value)
    : [];

  return json({
    ok: true,
    market,
    side,
    tokenId,
    oppositeTokenId,
    yesPrice: bestAsk(yesBook) ?? check.yesPrice,
    noPrice: bestAsk(noBook) ?? check.noPrice,
    spreadCents: spreadCents(yesBook, noBook) ?? check.spreadCents,
    history,
    orderBook: normalizeBook(book),
    trades,
    liveErrors: [
      historyResult.status === "rejected" ? "price history unavailable" : null,
      bookResult.status === "rejected" ? "order book unavailable" : null,
      tradesResult.status === "rejected" ? "trade tape unavailable" : null,
    ].filter(Boolean),
  });
}

function normalizeBook(book: Awaited<ReturnType<ClobClient["getOrderBook"]>> | null) {
  if (!book) return { bids: [], asks: [], lastTradePrice: null, tickSize: null, minOrderSize: null };
  return {
    bids: topLevels(book.bids, "desc"),
    asks: topLevels(book.asks, "asc"),
    lastTradePrice: Number(book.last_trade_price || 0) || null,
    tickSize: book.tick_size,
    minOrderSize: book.min_order_size,
  };
}

function normalizeHistory(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray((value as { history?: unknown[] })?.history)
      ? (value as { history: unknown[] }).history
      : Array.isArray((value as { data?: unknown[] })?.data)
        ? (value as { data: unknown[] }).data
        : [];

  return source
    .map((point) => {
      const row = point as { t?: number | string; p?: number | string; timestamp?: number | string; price?: number | string };
      return {
        t: Number(row.t ?? row.timestamp),
        p: Number(row.p ?? row.price),
      };
    })
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p));
}

function normalizeTrades(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray((value as { trades?: unknown[] })?.trades)
      ? (value as { trades: unknown[] }).trades
      : Array.isArray((value as { data?: unknown[] })?.data)
        ? (value as { data: unknown[] }).data
        : [];

  return source.slice(0, 20).map((item) => {
    const trade = item as {
      side?: string;
      outcome?: string;
      price?: number | string;
      size?: number | string;
      timestamp?: string;
      match_time?: string;
      user?: { username?: string; pseudonym?: string; address?: string };
    };
    return {
      side: trade.side || "",
      outcome: trade.outcome || "",
      price: Number(trade.price),
      size: Number(trade.size),
      time: trade.timestamp || trade.match_time || "",
      user: trade.user?.username || trade.user?.pseudonym || short(trade.user?.address || ""),
    };
  }).filter((trade) => Number.isFinite(trade.price) && Number.isFinite(trade.size));
}

function topLevels(levels: { price: string; size: string }[], direction: "asc" | "desc"): BookLevel[] {
  let running = 0;
  return [...levels]
    .map((level) => ({ price: Number(level.price), size: Number(level.size) }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size))
    .sort((a, b) => direction === "asc" ? a.price - b.price : b.price - a.price)
    .slice(0, 10)
    .map((level) => {
      running += level.price * level.size;
      return { ...level, total: running };
    });
}

function bestAsk(book: Awaited<ReturnType<ClobClient["getOrderBook"]>> | null) {
  const asks = topLevels(book?.asks || [], "asc");
  return asks[0]?.price;
}

function bestBid(book: Awaited<ReturnType<ClobClient["getOrderBook"]>> | null) {
  const bids = topLevels(book?.bids || [], "desc");
  return bids[0]?.price;
}

function spreadCents(yesBook: Awaited<ReturnType<ClobClient["getOrderBook"]>> | null, noBook: Awaited<ReturnType<ClobClient["getOrderBook"]>> | null) {
  const yesAsk = bestAsk(yesBook);
  const yesBid = bestBid(yesBook);
  const noAsk = bestAsk(noBook);
  const noBid = bestBid(noBook);
  if (!yesAsk || !yesBid || !noAsk || !noBid) return null;
  return Math.round(Math.max(yesAsk - yesBid, noAsk - noBid) * 100);
}

function short(value: string) {
  return value.length > 10 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}
