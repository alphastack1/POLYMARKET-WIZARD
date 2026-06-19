import { error, json } from "./_env";
import { requireAuth } from "./_auth";
import { getOpenPositions } from "./_positions";

export default async function handler(req: Request) {
  try {
    requireAuth(req);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err), 401);
  }

  try {
    const { positions, depositWallet } = await getOpenPositions();
    return json({ ok: true, positions, depositWallet });
  } catch (err) {
    return json({ ok: false, positions: [], message: err instanceof Error ? err.message : String(err) }, 502);
  }
}
