import { envCheck, error, json } from "./_env";
import { writeJournal } from "./_journal";
import { approveDepositWalletForTrading, deployDepositWalletIfNeeded, getWalletStatusDetails, syncBalanceAllowance } from "./_polymarket";

export default async function handler() {
  const env = envCheck();
  if (!env.ok) {
    return error(`Blocked: missing env vars: ${env.missing.join(", ")}`);
  }

  try {
    const deployed = await deployDepositWalletIfNeeded();
    try {
      await approveDepositWalletForTrading();
    } catch (err) {
      if (!isRegistrySyncLag(err)) throw err;

      await sleep(5000);
      try {
        await approveDepositWalletForTrading();
      } catch (retryErr) {
        if (!isRegistrySyncLag(retryErr)) throw retryErr;

        const status = await getWalletStatusDetails();
        await writeJournal({
          type: "setup_pending",
          message: "Deposit wallet deployed; Polymarket registry is still syncing",
          data: { deployed: deployed.deployed, status },
        });

        return json({
          ok: true,
          message: "Deposit wallet deployed. Registry is syncing; click ARM again in a few seconds.",
          status,
        });
      }
    }
    await syncBalanceAllowance().catch(() => undefined);
    const status = await getWalletStatusDetails();

    await writeJournal({
      type: "setup_complete",
      message: `Wallet armed: ${deployed.depositWallet.slice(0, 8)}...${deployed.depositWallet.slice(-6)}`,
      data: { deployed: deployed.deployed, status },
    });

    return json({
      ok: true,
      message: status.readyToTrade
        ? "Wallet armed and funded."
        : status.reason || "Wallet armed. Fund it with pUSD to trade.",
      status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeJournal({ type: "setup_failed", message });
    return error(message, 500);
  }
}

function isRegistrySyncLag(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /wallet registry validation failed|not registered/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
