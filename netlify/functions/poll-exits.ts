import { envCheck, json } from "./_env";
import { writeJournal } from "./_journal";

export default async function handler() {
  const env = envCheck();
  if (!env.ok) {
    return json({ ok: false, message: `Polling blocked: missing env vars: ${env.missing.join(", ")}`, sold: 0 });
  }

  await writeJournal({
    type: "poll",
    message: "Poll ran. No positions available to exit.",
  });

  return json({ ok: true, message: "Poll complete. No exits triggered.", sold: 0 });
}
