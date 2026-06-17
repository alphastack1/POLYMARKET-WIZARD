import { error, json } from "./_env";
import { findMarket, validateMarket } from "./_market";

export default async function handler(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body.marketId) return error("Missing marketId");

  const market = await findMarket(String(body.marketId));
  if (!market) return error("Market not found", 404);

  return json(validateMarket(market));
}
