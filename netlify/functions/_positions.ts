import { getDepositWallet } from "./_polymarket";

const DATA_API = "https://data-api.polymarket.com";

export type NormalizedPosition = {
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

export async function getOpenPositions() {
  const { address: depositWallet, exists } = await getDepositWallet();
  if (!exists) return { positions: [] as NormalizedPosition[], depositWallet };

  const params = new URLSearchParams({
    user: depositWallet.toLowerCase(),
    limit: "100",
    sizeThreshold: "0.01",
    sortBy: "CURRENT",
    sortDirection: "DESC",
  });

  const res = await fetch(`${DATA_API}/positions?${params}`);
  if (!res.ok) throw new Error(`Data API error: ${res.status}`);

  const raw = await res.json().catch(() => []);
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.value) ? raw.value : [];
  const positions = rows.map(normalizePosition);

  return { positions, depositWallet };
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
