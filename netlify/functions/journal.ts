import { json } from "./_env";
import { readJournal } from "./_journal";

export default async function handler() {
  const entries = await readJournal();
  return json({ ok: true, entries });
}
