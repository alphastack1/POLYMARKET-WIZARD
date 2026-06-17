import { error, json } from "./_env";
import { writeJournal } from "./_journal";
import { getWalletStatusDetails, withdrawPusdFromDepositWallet } from "./_polymarket";

export default async function handler(req: Request) {
  const body = await req.json().catch(() => ({}));
  const amountUsd = Number(body.amountUsd || body.amount || 1);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return error("Invalid amount");

  try {
    const result = await withdrawPusdFromDepositWallet(amountUsd);
    const status = await getWalletStatusDetails();
    await writeJournal({
      type: "withdraw_complete",
      message: `$${amountUsd.toFixed(2)} withdrawn to bot wallet`,
      data: { depositWallet: result.depositWallet },
    });

    return json({
      ok: true,
      message: `$${amountUsd.toFixed(2)} withdrawn to bot wallet.`,
      status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeJournal({ type: "withdraw_failed", message, data: { amountUsd } });
    return error(message, 500);
  }
}
