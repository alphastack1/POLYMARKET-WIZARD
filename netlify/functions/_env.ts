import { getBotAddress } from "./_wallet";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function error(message: string, status = 400, details?: unknown) {
  return json({ ok: false, error: message, details }, status);
}

export function envCheck() {
  const required = [
    "POLYGON_RPC_URL",
    "POLYMARKET_BUILDER_API_KEY",
    "POLYMARKET_BUILDER_SECRET",
    "POLYMARKET_BUILDER_PASSPHRASE",
    "POLYMARKET_BUILDER_CODE",
    "BOT_MNEMONIC",
  ];
  const missing = required.filter((key) => !process.env[key]);

  return {
    ok: missing.length === 0,
    missing,
    botAddress: safeBotAddress(),
    mode: process.env.VITE_APP_MODE || "hot-wallet",
    rpcConfigured: Boolean(process.env.POLYGON_RPC_URL),
    fallbackCount: (process.env.POLYGON_RPC_FALLBACKS || "").split(",").filter(Boolean).length,
  };
}

export function requireEnvReady() {
  const check = envCheck();
  if (!check.ok) {
    throw new Error(`Missing env vars: ${check.missing.join(", ")}`);
  }
  return check;
}

export function riskConfig() {
  return {
    maxTradeUsd: 2,
    maxOpenPositions: 3,
    maxDailyLossUsd: 10,
    maxSpreadCents: 5,
    minLiquidityUsd: 1000,
    minHoursToResolution: 2,
  };
}

function safeBotAddress() {
  try {
    return getBotAddress();
  } catch {
    return undefined;
  }
}
