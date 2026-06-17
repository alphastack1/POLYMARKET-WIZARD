import { json } from "./_env";
import { writeJournal } from "./_journal";

export default async function handler() {
  await writeJournal({
    type: "deposit_blocked",
    message: "Deposit blocked until pUSD routing is connected.",
  });

  return json({
    ok: false,
    message: "Deposit blocked: connect pUSD routing before sending funds.",
  });
}
