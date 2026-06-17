import { mnemonicToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http } from "viem";

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

export function polygonRpcUrl() {
  return process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
}

export const polygonWithRpc = {
  id: 137,
  name: "Polygon",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: {
    default: { http: [polygonRpcUrl()] },
    public: { http: [polygonRpcUrl()] },
  },
  blockExplorers: {
    default: { name: "Polygonscan", url: "https://polygonscan.com" },
  },
} as const;

export function getPublicClient() {
  return createPublicClient({
    chain: polygonWithRpc,
    transport: http(polygonRpcUrl()),
  });
}

export function getWalletClient() {
  return createWalletClient({
    account: getBotAccount(),
    chain: polygonWithRpc,
    transport: http(polygonRpcUrl()),
  });
}
