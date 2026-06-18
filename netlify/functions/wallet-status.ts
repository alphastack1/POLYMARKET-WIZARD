import { envCheck, error, json } from "./_env";
import { requireAuth } from "./_auth";
import { getWalletStatusDetails } from "./_polymarket";

export default async function handler(req: Request) {
  try {
    requireAuth(req);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err), 401);
  }

  const env = envCheck();
  if (!env.ok) {
    return json({
      ok: true,
      botAddress: env.botAddress || "unknown",
      depositWallet: null,
      depositWalletExists: false,
      polBalance: 0,
      polUsdcEstimate: 0,
      usdcBalance: 0,
      botPusdBalance: 0,
      pusdBalance: 0,
      exchangeAllowance: 0,
      negRiskExchangeAllowance: 0,
      negRiskAdapterAllowance: 0,
      ctfExchangeApproved: false,
      ctfNegRiskApproved: false,
      approvalsReady: false,
      readyToTrade: false,
      reason: `Missing env vars: ${env.missing.join(", ")}`,
    });
  }

  const details = await getWalletStatusDetails();

  return json({
    ok: true,
    ...details,
    reason: env.ok ? details.reason : `Missing env vars: ${env.missing.join(", ")}`,
  });
}
