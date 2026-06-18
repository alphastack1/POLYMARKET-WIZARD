import { error, json } from "./_env";
import { createAuthChallenge } from "./_auth";

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const address = String(body.address || url.searchParams.get("address") || "");
  if (!address) return error("Missing wallet address");

  try {
    return json({ ok: true, ...(await createAuthChallenge(address)) });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err), 401);
  }
}
