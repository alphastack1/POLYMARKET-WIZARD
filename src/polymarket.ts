import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatEther,
  formatUnits,
  maxUint256,
  parseEther,
  parseUnits,
  type WalletClient,
} from "viem";
import type { Market, Position, WalletStatus } from "./types";
import {
  CHAIN_ID,
  CLOB_HOST,
  COLLATERAL_ONRAMP,
  CTF,
  CTF_ABI,
  ERC20_ABI,
  EXCHANGE,
  NEG_RISK_ADAPTER,
  NEG_RISK_EXCHANGE,
  ONRAMP_ABI,
  POLYGON_RPC_URL,
  PUSD,
  RELAYER_URL,
  UNISWAP_QUOTER,
  UNISWAP_QUOTER_ABI,
  UNISWAP_ROUTER,
  UNISWAP_ROUTER_ABI,
  USDC_E,
  WPOL,
  polygonWithRpc,
} from "./contracts";

type HexAddress = `0x${string}`;
type ClobCreds = { key: string; secret: string; passphrase: string };
type BrowserEthereum = {
  request: <T = unknown>(args: { method: string; params?: unknown[] }) => Promise<T>;
};

type SignedOrderResponse = {
  ok: boolean;
  orderId: string;
  status: string;
  txHashes?: string[];
  clob?: unknown;
};

const POL_SWAP_FEES = [100, 500, 3000, 10000] as const;
const POL_GAS_RESERVE = parseEther("0.08");
const CLOB_AUTH_DOMAIN = {
  name: "ClobAuthDomain",
  version: "1",
  chainId: CHAIN_ID,
} as const;
const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "message", type: "string" },
  ],
} as const;

export const publicClient = createPublicClient({
  chain: polygonWithRpc,
  transport: custom({
    async request({ method, params }) {
      const res = await fetch(POLYGON_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "Polygon RPC error");
      return data.result;
    },
  }),
});

export function getEthereum(): BrowserEthereum {
  const ethereum = (window as typeof window & { ethereum?: BrowserEthereum }).ethereum;
  if (!ethereum) throw new Error("Open this app in a browser with MetaMask, Rabby, or Coinbase Wallet.");
  return ethereum;
}

export async function connectBrowserWallet() {
  const ethereum = getEthereum();
  const accounts = await ethereum.request<string[]>({ method: "eth_requestAccounts" });
  const address = accounts[0] as HexAddress | undefined;
  if (!address) throw new Error("No wallet account returned.");
  await ensurePolygonNetwork(ethereum);
  return {
    address,
    walletClient: createWalletClient({
      account: address,
      chain: polygonWithRpc,
      transport: custom(ethereum),
    }),
  };
}

export function createConnectedWallet(address: HexAddress) {
  return createWalletClient({
    account: address,
    chain: polygonWithRpc,
    transport: custom(getEthereum()),
  });
}

export async function ensurePolygonNetwork(ethereum = getEthereum()) {
  const chainId = await ethereum.request<string>({ method: "eth_chainId" }).catch(() => "");
  if (chainId?.toLowerCase() === "0x89") return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x89" }],
    });
  } catch {
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x89",
        chainName: "Polygon",
        nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
        rpcUrls: [POLYGON_RPC_URL],
        blockExplorerUrls: ["https://polygonscan.com"],
      }],
    });
  }
}

export async function createRelayer(walletClient: WalletClient) {
  const { RelayClient } = await import("@polymarket/builder-relayer-client");
  const builderConfig = {
    isValid: () => true,
    generateBuilderHeaders: async (method: string, path: string, body?: string, timestamp?: number) => {
      const response = await fetch("/.netlify/functions/builder-sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, path, body, timestamp }),
      });
      if (!response.ok) return undefined;
      return response.json();
    },
  };

  return new RelayClient(
    RELAYER_URL,
    CHAIN_ID,
    walletClient as never,
    builderConfig as never,
    undefined,
    { chain: polygonWithRpc },
  );
}

export async function deriveDepositWallet(walletClient: WalletClient) {
  const relayer = await createRelayer(walletClient);
  const address = await relayer.deriveDepositWalletAddress();
  const exists = await relayer.getDeployed(address, "WALLET");
  return { relayer, address: address as HexAddress, exists };
}

export async function deployDepositWallet(walletClient: WalletClient) {
  const { relayer, address, exists } = await deriveDepositWallet(walletClient);
  if (exists) return { depositWallet: address, txHash: "", deployed: false };
  const tx = await relayer.deployDepositWallet();
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Deposit wallet deployment failed.");
  return { depositWallet: address, txHash: receipt.transactionHash || "", deployed: true };
}

export async function approveDepositWallet(walletClient: WalletClient, depositWallet: HexAddress) {
  const relayer = await createRelayer(walletClient);
  const calls = [
    {
      target: PUSD,
      value: "0",
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [EXCHANGE, maxUint256] }),
    },
    {
      target: PUSD,
      value: "0",
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [NEG_RISK_EXCHANGE, maxUint256] }),
    },
    {
      target: PUSD,
      value: "0",
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [NEG_RISK_ADAPTER, maxUint256] }),
    },
    {
      target: CTF,
      value: "0",
      data: encodeFunctionData({ abi: CTF_ABI, functionName: "setApprovalForAll", args: [EXCHANGE, true] }),
    },
    {
      target: CTF,
      value: "0",
      data: encodeFunctionData({ abi: CTF_ABI, functionName: "setApprovalForAll", args: [NEG_RISK_EXCHANGE, true] }),
    },
  ];
  const deadline = String(Math.floor(Date.now() / 1000) + 3600);
  const tx = await relayer.executeDepositWalletBatch(calls, depositWallet, deadline);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Approval relay transaction failed.");
  return { txHash: receipt.transactionHash || "" };
}

export async function getWalletStatus(address: HexAddress, walletClient: WalletClient): Promise<WalletStatus> {
  const { address: depositWallet, exists } = await deriveDepositWallet(walletClient);
  const [
    polRaw,
    usdcRaw,
    userPusdRaw,
    depositPusdRaw,
    exchangeAllowanceRaw,
    negRiskExchangeAllowanceRaw,
    negRiskAdapterAllowanceRaw,
    ctfExchangeApproved,
    ctfNegRiskApproved,
  ] = await Promise.all([
    publicClient.getBalance({ address }).catch(() => 0n),
    readErc20(USDC_E, address),
    readErc20(PUSD, address),
    readErc20(PUSD, depositWallet),
    exists ? readAllowance(PUSD, depositWallet, EXCHANGE) : Promise.resolve(0n),
    exists ? readAllowance(PUSD, depositWallet, NEG_RISK_EXCHANGE) : Promise.resolve(0n),
    exists ? readAllowance(PUSD, depositWallet, NEG_RISK_ADAPTER) : Promise.resolve(0n),
    exists ? readCtfApproved(depositWallet, EXCHANGE) : Promise.resolve(false),
    exists ? readCtfApproved(depositWallet, NEG_RISK_EXCHANGE) : Promise.resolve(false),
  ]);

  const approvalsReady =
    exchangeAllowanceRaw > parseUnits("1000", 6) &&
    negRiskExchangeAllowanceRaw > parseUnits("1000", 6) &&
    negRiskAdapterAllowanceRaw > parseUnits("1000", 6) &&
    ctfExchangeApproved &&
    ctfNegRiskApproved;
  const pusdBalance = Number(formatUnits(depositPusdRaw, 6));

  return {
    ok: true,
    botAddress: address,
    depositWallet,
    depositWalletExists: exists,
    polBalance: Number(formatEther(polRaw)),
    polUsdcEstimate: Number(formatUnits(await quoteSpendablePolToUsdc(polRaw).catch(() => 0n), 6)),
    usdcBalance: Number(formatUnits(usdcRaw, 6)),
    botPusdBalance: Number(formatUnits(userPusdRaw, 6)),
    pusdBalance,
    exchangeAllowance: Number(formatUnits(exchangeAllowanceRaw, 6)),
    negRiskExchangeAllowance: Number(formatUnits(negRiskExchangeAllowanceRaw, 6)),
    negRiskAdapterAllowance: Number(formatUnits(negRiskAdapterAllowanceRaw, 6)),
    ctfExchangeApproved,
    ctfNegRiskApproved,
    approvalsReady,
    readyToTrade: exists && approvalsReady && pusdBalance >= 1,
    reason: !exists
      ? "Deposit wallet not deployed"
      : !approvalsReady
        ? "Deposit wallet approvals missing"
        : pusdBalance < 1
          ? "Deposit at least $1 pUSD"
          : undefined,
  };
}

export async function fundDepositWallet(params: {
  address: HexAddress;
  walletClient: WalletClient;
  depositWallet: HexAddress;
  amountUsd: number;
}) {
  const amount = parseUnits(params.amountUsd.toFixed(6), 6);
  const txHashes: string[] = [];
  const userPusd = await readErc20(PUSD, params.address);

  if (userPusd >= amount) {
    const hash = await params.walletClient.writeContract({
      account: params.address,
      chain: polygonWithRpc,
      address: PUSD,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [params.depositWallet, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return { mode: "transfer-pusd", txHashes: [hash] };
  }

  let usdcBalance = await readErc20(USDC_E, params.address);
  if (usdcBalance < amount) {
    const swap = await swapPolToUsdcE(params.walletClient, params.address, params.amountUsd);
    txHashes.push(swap.txHash);
    usdcBalance = await readErc20(USDC_E, params.address);
  }

  if (usdcBalance < amount) {
    throw new Error(`Need $${params.amountUsd.toFixed(2)} pUSD/USDC.e or enough POL to swap.`);
  }

  const allowance = await readAllowance(USDC_E, params.address, COLLATERAL_ONRAMP);
  if (allowance < amount) {
    const approveHash = await params.walletClient.writeContract({
      account: params.address,
      chain: polygonWithRpc,
      address: USDC_E,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [COLLATERAL_ONRAMP, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    txHashes.push(approveHash);
  }

  const wrapHash = await params.walletClient.writeContract({
    account: params.address,
    chain: polygonWithRpc,
    address: COLLATERAL_ONRAMP,
    abi: ONRAMP_ABI,
    functionName: "wrap",
    args: [USDC_E, params.depositWallet, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: wrapHash });
  txHashes.push(wrapHash);
  return { mode: "wrap-usdce", txHashes };
}

export async function withdrawPusd(params: {
  walletClient: WalletClient;
  depositWallet: HexAddress;
  recipient: HexAddress;
  amountUsd: number;
}) {
  const relayer = await createRelayer(params.walletClient);
  const amount = parseUnits(params.amountUsd.toFixed(6), 6);
  const deadline = String(Math.floor(Date.now() / 1000) + 3600);
  const tx = await relayer.executeDepositWalletBatch(
    [{
      target: PUSD,
      value: "0",
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [params.recipient, amount],
      }),
    }],
    params.depositWallet,
    deadline,
  );
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Withdraw relay transaction failed.");
  return { txHash: receipt.transactionHash || "" };
}

export function readStoredClobCreds(address: string): ClobCreds | null {
  try {
    const raw = localStorage.getItem(clobCredsStorageKey(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClobCreds>;
    if (!parsed.key || !parsed.secret || !parsed.passphrase) return null;
    return { key: parsed.key, secret: parsed.secret, passphrase: parsed.passphrase };
  } catch {
    return null;
  }
}

export function clearStoredClobCreds(address: string) {
  localStorage.removeItem(clobCredsStorageKey(address));
}

export async function ensureClobCreds(walletClient: WalletClient, address: HexAddress) {
  const stored = readStoredClobCreds(address);
  if (stored) return stored;
  const creds = await generateClobCredsBrowser(walletClient, address);
  localStorage.setItem(clobCredsStorageKey(address), JSON.stringify({ ...creds, savedAt: Date.now() }));
  return creds;
}

export async function generateClobCredsBrowser(walletClient: WalletClient, address: HexAddress): Promise<ClobCreds> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await walletClient.signTypedData({
    account: address,
    domain: CLOB_AUTH_DOMAIN,
    types: CLOB_AUTH_TYPES,
    primaryType: "ClobAuth",
    message: {
      address,
      timestamp,
      nonce: 0n,
      message: "This message attests that I control the given wallet",
    },
  });
  const headers = {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: timestamp,
    POLY_NONCE: "0",
  };

  let res = await fetch(`${CLOB_HOST}/auth/derive-api-key`, { headers });
  if (!res.ok) {
    res = await fetch(`${CLOB_HOST}/auth/api-key`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(String(err.error || err.message || `CLOB auth failed: ${res.status}`));
  }
  const data = await res.json();
  return {
    key: String(data.apiKey || data.api_key || data.key || ""),
    secret: String(data.apiSecret || data.api_secret || data.secret || ""),
    passphrase: String(data.apiPassphrase || data.api_passphrase || data.passphrase || ""),
  };
}

export async function submitOrder(params: {
  walletClient: WalletClient;
  address: HexAddress;
  depositWallet: HexAddress;
  creds: ClobCreds;
  builderCode: string;
  market: Market;
  side: "YES" | "NO";
  action: "buy" | "sell";
  amountUsd?: number;
  shares?: number;
  limitPrice: number;
}) {
  const { Chain, ClobClient, OrderType, Side, SignatureTypeV2, isV2Order, orderToJsonV2 } = await import("@polymarket/clob-client-v2");
  const tokenId = tokenForSide(params.market, params.side);
  const client = new ClobClient({
    host: CLOB_HOST,
    chain: Chain.POLYGON,
    signer: params.walletClient as never,
    creds: params.creds,
    signatureType: SignatureTypeV2.POLY_1271,
    funderAddress: params.depositWallet,
    throwOnError: true,
    retryOnError: true,
    ...(params.builderCode ? { builderConfig: { builderCode: params.builderCode } } : {}),
  });

  await syncBalanceAllowance(params.creds, params.address).catch(() => undefined);
  const tickSize = await client.getTickSize(tokenId);
  const negRisk = await client.getNegRisk(tokenId).catch(() => Boolean(params.market.negRisk));
  const price = normalizePrice(params.limitPrice, tickSize);
  const size = params.action === "sell"
    ? normalizeSize(Number(params.shares || 0), tickSize)
    : normalizeBuySize(Number(params.amountUsd || 0) / price, tickSize);
  if (!Number.isFinite(size) || size <= 0) throw new Error("Invalid order size.");
  if (size * price < 1) throw new Error("Polymarket orders need about $1 minimum notional.");

  const signedOrder = await client.createOrder(
    {
      tokenID: tokenId,
      price,
      size,
      side: params.action === "sell" ? Side.SELL : Side.BUY,
    },
    { tickSize, negRisk },
  );
  if (!isV2Order(signedOrder)) throw new Error("CLOB produced a legacy order format.");

  const clobPayload = orderToJsonV2(signedOrder, params.creds.key, OrderType.GTC);
  const response = await fetch("/.netlify/functions/trade-relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clobPayload,
      clobCreds: params.creds,
      polyAddress: params.address,
      marketId: params.market.id,
      marketTitle: params.market.question,
      outcomeSide: params.side,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(String(data.error || `Trade relay failed: ${response.status}`));
  return data as SignedOrderResponse;
}

export async function loadPublicPositions(depositWallet: string): Promise<Position[]> {
  if (!depositWallet) return [];
  const data = await fetch(`/.netlify/functions/positions-public?wallet=${encodeURIComponent(depositWallet)}`).then((res) => res.json());
  if (!data.ok) throw new Error(data.error || "Could not load positions.");
  return data.positions || [];
}

async function swapPolToUsdcE(walletClient: WalletClient, address: HexAddress, amountUsd: number) {
  const polBalance = await publicClient.getBalance({ address });
  if (polBalance <= POL_GAS_RESERVE) throw new Error("Not enough POL for swap plus gas.");
  const amountOutNeeded = parseUnits(amountUsd.toFixed(6), 6);
  const spendablePol = polBalance - POL_GAS_RESERVE;
  const bestQuote = await quoteBestPolSwap(parseEther("1"));
  if (!bestQuote || bestQuote.amountOut === 0n) throw new Error("Could not quote POL to USDC.e swap.");

  const paddedPolIn = (amountOutNeeded * parseEther("1") * 106n) / (bestQuote.amountOut * 100n);
  const amountIn = paddedPolIn > spendablePol ? spendablePol : paddedPolIn;
  const expectedOut = await quotePolSwap(amountIn, bestQuote.fee).catch(() => 0n);
  if (expectedOut < amountOutNeeded) throw new Error("Not enough spendable POL to cover this deposit.");

  const hash = await walletClient.writeContract({
    account: address,
    chain: polygonWithRpc,
    address: UNISWAP_ROUTER,
    abi: UNISWAP_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn: WPOL,
      tokenOut: USDC_E,
      fee: bestQuote.fee,
      recipient: address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
      amountIn,
      amountOutMinimum: (expectedOut * 97n) / 100n,
      sqrtPriceLimitX96: 0n,
    }],
    value: amountIn,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash };
}

async function readErc20(token: HexAddress, owner: HexAddress) {
  return await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  }).catch(() => 0n);
}

async function readAllowance(token: HexAddress, owner: HexAddress, spender: HexAddress) {
  return await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  }).catch(() => 0n);
}

async function readCtfApproved(owner: HexAddress, operator: HexAddress) {
  return await publicClient.readContract({
    address: CTF,
    abi: CTF_ABI,
    functionName: "isApprovedForAll",
    args: [owner, operator],
  }).catch(() => false);
}

async function quoteSpendablePolToUsdc(polRaw: bigint) {
  if (polRaw <= POL_GAS_RESERVE) return 0n;
  const quote = await quoteBestPolSwap(polRaw - POL_GAS_RESERVE);
  return quote?.amountOut || 0n;
}

async function quoteBestPolSwap(amountIn: bigint) {
  const quotes = await Promise.all(
    POL_SWAP_FEES.map(async (fee) => ({
      fee,
      amountOut: await quotePolSwap(amountIn, fee).catch(() => 0n),
    })),
  );
  return quotes.sort((a, b) => Number(b.amountOut - a.amountOut))[0] || null;
}

async function quotePolSwap(amountIn: bigint, fee: typeof POL_SWAP_FEES[number]) {
  return await publicClient.readContract({
    address: UNISWAP_QUOTER,
    abi: UNISWAP_QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [WPOL, USDC_E, fee, amountIn, 0n],
  });
}

async function syncBalanceAllowance(creds: ClobCreds, address: HexAddress) {
  const path = "/balance-allowance/update?signature_type=3&asset_type=COLLATERAL";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const msg = `${timestamp}GET${path}`;
  const keyBytes = Uint8Array.from(atob(creds.secret.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBytes = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(msg));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBytes))).replace(/\+/g, "-").replace(/\//g, "_");

  await fetch(`${CLOB_HOST}${path}`, {
    headers: {
      POLY_ADDRESS: address,
      POLY_API_KEY: creds.key,
      POLY_SIGNATURE: signature,
      POLY_TIMESTAMP: timestamp,
      POLY_PASSPHRASE: creds.passphrase,
    },
  });
}

function clobCredsStorageKey(address: string) {
  return `polymarket-wizard:clob-creds:v1:${address.toLowerCase()}`;
}

function tokenForSide(market: Market, side: "YES" | "NO") {
  const index = market.outcomes.findIndex((outcome) => outcome.toUpperCase() === side);
  const token = market.clobTokenIds[index];
  if (!token) throw new Error(`Market is missing ${side} token ID.`);
  return token;
}

function normalizePrice(price: number, tickSize: string) {
  const decimals = tickDecimals(tickSize);
  const factor = 10 ** decimals;
  return Math.max(0.01, Math.min(0.99, Math.floor(price * factor) / factor));
}

function normalizeSize(size: number, tickSize: string) {
  const decimals = tickDecimals(tickSize);
  const factor = 10 ** decimals;
  return Math.floor(size * factor) / factor;
}

function normalizeBuySize(size: number, tickSize: string) {
  const decimals = tickDecimals(tickSize);
  const factor = 10 ** decimals;
  return Math.ceil(size * factor) / factor;
}

function tickDecimals(tickSize: string) {
  if (tickSize === "0.1") return 1;
  if (tickSize === "0.001") return 3;
  if (tickSize === "0.0001") return 4;
  return 2;
}
