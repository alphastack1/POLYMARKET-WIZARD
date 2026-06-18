import { error, json } from "./_env";
import { requireAuth } from "./_auth";
import { readJournal } from "./_journal";

export default async function handler(req: Request) {
  try {
    requireAuth(req);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err), 401);
  }

  const entries = await readJournal();
  return json({ ok: true, entries });
}
