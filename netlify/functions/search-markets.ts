import { json } from "./_env";
import { fetchMarkets, validateMarket } from "./_market";

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const markets = await fetchMarkets(q, 100);
  const tradeable = markets
    .map((market) => {
      const check = validateMarket(market);
      return {
        market: check.ok ? market : { ...market, disabledReason: check.reason },
        ok: check.ok,
      };
    })
    .sort((a, b) => Number(b.ok) - Number(a.ok) || b.market.volume - a.market.volume)
    .map(({ market }) => market)
    .slice(0, 30);

  return json({ ok: true, markets: tradeable });
}
