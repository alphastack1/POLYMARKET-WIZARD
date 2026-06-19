import { envCheck, error, json, riskConfig } from "./_env";
import { requireAuth } from "./_auth";
import { writeJournal } from "./_journal";
import { getWalletStatusDetails, wrapBotUsdcToDepositWallet } from "./_polymarket";

export default async function handler(req: Request) {
  try {
    requireAuth(req);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err), 401);
  }

  const body = await req.json().catch(() => ({}));
  const amountUsd = Number(body.amountUsd || body.amount || 1);
  const env = envCheck();
  const risk = riskConfig();

  if (!env.ok) return error(`Missing env vars: ${env.missing.join(", ")}`);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return error("Invalid amount");
  if (amountUsd > risk.maxFundingUsd) {
    return error(`Deposit exceeds max funding amount $${risk.maxFundingUsd.toFixed(2)}`);
  }

  try {
    const result = await wrapBotUsdcToDepositWallet(amountUsd);
    const status = await getWalletStatusDetails();
    await writeJournal({
      type: "deposit_complete",
      message: `$${amountUsd.toFixed(2)} deposited to Polymarket wallet`,
      data: result,
    });

    return json({
      ok: true,
      message: `$${amountUsd.toFixed(2)} deposited to Polymarket wallet.`,
      txHash: result.txHash,
      mode: result.mode,
      status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeJournal({ type: "deposit_failed", message, data: { amountUsd } });
    return error(message, 500);
  }
}
