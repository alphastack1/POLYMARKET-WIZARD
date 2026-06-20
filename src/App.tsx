import {
  ArrowDownToLine,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCcw,
  Search,
  ShieldCheck,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WalletClient } from "viem";
import { callApi } from "./api";
import {
  approveDepositWallet,
  clearStoredClobCreds,
  connectBrowserWallet,
  deployDepositWallet,
  ensureClobCreds,
  fundDepositWallet,
  getWalletStatus,
  loadPublicPositions,
  readStoredClobCreds,
  submitOrder,
  withdrawPusd,
} from "./polymarket";
import { loadSetting, saveSetting } from "./storage";
import type { EnvCheck, JournalEntry, Market, Position, WalletStatus } from "./types";

type AppTab = "setup" | "trade" | "positions" | "account";
type Side = "YES" | "NO";
type BookLevel = { price: number; size: number; total: number };
type TapeRow = { side: string; outcome: string; price: number; size: number; time: string; user: string };
type MarketLive = {
  ok: boolean;
  reason?: string;
  market?: Market;
  side?: Side;
  tokenId?: string;
  yesPrice?: number;
  noPrice?: number;
  spreadCents?: number;
  history?: { t: number; p: number }[];
  orderBook?: {
    bids: BookLevel[];
    asks: BookLevel[];
    lastTradePrice: number | null;
    tickSize: string | null;
    minOrderSize: string | null;
  };
  trades?: TapeRow[];
};
type ReviewOrder = {
  action: "buy" | "sell";
  market: Market;
  side: Side;
  amountUsd?: number;
  shares?: number;
  limitPrice: number;
  position?: Position;
};

const localJournalKey = "polymarket-wizard:journal:v1";
const defaultAmount = Number(loadSetting("amount", 1));

export default function App() {
  const [env, setEnv] = useState<EnvCheck | null>(null);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [hasCreds, setHasCreds] = useState(false);
  const [keyword, setKeyword] = useState(loadSetting("keyword", ""));
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selected, setSelected] = useState<Market | null>(() => loadSetting("selectedMarket", null));
  const [marketLive, setMarketLive] = useState<MarketLive | null>(null);
  const [side, setSide] = useState<Side>(() => (loadSetting<string>("side", "YES") === "NO" ? "NO" : "YES"));
  const [amount, setAmount] = useState(Number.isFinite(defaultAmount) ? Math.max(1, defaultAmount) : 1);
  const [depositAmount, setDepositAmount] = useState(1);
  const [withdrawAmount, setWithdrawAmount] = useState(1);
  const [positions, setPositions] = useState<Position[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>(() => readLocalJournal());
  const [activeTab, setActiveTab] = useState<AppTab>("setup");
  const [marketSearchOpen, setMarketSearchOpen] = useState(!selected);
  const [marketDataOpen, setMarketDataOpen] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewOrder | null>(null);

  const selectedPrice = side === "YES" ? marketLive?.yesPrice : marketLive?.noPrice;
  const setupReady = Boolean(address && wallet?.depositWalletExists && wallet.approvalsReady && hasCreds);
  const funded = Boolean(wallet && wallet.pusdBalance >= 1);
  const takerFeeBps = env?.builderFee?.takerBps ?? 0;
  const feeEstimate = (amount * takerFeeBps) / 10000;
  const tradeTotal = amount + feeEstimate;
  const tradeReady = Boolean(setupReady && funded && wallet && wallet.pusdBalance >= tradeTotal && selected && marketLive?.ok && selectedPrice && !env?.publicAppDisabled);

  const run = useCallback(async <T,>(label: string, task: () => Promise<T>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      return await task();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setBusy(null);
    }
  }, []);

  const addJournal = useCallback((entry: Omit<JournalEntry, "id" | "at">) => {
    const next = [{ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry }, ...journal].slice(0, 100);
    setJournal(next);
    localStorage.setItem(localJournalKey, JSON.stringify(next));
  }, [journal]);

  const refreshWallet = useCallback(async () => {
    if (!address || !walletClient) return null;
    const status = await getWalletStatus(address, walletClient);
    setWallet(status);
    setHasCreds(Boolean(readStoredClobCreds(address)));
    setDepositAmount(Math.max(1, Math.ceil(Math.max(0, 1 - status.pusdBalance) * 100) / 100 || 1));
    if (status.depositWallet) {
      const rows = await loadPublicPositions(status.depositWallet).catch(() => []);
      setPositions(rows);
    }
    return status;
  }, [address, walletClient]);

  const refreshEnv = useCallback(async () => {
    const next = await callApi<EnvCheck>("env-check");
    setEnv(next);
    return next;
  }, []);

  const refreshAll = useCallback(async () => {
    await refreshEnv();
    await refreshWallet();
  }, [refreshEnv, refreshWallet]);

  const loadMarketLive = useCallback(async (market: Market | null, nextSide = side) => {
    if (!market) {
      setMarketLive(null);
      return null;
    }
    const live = await callApi<MarketLive>("market-live", { marketId: market.id, side: nextSide });
    setMarketLive(live);
    return live;
  }, [side]);

  const searchMarkets = useCallback(async () => {
    saveSetting("keyword", keyword);
    await run("searching", async () => {
      const data = await callApi<{ ok: true; markets: Market[] }>(`search-markets?q=${encodeURIComponent(keyword)}`);
      setMarkets(data.markets);
      setMarketSearchOpen(true);
      if (!selected) {
        const first = data.markets.find((market) => !market.disabledReason);
        if (first) {
          setSelected(first);
          saveSetting("selectedMarket", first);
          await loadMarketLive(first);
        }
      }
      setNotice(`${data.markets.length} markets loaded`);
    });
  }, [keyword, loadMarketLive, run, selected]);

  const connect = () => run("connecting", async () => {
    const connected = await connectBrowserWallet();
    setAddress(connected.address);
    setWalletClient(connected.walletClient);
    setHasCreds(Boolean(readStoredClobCreds(connected.address)));
    setNotice("Wallet connected");
  });

  const prepareWallet = () => run("preparing", async () => {
    if (!address || !walletClient) throw new Error("Connect wallet first.");
    let depositWallet = wallet?.depositWallet as `0x${string}` | undefined;
    if (!wallet?.depositWalletExists || !depositWallet) {
      const deployed = await deployDepositWallet(walletClient);
      depositWallet = deployed.depositWallet;
      if (deployed.txHash) {
        addJournal({
          type: "deposit_wallet_deployed",
          message: "Deposit wallet deployed",
          data: { txHash: deployed.txHash, depositWallet: deployed.depositWallet },
        });
      }
    }
    if (!wallet?.approvalsReady) {
      const approved = await approveDepositWallet(walletClient, depositWallet);
      addJournal({
        type: "approvals_ready",
        message: "Trading approvals ready",
        data: { txHash: approved.txHash, depositWallet },
      });
    }
    if (!hasCreds) {
      await ensureClobCreds(walletClient, address);
      setHasCreds(true);
    }
    await refreshWallet();
    setNotice("Trading wallet ready");
  });

  const fund = () => run("funding", async () => {
    if (!address || !walletClient || !wallet?.depositWallet) throw new Error("Prepare wallet first.");
    const result = await fundDepositWallet({
      address,
      walletClient,
      depositWallet: wallet.depositWallet as `0x${string}`,
      amountUsd: depositAmount,
    });
    addJournal({
      type: "deposit",
      message: `Deposited ${money(depositAmount)} pUSD`,
      data: { mode: result.mode, txHash: result.txHashes.at(-1), txHashes: result.txHashes },
    });
    await refreshWallet();
    setNotice("Deposit complete");
  });

  const withdraw = () => run("withdrawing", async () => {
    if (!address || !walletClient || !wallet?.depositWallet) throw new Error("No deposit wallet.");
    const result = await withdrawPusd({
      walletClient,
      depositWallet: wallet.depositWallet as `0x${string}`,
      recipient: address,
      amountUsd: withdrawAmount,
    });
    addJournal({
      type: "withdraw",
      message: `Withdrew ${money(withdrawAmount)} pUSD`,
      data: { txHash: result.txHash, depositWallet: wallet.depositWallet },
    });
    await refreshWallet();
    setNotice("Withdraw complete");
  });

  const selectMarket = async (market: Market) => {
    if (market.disabledReason) return;
    setSelected(market);
    setMarketSearchOpen(false);
    saveSetting("selectedMarket", market);
    await run("market", async () => loadMarketLive(market));
  };

  const openBuyReview = () => {
    if (!selected || !selectedPrice) return;
    setReview({ action: "buy", market: selected, side, amountUsd: amount, limitPrice: selectedPrice });
  };

  const sellPosition = (position: Position) => {
    const market = positionToMarket(position);
    setReview({
      action: "sell",
      market,
      side: position.side,
      shares: position.shares,
      limitPrice: Math.max(0.01, position.currentPrice - 0.02),
      position,
    });
  };

  const submitReviewedOrder = () => run(review?.action === "sell" ? "selling" : "buying", async () => {
    if (!review || !address || !walletClient || !wallet?.depositWallet) throw new Error("Order is not ready.");
    if (env?.publicAppDisabled) throw new Error("Trading is temporarily disabled. Withdrawals remain available.");
    const creds = await ensureClobCreds(walletClient, address);
    const result = await submitOrder({
      walletClient,
      address,
      depositWallet: wallet.depositWallet as `0x${string}`,
      creds,
      builderCode: env?.builderCode || "",
      market: review.market,
      side: review.side,
      action: review.action,
      amountUsd: review.amountUsd,
      shares: review.shares,
      limitPrice: review.limitPrice,
    });
    addJournal({
      type: `${review.action}_submitted`,
      message: `${review.side} ${review.action} submitted: ${short(result.orderId)}`,
      data: { orderId: result.orderId, status: result.status, txHash: result.txHashes?.[0] },
    });
    setReview(null);
    await refreshWallet();
    setActiveTab("positions");
    setNotice(`Order submitted: ${short(result.orderId)}`);
  });

  useEffect(() => {
    refreshEnv().catch(() => undefined);
    searchMarkets().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!walletClient) return;
    refreshWallet().catch(() => undefined);
  }, [refreshWallet, walletClient]);

  useEffect(() => {
    loadMarketLive(selected, side).catch(() => undefined);
  }, [loadMarketLive, selected, side]);

  useEffect(() => saveSetting("side", side), [side]);
  useEffect(() => saveSetting("amount", amount), [amount]);

  const setupChecks = useMemo(() => ([
    { label: "Connect wallet", done: Boolean(address), value: address ? short(address) : "Required" },
    { label: "Create deposit wallet", done: Boolean(wallet?.depositWalletExists), value: wallet?.depositWallet ? short(wallet.depositWallet) : "Not created" },
    { label: "Approve trading", done: Boolean(wallet?.approvalsReady), value: wallet?.approvalsReady ? "Ready" : "Needs signature" },
    { label: "Trading credentials", done: hasCreds, value: hasCreds ? "Saved locally" : "Needs wallet signature" },
    { label: "Fund pUSD", done: funded, value: wallet ? money(wallet.pusdBalance) : "Waiting" },
  ]), [address, funded, hasCreds, wallet]);

  return (
    <main className="wizard-shell">
      <TopBar
        address={address}
        connected={Boolean(address)}
        busy={busy}
        onConnect={connect}
        onDisconnect={() => {
          setAddress(null);
          setWalletClient(null);
          setWallet(null);
          setHasCreds(false);
          setActiveTab("setup");
        }}
        onRefresh={() => run("syncing", refreshAll)}
      />

      {(error || notice) && <Toast tone={error ? "bad" : "good"}>{error || notice}</Toast>}

      <section className="status-strip">
        {setupChecks.map((check) => (
          <div key={check.label} className={check.done ? "status-chip done" : "status-chip"}>
            {check.done ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            <span>{check.label}</span>
            <strong>{check.value}</strong>
          </div>
        ))}
      </section>

      <nav className="tabs">
        <TabButton active={activeTab === "setup"} onClick={() => setActiveTab("setup")} icon={<ShieldCheck size={16} />} title="Setup" value={setupReady ? "Ready" : "Start"} />
        <TabButton active={activeTab === "trade"} onClick={() => setActiveTab("trade")} disabled={!setupReady} icon={<TrendingUp size={16} />} title="Trade" value={tradeReady ? "Live" : "Locked"} />
        <TabButton active={activeTab === "positions"} onClick={() => setActiveTab("positions")} disabled={!setupReady} icon={<Wallet size={16} />} title="Positions" value={String(positions.length)} />
        <TabButton active={activeTab === "account"} onClick={() => setActiveTab("account")} icon={<KeyRound size={16} />} title="Account" value={wallet ? money(wallet.pusdBalance) : "--"} />
      </nav>

      {activeTab === "setup" && (
        <SetupScreen
          checks={setupChecks}
          address={address}
          wallet={wallet}
          busy={busy}
          connected={Boolean(address)}
          setupReady={setupReady}
          funded={funded}
          connect={connect}
          prepareWallet={prepareWallet}
          fund={fund}
          depositAmount={depositAmount}
          setDepositAmount={setDepositAmount}
          goTrade={() => setActiveTab("trade")}
        />
      )}

      {activeTab === "trade" && (
        <TradeScreen
          env={env}
          keyword={keyword}
          setKeyword={setKeyword}
          searchMarkets={searchMarkets}
          busy={busy}
          markets={markets}
          selected={selected}
          selectMarket={selectMarket}
          marketLive={marketLive}
          marketSearchOpen={marketSearchOpen}
          setMarketSearchOpen={setMarketSearchOpen}
          marketDataOpen={marketDataOpen}
          setMarketDataOpen={setMarketDataOpen}
          side={side}
          setSide={setSide}
          amount={amount}
          setAmount={(value) => setAmount(Math.max(1, Math.round(value * 100) / 100))}
          selectedPrice={selectedPrice}
          wallet={wallet}
          feeEstimate={feeEstimate}
          tradeTotal={tradeTotal}
          tradeReady={tradeReady}
          setupReady={setupReady}
          openBuyReview={openBuyReview}
          goSetup={() => setActiveTab("setup")}
        />
      )}

      {activeTab === "positions" && (
        <PositionsScreen
          positions={positions}
          journal={journal}
          wallet={wallet}
          connected={Boolean(address)}
          sellPosition={sellPosition}
          refresh={() => run("syncing", refreshWallet)}
        />
      )}

      {activeTab === "account" && (
        <AccountScreen
          address={address}
          wallet={wallet}
          env={env}
          hasCreds={hasCreds}
          withdrawAmount={withdrawAmount}
          setWithdrawAmount={setWithdrawAmount}
          withdraw={withdraw}
          clearCreds={() => {
            if (address) clearStoredClobCreds(address);
            setHasCreds(false);
          }}
          busy={busy}
        />
      )}

      {review && (
        <ReviewModal
          order={review}
          wallet={wallet}
          takerFeeBps={takerFeeBps}
          busy={busy}
          onCancel={() => setReview(null)}
          onSubmit={submitReviewedOrder}
        />
      )}
    </main>
  );
}

function TopBar(props: {
  address: string | null;
  connected: boolean;
  busy: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand-mark"><Wallet size={20} /></div>
      <div>
        <h1>Polymarket Wizard</h1>
        <p>{props.connected ? short(props.address || "") : "Connect your wallet to start"}</p>
      </div>
      <div className="topbar-actions">
        <button className="icon-button" onClick={props.onRefresh} disabled={Boolean(props.busy)}>
          <RefreshCcw size={16} /> Sync
        </button>
        {props.connected ? (
          <button className="icon-button" onClick={props.onDisconnect}>
            <LogOut size={16} /> Lock
          </button>
        ) : (
          <button className="solid-button" onClick={props.onConnect} disabled={props.busy === "connecting"}>
            <Wallet size={16} /> Connect
          </button>
        )}
      </div>
    </header>
  );
}

function SetupScreen(props: {
  checks: { label: string; done: boolean; value: string }[];
  address: string | null;
  wallet: WalletStatus | null;
  busy: string | null;
  connected: boolean;
  setupReady: boolean;
  funded: boolean;
  connect: () => void;
  prepareWallet: () => void;
  fund: () => void;
  depositAmount: number;
  setDepositAmount: (value: number) => void;
  goTrade: () => void;
}) {
  const needsPrepare = props.connected && !props.setupReady;
  return (
    <section className="setup-grid">
      <section className="hero-panel">
        <span className="eyebrow">Public wallet mode</span>
        <h2>Set up your own Polymarket trading wallet.</h2>
        <p>Your connected wallet owns the deposit wallet, signs setup, funds pUSD, and signs trades. This site supplies the interface and Builder routing.</p>
        <div className="hero-actions">
          {!props.connected && <button className="solid-button big" onClick={props.connect}>Connect wallet <ArrowRight size={17} /></button>}
          {needsPrepare && <button className="solid-button big" onClick={props.prepareWallet} disabled={Boolean(props.busy)}>Prepare wallet <ArrowRight size={17} /></button>}
          {props.setupReady && !props.funded && <button className="solid-button big" onClick={props.fund} disabled={Boolean(props.busy)}>Deposit pUSD <ArrowRight size={17} /></button>}
          {props.setupReady && props.funded && <button className="solid-button big" onClick={props.goTrade}>Open trading <ArrowRight size={17} /></button>}
        </div>
      </section>

      <section className="desk-panel">
        <PanelHeader icon={<ShieldCheck size={16} />} title="Setup checklist" value={props.setupReady ? "Ready" : "Needs setup"} />
        <div className="check-list">
          {props.checks.map((check, index) => (
            <div key={check.label} className={check.done ? "check-row done" : "check-row"}>
              <b>{check.done ? <CheckCircle2 size={16} /> : index + 1}</b>
              <span>
                <strong>{check.label}</strong>
                <small>{check.value}</small>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="desk-panel">
        <PanelHeader icon={<ArrowDownToLine size={16} />} title="Fund wallet" value={money(props.wallet?.pusdBalance || 0)} />
        <p className="panel-copy">Deposit pUSD into your Polymarket deposit wallet. If your connected wallet has pUSD it transfers directly; if it has USDC.e it wraps; if it only has POL, the app swaps then wraps.</p>
        <label className="field">
          <span>Deposit amount</span>
          <input type="number" min="1" step="0.01" value={props.depositAmount} onChange={(event) => props.setDepositAmount(Math.max(1, Number(event.target.value)))} />
        </label>
        <button className="solid-button wide" onClick={props.fund} disabled={!props.setupReady || Boolean(props.busy)}>
          Deposit {money(props.depositAmount)}
        </button>
      </section>
    </section>
  );
}

function TradeScreen(props: {
  env: EnvCheck | null;
  keyword: string;
  setKeyword: (value: string) => void;
  searchMarkets: () => void;
  busy: string | null;
  markets: Market[];
  selected: Market | null;
  selectMarket: (market: Market) => void;
  marketLive: MarketLive | null;
  marketSearchOpen: boolean;
  setMarketSearchOpen: (open: boolean) => void;
  marketDataOpen: boolean;
  setMarketDataOpen: (open: boolean) => void;
  side: Side;
  setSide: (side: Side) => void;
  amount: number;
  setAmount: (value: number) => void;
  selectedPrice?: number;
  wallet: WalletStatus | null;
  feeEstimate: number;
  tradeTotal: number;
  tradeReady: boolean;
  setupReady: boolean;
  openBuyReview: () => void;
  goSetup: () => void;
}) {
  const shares = props.selectedPrice ? props.amount / props.selectedPrice : 0;
  const blocked = props.env?.publicAppDisabled
    ? "Trading disabled"
    : !props.setupReady
      ? "Finish setup"
    : !props.wallet?.readyToTrade
      ? "Fund pUSD"
      : props.wallet.pusdBalance < props.tradeTotal
        ? "Not enough pUSD"
      : !props.selected
        ? "Pick market"
          : !props.marketLive?.ok
            ? props.marketLive?.reason || "No live quote"
            : !props.selectedPrice
              ? "No price"
              : "";

  return (
    <section className="trade-layout">
      <section className="trade-main">
        <MarketSelector {...props} />
        <MarketData open={props.marketDataOpen} setOpen={props.setMarketDataOpen} marketLive={props.marketLive} side={props.side} />
      </section>
      <section className="order-ticket">
        <PanelHeader icon={<ShieldCheck size={16} />} title="Order" value={blocked || "Ready"} />
        <div className="outcome-picker">
          <button className={props.side === "YES" ? "yes active" : "yes"} onClick={() => props.setSide("YES")}>
            <span>YES</span><b>{cents(props.marketLive?.yesPrice)}</b>
          </button>
          <button className={props.side === "NO" ? "no active" : "no"} onClick={() => props.setSide("NO")}>
            <span>NO</span><b>{cents(props.marketLive?.noPrice)}</b>
          </button>
        </div>
        <label className="amount-card">
          <span>Amount</span>
          <input type="number" min="1" step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} />
        </label>
        <div className="preset-row">
          <button onClick={() => props.setAmount(1)}>$1</button>
          <button onClick={() => props.setAmount(5)}>$5</button>
          <button onClick={() => props.setAmount(Math.max(1, props.wallet?.pusdBalance || 1))}>Available</button>
        </div>
        <div className="summary-box">
          <KeyValue label="Limit" value={cents(props.selectedPrice)} />
          <KeyValue label="Shares" value={shares ? shares.toFixed(2) : "--"} />
          <KeyValue label="Builder fee est." value={money(props.feeEstimate)} />
          <KeyValue label="Max total" value={money(props.tradeTotal)} />
          <KeyValue label="pUSD available" value={money(props.wallet?.pusdBalance || 0)} />
        </div>
        {props.setupReady ? (
          <button className="solid-button wide trade-submit" onClick={props.openBuyReview} disabled={!props.tradeReady || Boolean(props.busy)}>
            {props.busy ? busyLabel(props.busy) : blocked || `Review ${props.side} order`}
            <ArrowRight size={16} />
          </button>
        ) : (
          <button className="solid-button wide" onClick={props.goSetup}>Finish setup <ArrowRight size={16} /></button>
        )}
      </section>
    </section>
  );
}

function MarketSelector(props: {
  keyword: string;
  setKeyword: (value: string) => void;
  searchMarkets: () => void;
  busy: string | null;
  markets: Market[];
  selected: Market | null;
  selectMarket: (market: Market) => void;
  marketLive: MarketLive | null;
  marketSearchOpen: boolean;
  setMarketSearchOpen: (open: boolean) => void;
}) {
  return (
    <section className="desk-panel">
      <div className="section-title">
        <div>
          <span>Market</span>
          <strong>{props.selected?.question || "Pick a market"}</strong>
        </div>
        <button className="icon-button" onClick={() => props.setMarketSearchOpen(!props.marketSearchOpen)}>
          <Search size={15} /> {props.marketSearchOpen ? "Hide" : "Search"}
        </button>
      </div>

      {props.selected && (
        <div className="selected-strip">
          <MarketThumb market={props.selected} />
          <div>
            <strong>{props.selected.question}</strong>
            <span>{money(props.selected.liquidity)} liquidity / {props.marketLive?.spreadCents ?? "--"}c spread / closes {formatDate(props.selected.endDate)}</span>
          </div>
          <div className="price-pair">
            <PricePill label="YES" value={cents(props.marketLive?.yesPrice)} tone="yes" />
            <PricePill label="NO" value={cents(props.marketLive?.noPrice)} tone="no" />
          </div>
        </div>
      )}

      {props.marketSearchOpen && (
        <div className="market-search-panel">
          <div className="search-row">
            <Search size={17} />
            <input
              value={props.keyword}
              onChange={(event) => props.setKeyword(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && props.searchMarkets()}
              placeholder="Search markets"
            />
            <button className="solid-button" onClick={props.searchMarkets} disabled={props.busy === "searching"}>Search</button>
          </div>
          <div className="market-list">
            {props.markets.length === 0 && <Empty text="No markets yet" />}
            {props.markets.map((market) => (
              <button key={market.id} className={props.selected?.id === market.id ? "market-row selected" : "market-row"} onClick={() => props.selectMarket(market)} disabled={Boolean(market.disabledReason)}>
                <MarketThumb market={market} />
                <span>
                  <strong>{market.question}</strong>
                  <small>{market.eventTitle || market.slug || "Market"}</small>
                </span>
                <b>{market.disabledReason || money(market.liquidity)}</b>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PositionsScreen(props: {
  positions: Position[];
  journal: JournalEntry[];
  wallet: WalletStatus | null;
  connected: boolean;
  sellPosition: (position: Position) => void;
  refresh: () => void;
}) {
  const exposure = props.positions.reduce((sum, position) => sum + position.value, 0);
  const pnl = props.positions.reduce((sum, position) => sum + position.pnl, 0);
  return (
    <section className="positions-grid">
      <section className="desk-panel">
        <PanelHeader icon={<Wallet size={16} />} title="Open positions" value={String(props.positions.length)} />
        <div className="mini-metrics">
          <KeyValue label="Exposure" value={money(exposure)} />
          <KeyValue label="P&L" value={signedMoney(pnl)} tone={pnl >= 0 ? "good" : "bad"} />
          <KeyValue label="pUSD" value={money(props.wallet?.pusdBalance || 0)} />
        </div>
        <button className="icon-button wide" onClick={props.refresh}><RefreshCcw size={15} /> Refresh positions</button>
        <div className="position-list">
          {!props.connected && <Empty text="Connect wallet" />}
          {props.connected && props.positions.length === 0 && <Empty text="No live positions" />}
          {props.positions.map((position) => (
            <details className="position-card" key={position.id}>
              <summary>
                <span>
                  <strong>{position.question}</strong>
                  <small>{position.side} / {position.shares.toFixed(2)} shares / {cents(position.currentPrice)}</small>
                </span>
                <b className={position.pnl >= 0 ? "good" : "bad"}>{signedMoney(position.pnl)}</b>
                <ChevronDown size={16} />
              </summary>
              <div className="position-detail-grid">
                <KeyValue label="Average" value={cents(position.avgPrice)} />
                <KeyValue label="Current" value={cents(position.currentPrice)} />
                <KeyValue label="Value" value={money(position.value)} />
                <KeyValue label="Token" value={short(position.tokenId)} />
              </div>
              <button className="solid-button wide" onClick={() => props.sellPosition(position)}>Review sell</button>
            </details>
          ))}
        </div>
      </section>
      <ActivityPanel journal={props.journal} />
    </section>
  );
}

function AccountScreen(props: {
  address: string | null;
  wallet: WalletStatus | null;
  env: EnvCheck | null;
  hasCreds: boolean;
  withdrawAmount: number;
  setWithdrawAmount: (value: number) => void;
  withdraw: () => void;
  clearCreds: () => void;
  busy: string | null;
}) {
  return (
    <section className="account-grid">
      <section className="desk-panel">
        <PanelHeader icon={<Wallet size={16} />} title="Wallets" value={props.address ? "Connected" : "Locked"} />
        <div className="summary-box">
          <KeyValue label="Connected wallet" value={short(props.address || "") || "--"} />
          <KeyValue label="Deposit wallet" value={short(props.wallet?.depositWallet || "") || "--"} />
          <KeyValue label="Deposit wallet pUSD" value={money(props.wallet?.pusdBalance || 0)} />
          <KeyValue label="Connected wallet POL" value={(props.wallet?.polBalance || 0).toFixed(4)} />
          <KeyValue label="Connected wallet USDC.e" value={money(props.wallet?.usdcBalance || 0)} />
          <KeyValue label="Connected wallet pUSD" value={money(props.wallet?.botPusdBalance || 0)} />
        </div>
        <div className="link-grid">
          {props.address && <a href={polygonAddressUrl(props.address)} target="_blank" rel="noreferrer">Connected wallet <ExternalLink size={14} /></a>}
          {props.wallet?.depositWallet && <a href={polygonAddressUrl(props.wallet.depositWallet)} target="_blank" rel="noreferrer">Deposit wallet <ExternalLink size={14} /></a>}
        </div>
      </section>

      <section className="desk-panel">
        <PanelHeader icon={<ArrowDownToLine size={16} />} title="Withdraw" value={money(props.wallet?.pusdBalance || 0)} />
        <p className="panel-copy">Withdraw sends pUSD from your Polymarket deposit wallet back to your connected wallet.</p>
        <label className="field">
          <span>Withdraw amount</span>
          <input type="number" min="1" step="0.01" value={props.withdrawAmount} onChange={(event) => props.setWithdrawAmount(Math.max(1, Number(event.target.value)))} />
        </label>
        <button className="solid-button wide" onClick={props.withdraw} disabled={!props.wallet?.depositWalletExists || !props.wallet.pusdBalance || Boolean(props.busy)}>
          Withdraw {money(props.withdrawAmount)}
        </button>
      </section>

      <section className="desk-panel">
        <PanelHeader icon={<KeyRound size={16} />} title="App settings" value={props.env?.publicAppDisabled ? "Trading off" : "Live"} />
        <div className="summary-box">
          <KeyValue label="Mode" value={props.env?.mode || "--"} />
          <KeyValue label="Builder taker fee" value={`${props.env?.builderFee?.takerBps ?? 100} bps`} />
          <KeyValue label="Builder maker fee" value={`${props.env?.builderFee?.makerBps ?? 50} bps`} />
          <KeyValue label="CLOB credentials" value={props.hasCreds ? "Stored locally" : "Not created"} />
        </div>
        <details className="inline-details">
          <summary><span>Advanced</span><ChevronDown size={15} /></summary>
          <button className="icon-button wide" onClick={props.clearCreds}>Reset local trading credentials</button>
        </details>
      </section>
    </section>
  );
}

function ReviewModal(props: {
  order: ReviewOrder;
  wallet: WalletStatus | null;
  takerFeeBps: number;
  busy: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const notional = props.order.amountUsd || (props.order.shares || 0) * props.order.limitPrice;
  const fee = (notional * props.takerFeeBps) / 10000;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="review-modal">
        <PanelHeader icon={<ShieldCheck size={16} />} title="Review order" value={props.order.action.toUpperCase()} />
        <h3>{props.order.market.question}</h3>
        <div className="summary-box">
          <KeyValue label="Action" value={`${props.order.action.toUpperCase()} ${props.order.side}`} tone={props.order.side === "YES" ? "good" : "bad"} />
          <KeyValue label="Limit" value={cents(props.order.limitPrice)} />
          <KeyValue label="Notional" value={money(notional)} />
          <KeyValue label="Shares" value={props.order.shares ? props.order.shares.toFixed(2) : props.order.limitPrice ? (notional / props.order.limitPrice).toFixed(2) : "--"} />
          <KeyValue label="Builder fee est." value={money(fee)} />
          <KeyValue label="pUSD available" value={money(props.wallet?.pusdBalance || 0)} />
        </div>
        <div className="modal-actions">
          <button className="icon-button" onClick={props.onCancel}>Cancel</button>
          <button className="solid-button" onClick={props.onSubmit} disabled={Boolean(props.busy)}>
            {props.busy ? busyLabel(props.busy) : "Submit order"} <ArrowRight size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}

function MarketData({ open, setOpen, marketLive, side }: {
  open: boolean;
  setOpen: (open: boolean) => void;
  marketLive: MarketLive | null;
  side: Side;
}) {
  return (
    <section className="market-data">
      <button className="drawer-toggle" onClick={() => setOpen(!open)}>
        <span>Market data</span>
        <ChevronDown className={open ? "open" : ""} size={16} />
      </button>
      {open && (
        <div className="data-grid">
          <LiveChart history={marketLive?.history || []} side={side} price={side === "YES" ? marketLive?.yesPrice : marketLive?.noPrice} />
          <DepthBook side={side} levels={marketLive?.orderBook} />
          <TradeTape rows={marketLive?.trades || []} />
        </div>
      )}
    </section>
  );
}

function LiveChart({ history, side, price }: { history: { t: number; p: number }[]; side: Side; price?: number }) {
  const values = history.slice(-80).map((point) => point.p);
  if (values.length < 2) {
    return (
      <div className="chart-card">
        <div className="chart-tabs"><span>{side} price history</span><span>{cents(price)}</span></div>
        <Empty text="No recent CLOB price history" />
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.01, max - min);
  const d = values.map((value, index) => {
    const x = index * (100 / Math.max(1, values.length - 1));
    const y = 92 - ((value - min) / range) * 76;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return (
    <div className="chart-card">
      <div className="chart-tabs"><span>{side} 24h CLOB history</span><span>{cents(price)}</span></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${side} CLOB price history`}>
        <path d={`${d} L 100 100 L 0 100 Z`} className="chart-fill" />
        <path d={d} className="chart-line" />
      </svg>
    </div>
  );
}

function DepthBook({ side, levels }: { side: Side; levels?: MarketLive["orderBook"] }) {
  return (
    <div className="book-card">
      <PanelHeader icon={<TrendingUp size={16} />} title="Order book" value={side} />
      <BookSide label="Asks" rows={levels?.asks || []} tone="bad" />
      <BookSide label="Bids" rows={levels?.bids || []} tone="good" />
      {!(levels?.bids?.length || levels?.asks?.length) && <Empty text="No book" />}
    </div>
  );
}

function BookSide({ label, rows, tone }: { label: string; rows: BookLevel[]; tone: "good" | "bad" }) {
  return (
    <div className="book-side">
      <div className="book-head"><span>{label}</span><span>Size</span><span>Total</span></div>
      {rows.slice(0, 5).map((row) => (
        <div className="book-row" key={`${label}-${row.price}-${row.size}`}>
          <strong className={tone}>{cents(row.price)}</strong>
          <span>{row.size.toFixed(2)}</span>
          <span>{money(row.total)}</span>
        </div>
      ))}
    </div>
  );
}

function TradeTape({ rows }: { rows: TapeRow[] }) {
  return (
    <div className="tape-card">
      <PanelHeader icon={<TrendingUp size={16} />} title="Tape" value={String(rows.length)} />
      {rows.length === 0 && <Empty text="No trades" />}
      {rows.slice(0, 8).map((row, index) => (
        <div className="tape-row" key={`${row.time}-${index}`}>
          <strong className={row.outcome?.toUpperCase() === "YES" ? "good" : "bad"}>{row.outcome || row.side}</strong>
          <span>{cents(row.price)}</span>
          <span>{row.size.toFixed(2)}</span>
          <small>{row.user}</small>
        </div>
      ))}
    </div>
  );
}

function ActivityPanel({ journal }: { journal: JournalEntry[] }) {
  return (
    <section className="desk-panel">
      <PanelHeader icon={<TrendingUp size={16} />} title="Activity" value={String(journal.length)} />
      <div className="activity-list">
        {journal.length === 0 && <Empty text="No activity yet" />}
        {journal.slice(0, 20).map((entry) => {
          const txHash = transactionHash(entry.data);
          return (
            <article className="activity-row" key={entry.id}>
              <time>{new Date(entry.at).toLocaleTimeString()}</time>
              <strong>{entry.type}</strong>
              <span>{entry.message}</span>
              {txHash && <a className="tx-link" href={polygonTxUrl(txHash)} target="_blank" rel="noreferrer">Tx</a>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TabButton(props: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  value: string;
}) {
  return (
    <button className={props.active ? "tab active" : "tab"} onClick={props.onClick} disabled={props.disabled}>
      {props.icon}
      <span>{props.title}</span>
      <strong>{props.value}</strong>
    </button>
  );
}

function PanelHeader({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return <div className="panel-header">{icon}<span>{title}</span><strong>{value}</strong></div>;
}

function KeyValue({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return <div className="key-value"><span>{label}</span><strong className={tone || ""}>{value}</strong></div>;
}

function PricePill({ label, value, tone }: { label: string; value: string; tone: "yes" | "no" }) {
  return <span className={`price-pill ${tone}`}><small>{label}</small><b>{value}</b></span>;
}

function MarketThumb({ market }: { market: Market | null }) {
  const [failed, setFailed] = useState(false);
  if (market?.image && !failed) return <img className="market-thumb" src={market.image} alt="" onError={() => setFailed(true)} />;
  return <div className="market-thumb fallback"><TrendingUp size={18} /></div>;
}

function Toast({ tone, children }: { tone: "good" | "bad"; children: React.ReactNode }) {
  return (
    <section className={`toast ${tone}`}>
      {tone === "good" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
      <span>{children}</span>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function readLocalJournal(): JournalEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(localJournalKey) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function positionToMarket(position: Position): Market {
  return {
    id: position.marketId,
    question: position.question,
    volume: 0,
    liquidity: 0,
    outcomes: [position.side],
    outcomePrices: [String(position.currentPrice)],
    clobTokenIds: [position.tokenId],
    active: true,
    closed: false,
  };
}

function transactionHash(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const row = data as Record<string, unknown>;
  const value = row.txHash;
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value) ? value : "";
}

function polygonTxUrl(txHash: string) {
  return `https://polygonscan.com/tx/${txHash}`;
}

function polygonAddressUrl(address: string) {
  return `https://polygonscan.com/address/${address}`;
}

function cents(value?: number | null) {
  if (!value) return "--";
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 0.05 ? `${rounded}c` : `${scaled.toFixed(1)}c`;
}

function money(value: number) {
  if (!Number.isFinite(value)) return "--";
  return `$${value.toFixed(2)}`;
}

function signedMoney(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function short(value: string) {
  if (!value) return "";
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function formatDate(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function busyLabel(value: string) {
  return (
    <span className="busy-label">
      <Loader2 size={15} className="spin" />
      {value[0]?.toUpperCase() || ""}{value.slice(1)}
    </span>
  );
}
