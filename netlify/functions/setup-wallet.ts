import { envCheck, json } from "./_env";
import { writeJournal } from "./_journal";

export default async function handler() {
  const env = envCheck();
  if (!env.ok) {
    return json({ ok: false, message: `Blocked: missing env vars: ${env.missing.join(", ")}` });
  }

  await writeJournal({
    type: "setup_blocked",
    message: "Setup blocked until the Polymarket relayer flow is connected.",
  });

  return json({
    ok: false,
    message: "Setup blocked: connect the Polymarket relayer flow before creating the deposit wallet.",
  });
}
