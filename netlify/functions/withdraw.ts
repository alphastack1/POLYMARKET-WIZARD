import { json } from "./_env";
import { writeJournal } from "./_journal";

export default async function handler() {
  await writeJournal({
    type: "withdraw_blocked",
    message: "Withdrawal blocked until pUSD routing is connected.",
  });

  return json({
    ok: false,
    message: "Withdraw blocked: connect pUSD withdrawal routing before moving funds.",
  });
}
