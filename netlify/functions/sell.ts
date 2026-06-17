import { error, envCheck, json } from "./_env";
import { writeJournal } from "./_journal";

export default async function handler(req: Request) {
  const body = await req.json().catch(() => ({}));
  const env = envCheck();

  if (!env.ok) return error(`Missing env vars: ${env.missing.join(", ")}`);
  if (!body.positionId) return error("Missing positionId");
  if (!body.tokenId) return error("Missing tokenId");
  if (!Number.isFinite(Number(body.shares)) || Number(body.shares) <= 0) return error("Invalid shares");

  await writeJournal({
    type: "sell_blocked",
    message: "Sell passed basic checks but was blocked until live CLOB submit is connected.",
    data: body,
  });

  return json({
    ok: false,
    message: "Sell blocked: connect live CLOB order submit before trading.",
  });
}
