import { envCheck, error, json } from "./_env";
import { requireAuth } from "./_auth";
import { writeJournal } from "./_journal";

export default async function handler(req: Request) {
  try {
    requireAuth(req);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err), 401);
  }

  const env = envCheck();
  if (!env.ok) {
    return json({ ok: false, message: `Polling blocked: missing env vars: ${env.missing.join(", ")}`, sold: 0 });
  }

  await writeJournal({
    type: "poll_skipped",
    message: "Auto-exit polling is not enabled in this build; no orders were submitted.",
  });

  return json({
    ok: true,
    enabled: false,
    message: "Auto-exit polling is not enabled in this build; no orders were submitted.",
    sold: 0,
  });
}
