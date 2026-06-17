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
  disabledReason?: string;
};

export type EnvCheck = {
  ok: boolean;
  missing: string[];
  botAddress?: string;
  mode: string;
  rpcConfigured: boolean;
  fallbackCount: number;
};

export type WalletStatus = {
  ok: boolean;
  botAddress: string;
  depositWallet: string | null;
  depositWalletExists: boolean;
  pusdBalance: number;
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
