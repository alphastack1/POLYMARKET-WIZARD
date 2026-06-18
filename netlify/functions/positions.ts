import { error, json } from "./_env";
import { requireAuth } from "./_auth";
import { getDepositWallet } from "./_polymarket";

const DATA_API = "https://data-api.polymarket.com";

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
  try {
    requireAuth(req);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err), 401);
  }

  const { address: depositWallet, exists } = await getDepositWallet();
  if (!exists) return json({ ok: true, positions: [] });

  const params = new URLSearchParams({
    user: depositWallet.toLowerCase(),
    limit: "100",
    sizeThreshold: "0.01",
    sortBy: "CURRENT",
    sortDirection: "DESC",
  });

  const res = await fetch(`${DATA_API}/positions?${params}`);
  if (!res.ok) {
    return json({ ok: false, positions: [], message: `Data API error: ${res.status}` }, 502);
  }

  const raw = await res.json().catch(() => []);
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.value) ? raw.value : [];
  const positions = rows.map((position: PolyPosition) => {
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
  });

  return json({ ok: true, positions, depositWallet });
}
