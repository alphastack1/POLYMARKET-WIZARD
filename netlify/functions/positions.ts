import { json } from "./_env";

export default async function handler() {
  return json({ ok: true, positions: [] });
}
