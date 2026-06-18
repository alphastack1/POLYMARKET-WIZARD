import { error, json } from "./_env";
import { verifyAuthChallenge } from "./_auth";

export default async function handler(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body.address || !body.nonce || !body.signature) {
    return error("Missing address, nonce, or signature");
  }

  try {
    return json({ ok: true, ...(await verifyAuthChallenge({
      address: String(body.address),
      nonce: String(body.nonce),
      signature: String(body.signature),
    })) });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err), 401);
  }
}
