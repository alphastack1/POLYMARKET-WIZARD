import { error, json } from "./_env";
import { rateLimit } from "./_rate";

const DATA_API = "https://data-api.polymarket.com";

type NormalizedPosition = {
  id: string;
  marketId: string;
  question: string;
  side: "YES" | "NO";
  tokenId: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  value: number;
  pnl: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  slug?: string;
};

type PolyPosition = {
  asset?: string;
  conditionId?: string;
  size?: number;
  avgPrice?: number;
  initialValue?: number;
  currentValue?: number;
  cashPnl?: number;
  curPrice?: number;
  title?: string;
  slug?: string;
  outcome?: string;
};

export default async function handler(req: Request) {
  const limited = rateLimit(req, 120, 60_000);
  if (!limited.ok) return error("Too many requests", 429);

  const url = new URL(req.url);
  const wallet = String(url.searchParams.get("wallet") || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) return error("Missing deposit wallet");

  const params = new URLSearchParams({
    user: wallet.toLowerCase(),
    limit: "100",
    sizeThreshold: "0.01",
    sortBy: "CURRENT",
    sortDirection: "DESC",
  });

  const res = await fetch(`${DATA_API}/positions?${params}`);
  if (!res.ok) return error(`Data API error: ${res.status}`, 502);
  const raw = await res.json().catch(() => []);
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.value) ? raw.value : [];
  return json({ ok: true, positions: rows.map(normalizePosition), depositWallet: wallet });
}

function normalizePosition(position: PolyPosition): NormalizedPosition {
  const currentPrice = Number(position.curPrice || 0);
  const shares = Number(position.size || 0);
  const avgPrice = Number(position.avgPrice || (position.initialValue && shares ? position.initialValue / shares : 0) || currentPrice || 0);
  const value = Number(position.currentValue || currentPrice * shares || 0);
  const pnl = Number(position.cashPnl ?? (value - avgPrice * shares) ?? 0);
  const side = position.outcome?.toUpperCase() === "NO" ? "NO" : "YES";

  return {
    id: `${position.conditionId || position.asset}-${side}`,
    marketId: String(position.conditionId || ""),
    question: position.title || "Unknown market",
    side,
    tokenId: String(position.asset || ""),
    shares,
    avgPrice,
    currentPrice,
    value,
    pnl,
    stopLossPercent: 20,
    takeProfitPercent: 35,
    slug: position.slug,
  };
}
