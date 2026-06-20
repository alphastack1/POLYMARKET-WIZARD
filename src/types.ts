export type Market = {
  id: string;
  question: string;
  slug?: string;
  image?: string;
  volume: number;
  liquidity: number;
  outcomes: string[];
  outcomePrices: string[];
  clobTokenIds: string[];
  active: boolean;
  closed: boolean;
  endDate?: string | null;
  conditionId?: string;
  negRisk?: boolean;
  acceptingOrders?: boolean;
  eventTitle?: string;
  disabledReason?: string;
};

export type EnvCheck = {
  ok: boolean;
  missing: string[];
  botAddress?: string;
  builderCode?: string;
  mode: string;
  rpcConfigured: boolean;
  fallbackCount: number;
  authSecretConfigured?: boolean;
  authRequired?: boolean;
  authenticated?: boolean;
  sessionAddress?: string;
  publicAppDisabled?: boolean;
  builderFee?: {
    makerBps: number;
    takerBps: number;
  };
  risk?: {
    maxTradeUsd: number;
    minTradeUsd: number;
    maxFundingUsd: number;
    maxOpenPositions: number;
    maxPortfolioLossUsd: number;
    maxSpreadCents: number;
    maxOrderSlippageCents: number;
    minLiquidityUsd: number;
    minHoursToResolution: number;
  };
};

export type WalletStatus = {
  ok: boolean;
  botAddress: string;
  depositWallet: string | null;
  depositWalletExists: boolean;
  polBalance?: number;
  polUsdcEstimate?: number;
  usdcBalance?: number;
  botPusdBalance?: number;
  pusdBalance: number;
  exchangeAllowance?: number;
  negRiskExchangeAllowance?: number;
  negRiskAdapterAllowance?: number;
  ctfExchangeApproved?: boolean;
  ctfNegRiskApproved?: boolean;
  approvalsReady: boolean;
  readyToTrade: boolean;
  reason?: string;
};

export type Position = {
  id: string;
  marketId: string;
  question: string;
  side: "YES" | "NO";
  tokenId: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  value: number;
  pnl: number;
  stopLossPercent: number;
  takeProfitPercent: number;
};

export type JournalEntry = {
  id: string;
  at: string;
  type: string;
  message: string;
  data?: unknown;
};
