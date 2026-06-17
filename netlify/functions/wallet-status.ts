import { envCheck, json } from "./_env";
import { getWalletStatusDetails } from "./_polymarket";

export default async function handler() {
  const env = envCheck();
  const details = await getWalletStatusDetails();

  return json({
    ok: true,
    ...details,
    reason: env.ok ? details.reason : `Missing env vars: ${env.missing.join(", ")}`,
  });
}
