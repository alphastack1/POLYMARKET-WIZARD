import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { RelayClient } from "@polymarket/builder-relayer-client";
import {
  AssetType,
  Chain,
  ClobClient,
  OrderType,
  SignatureTypeV2,
  Side,
  isV2Order,
  orderToJsonV2,
} from "@polymarket/clob-client-v2";
import { encodeFunctionData, formatEther, formatUnits, maxUint256, parseUnits, zeroAddress } from "viem";
import { writeJournal } from "./_journal";
import { validateMarket, type Market } from "./_market";
import {
  COLLATERAL_ONRAMP,
  CTF,
  CTF_ABI,
  ERC20_ABI,
  EXCHANGE,
  NEG_RISK_ADAPTER,
  NEG_RISK_EXCHANGE,
  ONRAMP_ABI,
  PUSD,
  UNISWAP_QUOTER,
  UNISWAP_QUOTER_ABI,
  UNISWAP_ROUTER,
  UNISWAP_ROUTER_ABI,
  USDC_E,
  WPOL,
} from "./_contracts";
import { getBotAddress, getPublicClient, getWalletClient, polygonWithRpc } from "./_wallet";

const RELAYER_URL = "https://relayer-v2.polymarket.com";
const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;
const POL_SWAP_FEES = [100, 500, 3000, 10000] as const;
const POL_GAS_RESERVE = parseUnits(process.env.POL_GAS_RESERVE || "0.5", 18);

export type WalletStatusDetails = {
  botAddress: string;
  depositWallet: string | null;
  depositWalletExists: boolean;
  polBalance: number;
  polUsdcEstimate: number;
  usdcBalance: number;
  botPusdBalance: number;
  pusdBalance: number;
  exchangeAllowance: number;
  negRiskExchangeAllowance: number;
  negRiskAdapterAllowance: number;
  ctfExchangeApproved: boolean;
  ctfNegRiskApproved: boolean;
  approvalsReady: boolean;
  readyToTrade: boolean;
  reason?: string;
};

export async function getRelayer() {
  const builderConfig = new BuilderConfig({
    localBuilderCreds: {
      key: process.env.POLYMARKET_BUILDER_API_KEY || "",
      secret: process.env.POLYMARKET_BUILDER_SECRET || "",
      passphrase: process.env.POLYMARKET_BUILDER_PASSPHRASE || "",
    },
  });

  return new RelayClient(
    RELAYER_URL,
    CHAIN_ID,
    getWalletClient(),
    builderConfig,
    undefined,
    { chain: polygonWithRpc },
  );
}

export async function getDepositWallet() {
  const relayer = await getRelayer();
  const address = await relayer.deriveDepositWalletAddress();
  const exists = await relayer.getDeployed(address, "WALLET");
  return { relayer, address: address as `0x${string}`, exists };
}

export async function deployDepositWalletIfNeeded() {
  const { relayer, address, exists } = await getDepositWallet();
  if (exists) return { depositWallet: address, deployed: false };

  const tx = await relayer.deployDepositWallet();
  const receipt = await tx.wait();
  if (!receipt) {
    const deployed = await relayer.getDeployed(address, "WALLET").catch(() => false);
    if (!deployed) throw new Error("Deposit wallet deployment failed");
  }

  await writeJournal({
    type: "deposit_wallet_deployed",
    message: `Deposit wallet ready: ${short(address)}`,
    data: { depositWallet: address },
  });

  return { depositWallet: address, deployed: true };
}

export async function approveDepositWalletForTrading() {
  const { relayer, address } = await getDepositWallet();
  const calls = [
    {
      target: PUSD,
      value: "0",
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [EXCHANGE, maxUint256],
      }),
    },
    {
      target: PUSD,
      value: "0",
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [NEG_RISK_EXCHANGE, maxUint256],
      }),
    },
    {
      target: PUSD,
      value: "0",
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [NEG_RISK_ADAPTER, maxUint256],
      }),
    },
    {
      target: CTF,
      value: "0",
      data: encodeFunctionData({
        abi: CTF_ABI,
        functionName: "setApprovalForAll",
        args: [EXCHANGE, true],
      }),
    },
    {
      target: CTF,
      value: "0",
      data: encodeFunctionData({
        abi: CTF_ABI,
        functionName: "setApprovalForAll",
        args: [NEG_RISK_EXCHANGE, true],
      }),
    },
  ];

  const deadline = String(Math.floor(Date.now() / 1000) + 3600);
  const tx = await relayer.executeDepositWalletBatch(calls, address, deadline);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Deposit wallet approval batch failed");

  await writeJournal({
    type: "approvals_ready",
    message: "Deposit wallet approvals ready",
    data: { depositWallet: address },
  });

  return receipt;
}

export async function getWalletStatusDetails(): Promise<WalletStatusDetails> {
  const botAddress = getBotAddress();
  const publicClient = getPublicClient();
  const { address: depositWallet, exists } = await getDepositWallet().catch(() => ({
    address: null,
    exists: false,
  }));

  const [polRaw, usdcRaw, botPusdRaw, depositPusdRaw] = await Promise.all([
    publicClient.getBalance({ address: botAddress as `0x${string}` }).catch(() => 0n),
    publicClient.readContract({
      address: USDC_E,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [botAddress as `0x${string}`],
    }).catch(() => 0n),
    publicClient.readContract({
      address: PUSD,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [botAddress as `0x${string}`],
    }).catch(() => 0n),
    depositWallet
      ? publicClient.readContract({
          address: PUSD,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [depositWallet],
        }).catch(() => 0n)
      : Promise.resolve(0n),
  ]);

  const allowanceArgs = depositWallet ? [depositWallet, EXCHANGE] as const : [zeroAddress, EXCHANGE] as const;
  const [
    exchangeAllowanceRaw,
    negRiskExchangeAllowanceRaw,
    negRiskAdapterAllowanceRaw,
    ctfExchangeApproved,
    ctfNegRiskApproved,
  ] = depositWallet && exists
    ? await Promise.all([
        publicClient.readContract({ address: PUSD, abi: ERC20_ABI, functionName: "allowance", args: allowanceArgs }).catch(() => 0n),
        publicClient.readContract({ address: PUSD, abi: ERC20_ABI, functionName: "allowance", args: [depositWallet, NEG_RISK_EXCHANGE] }).catch(() => 0n),
        publicClient.readContract({ address: PUSD, abi: ERC20_ABI, functionName: "allowance", args: [depositWallet, NEG_RISK_ADAPTER] }).catch(() => 0n),
        publicClient.readContract({ address: CTF, abi: CTF_ABI, functionName: "isApprovedForAll", args: [depositWallet, EXCHANGE] }).catch(() => false),
        publicClient.readContract({ address: CTF, abi: CTF_ABI, functionName: "isApprovedForAll", args: [depositWallet, NEG_RISK_EXCHANGE] }).catch(() => false),
      ])
    : [0n, 0n, 0n, false, false];

  const approvalsReady =
    exchangeAllowanceRaw > parseUnits("1000", 6) &&
    negRiskExchangeAllowanceRaw > parseUnits("1000", 6) &&
    negRiskAdapterAllowanceRaw > parseUnits("1000", 6) &&
    Boolean(ctfExchangeApproved) &&
    Boolean(ctfNegRiskApproved);
  const polBalance = Number(formatEther(polRaw));
  const polUsdcEstimate = Number(formatUnits(await quoteSpendablePolToUsdc(polRaw).catch(() => 0n), 6));
  const usdcBalance = Number(formatUnits(usdcRaw, 6));
  const botPusdBalance = Number(formatUnits(botPusdRaw, 6));
  const pusdBalance = Number(formatUnits(depositPusdRaw, 6));

  let reason: string | undefined;
  if (!depositWallet) reason = "Could not derive deposit wallet";
  else if (!exists) reason = "Deposit wallet not deployed";
  else if (!approvalsReady) reason = "Deposit wallet approvals missing";
  else if (pusdBalance < 1) reason = "Deposit wallet needs pUSD. Send POL, USDC.e, or pUSD to the bot wallet, then deposit.";
  else reason = undefined;

  return {
    botAddress,
    depositWallet,
    depositWalletExists: exists,
    polBalance,
    polUsdcEstimate,
    usdcBalance,
    botPusdBalance,
    pusdBalance,
    exchangeAllowance: Number(formatUnits(exchangeAllowanceRaw, 6)),
    negRiskExchangeAllowance: Number(formatUnits(negRiskExchangeAllowanceRaw, 6)),
    negRiskAdapterAllowance: Number(formatUnits(negRiskAdapterAllowanceRaw, 6)),
    ctfExchangeApproved: Boolean(ctfExchangeApproved),
    ctfNegRiskApproved: Boolean(ctfNegRiskApproved),
    approvalsReady,
    readyToTrade: Boolean(exists && approvalsReady && pusdBalance >= 1),
    reason,
  };
}

export async function wrapBotUsdcToDepositWallet(amountUsd: number) {
  const amount = parseUnits(amountUsd.toFixed(6), 6);
  const { address: depositWallet, exists } = await getDepositWallet();
  if (!exists) throw new Error("Deploy the deposit wallet before depositing");

  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const account = getBotAddress() as `0x${string}`;

  const usdcBalance = await publicClient.readContract({
    address: USDC_E,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  }) as bigint;
  const botPusdBalance = await publicClient.readContract({
    address: PUSD,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  }) as bigint;

  if (usdcBalance < amount && botPusdBalance < amount) {
    const swapped = await swapPolToUsdcEForAmount(amountUsd);
    if (!swapped) {
      throw new Error(`Need ${amountUsd.toFixed(2)} USDC.e, pUSD, or enough POL in bot wallet`);
    }
  }

  const refreshedUsdcBalance = await publicClient.readContract({
    address: USDC_E,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  }) as bigint;

  if (botPusdBalance >= amount) {
    const hash = await walletClient.writeContract({
      address: PUSD,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [depositWallet, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash, mode: "transfer-pusd", depositWallet };
  }

  const allowance = await publicClient.readContract({
    address: USDC_E,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, COLLATERAL_ONRAMP],
  }) as bigint;

  if (refreshedUsdcBalance < amount) {
    throw new Error(`POL swap completed but bot has only $${formatUnits(refreshedUsdcBalance, 6)} USDC.e`);
  }

  if (allowance < amount) {
    const approveHash = await walletClient.writeContract({
      address: USDC_E,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [COLLATERAL_ONRAMP, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const hash = await walletClient.writeContract({
    address: COLLATERAL_ONRAMP,
    abi: ONRAMP_ABI,
    functionName: "wrap",
    args: [USDC_E, depositWallet, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, mode: "wrap-usdce", depositWallet };
}

export async function swapPolToUsdcEForAmount(amountUsd: number) {
  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const account = getBotAddress() as `0x${string}`;
  const polBalance = await publicClient.getBalance({ address: account });
  if (polBalance <= POL_GAS_RESERVE) return null;

  const amountOutNeeded = parseUnits(amountUsd.toFixed(6), 6);
  const spendablePol = polBalance - POL_GAS_RESERVE;
  const bestQuote = await quoteBestPolSwap(parseUnits("1", 18));
  if (!bestQuote || bestQuote.amountOut === 0n) return null;

  const paddedPolIn = (amountOutNeeded * parseUnits("1", 18) * 105n) / (bestQuote.amountOut * 100n);
  const amountIn = paddedPolIn > spendablePol ? spendablePol : paddedPolIn;
  if (amountIn <= 0n) return null;

  const expectedOut = await quotePolSwap(amountIn, bestQuote.fee).catch(() => 0n);
  if (expectedOut < amountOutNeeded) return null;

  const minOut = (expectedOut * 97n) / 100n;
  const hash = await walletClient.writeContract({
    address: UNISWAP_ROUTER,
    abi: UNISWAP_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn: WPOL,
      tokenOut: USDC_E,
      fee: bestQuote.fee,
      recipient: account,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
      amountIn,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0n,
    }],
    value: amountIn,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  await writeJournal({
    type: "pol_swapped",
    message: `POL swapped to USDC.e for $${amountUsd.toFixed(2)} deposit`,
    data: {
      txHash: hash,
      fee: bestQuote.fee,
      amountInPol: formatEther(amountIn),
      expectedUsdcE: formatUnits(expectedOut, 6),
    },
  });

  return { txHash: hash, fee: bestQuote.fee, amountIn, expectedOut };
}

export async function withdrawPusdFromDepositWallet(amountUsd: number) {
  const amount = parseUnits(amountUsd.toFixed(6), 6);
  const { relayer, address: depositWallet, exists } = await getDepositWallet();
  if (!exists) throw new Error("Deposit wallet is not deployed");

  const call = {
    target: PUSD,
    value: "0",
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [getBotAddress() as `0x${string}`, amount],
    }),
  };
  const deadline = String(Math.floor(Date.now() / 1000) + 3600);
  const tx = await relayer.executeDepositWalletBatch([call], depositWallet, deadline);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Withdraw relay transaction failed");
  return { receipt, depositWallet };
}

export async function getClobClient() {
  const walletClient = getWalletClient();
  const { address: depositWallet } = await getDepositWallet();
  const envCreds = process.env.POLYMARKET_CLOB_API_KEY &&
    process.env.POLYMARKET_CLOB_SECRET &&
    process.env.POLYMARKET_CLOB_PASSPHRASE
    ? {
        key: process.env.POLYMARKET_CLOB_API_KEY,
        secret: process.env.POLYMARKET_CLOB_SECRET,
        passphrase: process.env.POLYMARKET_CLOB_PASSPHRASE,
      }
    : null;

  const bootstrap = new ClobClient({
    host: CLOB_HOST,
    chain: Chain.POLYGON,
    signer: walletClient as never,
    signatureType: SignatureTypeV2.POLY_1271,
    funderAddress: depositWallet,
    throwOnError: true,
    ...(process.env.POLYMARKET_BUILDER_CODE ? { builderConfig: { builderCode: process.env.POLYMARKET_BUILDER_CODE } } : {}),
  });
  const generatedCreds = envCreds || await deriveClobCreds(bootstrap);
  if (!generatedCreds) throw new Error("Could not create or derive CLOB API credentials for the bot wallet");

  return new ClobClient({
    host: CLOB_HOST,
    chain: Chain.POLYGON,
    signer: walletClient as never,
    creds: generatedCreds,
    signatureType: SignatureTypeV2.POLY_1271,
    funderAddress: depositWallet,
    throwOnError: true,
    retryOnError: true,
    ...(process.env.POLYMARKET_BUILDER_CODE ? { builderConfig: { builderCode: process.env.POLYMARKET_BUILDER_CODE } } : {}),
  });
}

async function deriveClobCreds(client: ClobClient) {
  const derived = await client.deriveApiKey(0).catch(() => null);
  if (derived?.key && derived.secret && derived.passphrase) return derived;

  const created = await client.createApiKey(0).catch(() => null);
  if (created?.key && created.secret && created.passphrase) return created;

  return null;
}

export async function syncBalanceAllowance() {
  const client = await getClobClient();
  await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
}

export async function placeOrder(params: {
  market: Market;
  side: "YES" | "NO";
  action: "buy" | "sell";
  amountUsd?: number;
  shares?: number;
  limitPrice?: number;
}) {
  const check = validateMarket(params.market);
  if (!check.ok) throw new Error(check.reason || "Market not tradeable");
  const status = await getWalletStatusDetails();
  if (!status.depositWalletExists) throw new Error("Deposit wallet not deployed");
  if (!status.approvalsReady) throw new Error("Deposit wallet approvals missing");
  if (params.action === "buy" && status.pusdBalance < Number(params.amountUsd || 0)) {
    throw new Error(`Deposit wallet has $${status.pusdBalance.toFixed(2)} pUSD; fund it before buying.`);
  }

  const tokenId = params.side === "YES" ? check.yesTokenId : check.noTokenId;
  const client = await getClobClient();
  await syncBalanceAllowance().catch(() => undefined);

  const tickSize = await client.getTickSize(tokenId);
  const negRisk = await client.getNegRisk(tokenId).catch(() => Boolean(params.market.negRisk));
  const marketPrice = Number(params.side === "YES" ? check.yesPrice : check.noPrice);
  const limitPrice = normalizePrice(
    params.limitPrice || (params.action === "buy" ? Math.min(0.99, marketPrice + 0.02) : Math.max(0.01, marketPrice - 0.02)),
    tickSize,
  );

  const amountUsd = Number(params.amountUsd || 0);
  const shares = params.action === "sell"
    ? Number(params.shares || 0)
    : normalizeSize(amountUsd / limitPrice, tickSize);
  if (!Number.isFinite(shares) || shares <= 0) throw new Error("Invalid order size");

  const signedOrder = await client.createOrder(
    {
      tokenID: tokenId,
      price: limitPrice,
      size: shares,
      side: params.action === "sell" ? Side.SELL : Side.BUY,
    },
    { tickSize, negRisk },
  );
  if (!isV2Order(signedOrder)) throw new Error("CLOB produced a legacy order");

  const response = await client.postOrder(signedOrder, OrderType.GTC);
  if (response?.success === false || response?.error || response?.errorMsg) {
    throw new Error(response.error || response.errorMsg || "CLOB rejected order");
  }

  return {
    response,
    orderId: String(response?.orderID || response?.orderId || response?.id || "unknown"),
    status: String(response?.status || "submitted"),
    tokenId,
    limitPrice,
    shares,
    signedOrder: orderToJsonV2(signedOrder, (client as any).creds?.key || "", OrderType.GTC),
  };
}

export async function placeTokenOrder(params: {
  tokenId: string;
  action: "buy" | "sell";
  amountUsd?: number;
  shares?: number;
  limitPrice: number;
}) {
  const status = await getWalletStatusDetails();
  if (!status.depositWalletExists) throw new Error("Deposit wallet not deployed");
  if (!status.approvalsReady) throw new Error("Deposit wallet approvals missing");
  if (params.action === "buy" && status.pusdBalance < Number(params.amountUsd || 0)) {
    throw new Error(`Deposit wallet has $${status.pusdBalance.toFixed(2)} pUSD; fund it before buying.`);
  }

  const client = await getClobClient();
  await syncBalanceAllowance().catch(() => undefined);

  const tickSize = await client.getTickSize(params.tokenId);
  const negRisk = await client.getNegRisk(params.tokenId).catch(() => false);
  const limitPrice = normalizePrice(params.limitPrice, tickSize);
  const amountUsd = Number(params.amountUsd || 0);
  const shares = params.action === "sell"
    ? Number(params.shares || 0)
    : normalizeSize(amountUsd / limitPrice, tickSize);
  if (!Number.isFinite(shares) || shares <= 0) throw new Error("Invalid order size");

  const signedOrder = await client.createOrder(
    {
      tokenID: params.tokenId,
      price: limitPrice,
      size: shares,
      side: params.action === "sell" ? Side.SELL : Side.BUY,
    },
    { tickSize, negRisk },
  );
  if (!isV2Order(signedOrder)) throw new Error("CLOB produced a legacy order");

  const response = await client.postOrder(signedOrder, OrderType.GTC);
  if (response?.success === false || response?.error || response?.errorMsg) {
    throw new Error(response.error || response.errorMsg || "CLOB rejected order");
  }

  return {
    response,
    orderId: String(response?.orderID || response?.orderId || response?.id || "unknown"),
    status: String(response?.status || "submitted"),
    tokenId: params.tokenId,
    limitPrice,
    shares,
  };
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
  const publicClient = getPublicClient();
  return await publicClient.readContract({
    address: UNISWAP_QUOTER,
    abi: UNISWAP_QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [WPOL, USDC_E, fee, amountIn, 0n],
  }) as bigint;
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

function tickDecimals(tickSize: string) {
  if (tickSize === "0.1") return 1;
  if (tickSize === "0.001") return 3;
  if (tickSize === "0.0001") return 4;
  return 2;
}

function short(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}
