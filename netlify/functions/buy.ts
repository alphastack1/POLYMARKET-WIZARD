import { error, envCheck, json, riskConfig } from "./_env";
import { requireAuth } from "./_auth";
import { writeJournal } from "./_journal";
import { findMarket, validateMarket } from "./_market";
import { getWalletStatusDetails, placeOrder } from "./_polymarket";
import { getOpenPositions } from "./_positions";

export default async function handler(req: Request) {
  try {
    requireAuth(req);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err), 401);
  }

  const body = await req.json().catch(() => ({}));
  const env = envCheck();
  const risk = riskConfig();

  if (!env.ok) return error(`Missing env vars: ${env.missing.join(", ")}`);
  if (!body.marketId) return error("Missing marketId");
  if (!["YES", "NO"].includes(body.side)) return error("Side must be YES or NO");
  if (!Number.isFinite(Number(body.amountUsd)) || Number(body.amountUsd) <= 0) return error("Invalid amount");
  if (Number(body.amountUsd) < risk.minTradeUsd) return error(`Trade must be at least $${risk.minTradeUsd.toFixed(2)}`);
  if (Number(body.amountUsd) > risk.maxTradeUsd) return error(`Trade exceeds max size $${risk.maxTradeUsd}`);
  if (body.limitPrice !== undefined) {
    const limitPrice = Number(body.limitPrice);
    if (!Number.isFinite(limitPrice) || limitPrice < 0.01 || limitPrice > 0.99) return error("Invalid limit price");
  }

  const market = await findMarket(String(body.marketId));
  if (!market) return error("Market not found", 404);

  const check = validateMarket(market);
  if (!check.ok) return error(check.reason || "Market not tradeable");

  const portfolio = await getOpenPositions().catch(() => ({ positions: [] }));
  const openPnl = portfolio.positions.reduce((sum, position) => sum + position.pnl, 0);
  if (portfolio.positions.length >= risk.maxOpenPositions) {
    return error(`Open position limit reached: ${portfolio.positions.length}/${risk.maxOpenPositions}`);
  }
  if (openPnl <= -risk.maxPortfolioLossUsd) {
    return error(`Open portfolio loss exceeds $${risk.maxPortfolioLossUsd.toFixed(2)}`);
  }

  try {
    const order = await placeOrder({
      market,
      side: body.side === "NO" ? "NO" : "YES",
      action: "buy",
      amountUsd: Number(body.amountUsd),
      limitPrice: body.limitPrice ? Number(body.limitPrice) : undefined,
    });
    const status = await getWalletStatusDetails();

    await writeJournal({
      type: "buy_submitted",
      message: `${body.side} order submitted: $${Number(body.amountUsd).toFixed(2)}`,
      data: { orderId: order.orderId, status: order.status, marketId: market.id },
    });

    return json({
      ok: true,
      message: `${body.side} order submitted: ${order.orderId.slice(0, 12)}...`,
      orderId: order.orderId,
      orderStatus: order.status,
      status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeJournal({ type: "buy_failed", message, data: body });
    return error(message, 502);
  }
}
