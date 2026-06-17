import { envCheck, json } from "./_env";
import { getBotAddress } from "./_wallet";

export default async function handler() {
  const env = envCheck();
  const botAddress = getBotAddress();

  return json({
    ok: true,
    botAddress,
    depositWallet: null,
    depositWalletExists: false,
    pusdBalance: 0,
    approvalsReady: false,
    readyToTrade: false,
    reason: env.ok
      ? "Deposit wallet integration is pending. Connect the Polymarket relayer flow before funding."
      : `Missing env vars: ${env.missing.join(", ")}`,
  });
}
