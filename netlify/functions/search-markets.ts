import { json } from "./_env";
import { fetchMarkets, validateMarket } from "./_market";

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const markets = await fetchMarkets(q, 100);
  const tradeable = markets
    .map((market) => {
      const check = validateMarket(market);
      return check.ok ? market : { ...market, disabledReason: check.reason };
    })
    .slice(0, 30);

  return json({ ok: true, markets: tradeable });
}
