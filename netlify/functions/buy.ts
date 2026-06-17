import { error, envCheck, json, riskConfig } from "./_env";
import { writeJournal } from "./_journal";
import { findMarket, validateMarket } from "./_market";

export default async function handler(req: Request) {
  const body = await req.json().catch(() => ({}));
  const env = envCheck();
  const risk = riskConfig();

  if (!env.ok) return error(`Missing env vars: ${env.missing.join(", ")}`);
  if (!body.marketId) return error("Missing marketId");
  if (!["YES", "NO"].includes(body.side)) return error("Side must be YES or NO");
  if (!Number.isFinite(Number(body.amountUsd)) || Number(body.amountUsd) <= 0) return error("Invalid amount");
  if (Number(body.amountUsd) > risk.maxTradeUsd) return error(`Trade exceeds max size $${risk.maxTradeUsd}`);

  const market = await findMarket(String(body.marketId));
  if (!market) return error("Market not found", 404);

  const check = validateMarket(market);
  if (!check.ok) return error(check.reason || "Market not tradeable");

  await writeJournal({
    type: "buy_blocked",
    message: "Buy passed guardrails but was blocked until live CLOB submit is connected.",
    data: body,
  });

  return json({
    ok: false,
    message: "Buy blocked: connect live CLOB order submit before trading.",
  });
}
