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
  ];
  const missing = required.filter((key) => !process.env[key]);

  return {
    ok: missing.length === 0,
    missing,
    botAddress: undefined,
    builderCode: process.env.POLYMARKET_BUILDER_CODE || "",
    mode: process.env.PUBLIC_APP_MODE || "public-wallet",
    rpcConfigured: Boolean(process.env.POLYGON_RPC_URL),
    fallbackCount: (process.env.POLYGON_RPC_FALLBACKS || "").split(",").filter(Boolean).length,
    authSecretConfigured: Boolean(process.env.AUTH_SECRET),
    publicAppDisabled: process.env.PUBLIC_APP_DISABLED === "true",
    builderFee: {
      makerBps: numberEnv("PUBLIC_BUILDER_MAKER_FEE_BPS", 0),
      takerBps: numberEnv("PUBLIC_BUILDER_TAKER_FEE_BPS", 0),
    },
    risk: riskConfig(),
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
    maxTradeUsd: numberEnv("MAX_TRADE_USD", 100000),
    minTradeUsd: numberEnv("MIN_TRADE_USD", 1),
    maxFundingUsd: numberEnv("MAX_FUNDING_USD", 100000),
    maxOpenPositions: 3,
    maxPortfolioLossUsd: 10,
    maxSpreadCents: numberEnv("MAX_SPREAD_CENTS", 10),
    maxOrderSlippageCents: 2,
    minLiquidityUsd: numberEnv("MIN_LIQUIDITY_USD", 2000),
    minHoursToResolution: numberEnv("MIN_HOURS_TO_RESOLUTION", 0),
  };
}

function numberEnv(key: string, fallback: number) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}
