import { error, envCheck, json } from "./_env";
import { requireAuth } from "./_auth";
import { writeJournal } from "./_journal";
import { getWalletStatusDetails, placeTokenOrder } from "./_polymarket";

export default async function handler(req: Request) {
  try {
    requireAuth(req);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err), 401);
  }

  const body = await req.json().catch(() => ({}));
  const env = envCheck();

  if (!env.ok) return error(`Missing env vars: ${env.missing.join(", ")}`);
  if (!body.positionId) return error("Missing positionId");
  if (!body.tokenId) return error("Missing tokenId");
  if (!Number.isFinite(Number(body.shares)) || Number(body.shares) <= 0) return error("Invalid shares");
  if (body.limitPrice !== undefined) {
    const limitPrice = Number(body.limitPrice);
    if (!Number.isFinite(limitPrice) || limitPrice < 0.01 || limitPrice > 0.99) return error("Invalid limit price");
  }

  try {
    const order = await placeTokenOrder({
      tokenId: String(body.tokenId),
      action: "sell",
      shares: Number(body.shares),
      limitPrice: body.limitPrice !== undefined ? Number(body.limitPrice) : undefined,
    });
    const status = await getWalletStatusDetails();

    await writeJournal({
      type: "sell_submitted",
      message: `${body.side || "YES"} sell submitted: ${Number(body.shares).toFixed(2)} shares`,
      data: { orderId: order.orderId, marketId: body.marketId, tokenId: body.tokenId },
    });

    return json({
      ok: true,
      message: `Sell submitted: ${order.orderId.slice(0, 12)}...`,
      orderId: order.orderId,
      orderStatus: order.status,
      status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeJournal({ type: "sell_failed", message, data: body });
    return error(message, 502);
  }
}
