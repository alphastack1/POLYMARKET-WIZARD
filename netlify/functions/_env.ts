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
    maxTradeUsd: num("MAX_TRADE_USD", 2),
    maxOpenPositions: num("MAX_OPEN_POSITIONS", 3),
    maxDailyLossUsd: num("MAX_DAILY_LOSS_USD", 10),
    maxSpreadCents: num("MAX_SPREAD_CENTS", 5),
    minLiquidityUsd: num("MIN_LIQUIDITY_USD", 1000),
    minHoursToResolution: num("MIN_HOURS_TO_RESOLUTION", 2),
  };
}

function num(key: string, fallback: number) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeBotAddress() {
  try {
    return getBotAddress();
  } catch {
    return undefined;
  }
}
