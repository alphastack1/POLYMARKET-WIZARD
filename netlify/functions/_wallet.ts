import { mnemonicToAccount } from "viem/accounts";

export function getBotAccount() {
  const mnemonic = process.env.BOT_MNEMONIC;
  if (!mnemonic) throw new Error("Missing BOT_MNEMONIC");

  return mnemonicToAccount(mnemonic, {
    accountIndex: Number(process.env.BOT_ACCOUNT_INDEX || 0),
  });
}

export function getBotAddress() {
  return getBotAccount().address;
}
