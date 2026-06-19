import {
  ArrowDownToLine,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  Flame,
  KeyRound,
  LockKeyhole,
  LogOut,
  Minus,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { callApi } from "./api";
import { loadSetting, saveSetting } from "./storage";
import type { ReactNode } from "react";
import type { EnvCheck, JournalEntry, Market, Position, WalletStatus } from "./types";

type AuthSession = {
  token: string;
  address: string;
  expiresAt: number;
};

type BookLevel = {
  price: number;
  size: number;
  total: number;
};

type TapeRow = {
  side: string;
  outcome: string;
  price: number;
  size: number;
  time: string;
  user: string;
};

type MarketLive = {
  ok: boolean;
  reason?: string;
  market?: Market;
  side?: "YES" | "NO";
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
  liveErrors?: string[];
};

type RiskLimits = NonNullable<EnvCheck["risk"]>;
type AppTab = "trade" | "positions" | "settings";
type StartupStatus = "checking" | "done" | "action";
type StartupCheck = {
  key: string;
  label: string;
  value: string;
  status: StartupStatus;
  actionTab: AppTab;
};

declare global {
  interface Window {
    ethereum?: {
      request: <T = unknown>(args: { method: string; params?: unknown[] }) => Promise<T>;
    };
  }
}

const pollMs = Number(import.meta.env.VITE_POLL_INTERVAL_MS || 60000);
const exitAutomationEnabled = false;
const defaultRisk: RiskLimits = {
  maxTradeUsd: 2,
  minTradeUsd: 1.1,
  maxFundingUsd: 2.1,
  maxOpenPositions: 3,
  maxPortfolioLossUsd: 10,
  maxSpreadCents: 5,
  maxOrderSlippageCents: 2,
  minLiquidityUsd: 1000,
  minHoursToResolution: 2,
};

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession());
  const [env, setEnv] = useState<EnvCheck | null>(null);
  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [keyword, setKeyword] = useState(loadSetting("keyword", ""));
  const storedSelected = useMemo(() => loadSetting<Market | null>("selectedMarket", null), []);
  const [markets, setMarkets] = useState<Market[]>(storedSelected ? [storedSelected] : []);
  const [selected, setSelected] = useState<Market | null>(storedSelected);
  const [marketLive, setMarketLive] = useState<MarketLive | null>(null);
  const [side, setSide] = useState<"YES" | "NO">(loadSetting("side", "YES"));
  const [amount, setAmount] = useState(clampTradeAmount(loadSetting("amount", defaultRisk.minTradeUsd), defaultRisk));
  const [withdrawAmount, setWithdrawAmount] = useState(loadSetting("withdrawAmount", defaultRisk.minTradeUsd));
  const [polling, setPolling] = useState(loadSetting("polling", false));
  const [positions, setPositions] = useState<Position[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const [marketSearchOpen, setMarketSearchOpen] = useState(!storedSelected);
  const [marketDataOpen, setMarketDataOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    const saved = loadSetting<string>("activeTab", "trade");
    return isAppTab(saved) ? saved : "trade";
  });
  const [startupVisible, setStartupVisible] = useState(true);

  const hasSession = Boolean(session?.token && session.expiresAt > Date.now());
  const isUnlocked = Boolean(hasSession && env?.authenticated);
  const risk = env?.risk || defaultRisk;
  const selectedPrice = side === "YES" ? marketLive?.yesPrice : marketLive?.noPrice;
  const walletArmed = Boolean(wallet?.depositWalletExists && wallet?.approvalsReady);
  const botCollateral = (wallet?.botPusdBalance || 0) + (wallet?.usdcBalance || 0) + (wallet?.polUsdcEstimate || 0);
  const tradeCollateralNeeded = Math.max(risk.minTradeUsd * 1.04, amount * 1.04);
  const depositTopUp = Math.max(0, tradeCollateralNeeded - (wallet?.pusdBalance || 0));
  const depositAmount = depositTopUp > 0
    ? Math.min(risk.maxFundingUsd, Math.max(1, Math.ceil(depositTopUp * 100) / 100))
    : 0;
  const tradeFunded = Boolean(wallet?.readyToTrade && (wallet?.pusdBalance || 0) >= tradeCollateralNeeded);
  const marketReady = Boolean(selected && marketLive?.ok);
  const exposure = useMemo(() => positions.reduce((sum, position) => sum + position.value, 0), [positions]);
  const pnl = useMemo(() => positions.reduce((sum, position) => sum + position.pnl, 0), [positions]);
  const buyBlock = buyBlockReason({
    booted,
    env,
    isUnlocked,
    wallet,
    walletArmed,
    tradeFunded,
    selected,
    marketLive,
    selectedPrice,
  });
  const startupChecks = useMemo<StartupCheck[]>(() => ([
    {
      key: "system",
      label: "System",
      value: !booted ? "Checking" : env?.ok ? "Ready" : "Config issue",
      status: !booted ? "checking" : env?.ok ? "done" : "action",
      actionTab: "settings",
    },
    {
      key: "session",
      label: "Wallet session",
      value: !booted ? "Waiting" : isUnlocked ? short(session?.address || "") : "Unlock needed",
      status: !booted ? "checking" : isUnlocked ? "done" : "action",
      actionTab: "settings",
    },
    {
      key: "wallet",
      label: "Trading wallet",
      value: !isUnlocked ? "Locked" : walletArmed ? "Armed" : wallet ? "Needs setup" : "Checking",
      status: !isUnlocked ? "action" : walletArmed ? "done" : wallet ? "action" : "checking",
      actionTab: "settings",
    },
    {
      key: "funds",
      label: "pUSD funds",
      value: !isUnlocked ? "Locked" : tradeFunded ? money(wallet?.pusdBalance || 0) : wallet ? `${money(depositAmount)} top-up` : "Checking",
      status: !isUnlocked ? "action" : tradeFunded ? "done" : wallet ? "action" : "checking",
      actionTab: "settings",
    },
    {
      key: "market",
      label: "Market",
      value: marketReady ? "Live" : selected ? "Loading quotes" : markets.length ? "Pick one" : "Finding markets",
      status: marketReady ? "done" : selected && !marketLive ? "checking" : "action",
      actionTab: "trade",
    },
  ]), [booted, depositAmount, env?.ok, isUnlocked, marketLive, marketReady, markets.length, selected, session?.address, tradeFunded, wallet, walletArmed]);

  const run = useCallback(async <T,>(label: string, task: () => Promise<T>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      return await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshEnv = useCallback(async () => {
    const next = await callApi<EnvCheck>("env-check");
    setEnv(next);
    if (session?.token && !next.authenticated) clearSession(setSession);
    return next;
  }, [session?.token]);

  const refreshWallet = useCallback(async () => setWallet(await callApi<WalletStatus>("wallet-status")), []);
  const refreshPositions = useCallback(async () => setPositions((await callApi<{ ok: true; positions: Position[] }>("positions")).positions), []);
  const refreshJournal = useCallback(async () => setJournal((await callApi<{ ok: true; entries: JournalEntry[] }>("journal")).entries), []);

  const refreshProtected = useCallback(async () => {
    if (!localStorage.getItem("wizardSessionToken")) return;
    await Promise.all([refreshWallet(), refreshPositions(), refreshJournal()]);
  }, [refreshJournal, refreshPositions, refreshWallet]);

  const refreshAll = useCallback(async () => {
    const nextEnv = await refreshEnv();
    if (localStorage.getItem("wizardSessionToken") && nextEnv.authenticated) await refreshProtected();
  }, [refreshEnv, refreshProtected]);

  const loadMarketLive = useCallback(async (market: Market | null, nextSide = side) => {
    if (!market) return setMarketLive(null);
    const live = await callApi<MarketLive>("market-live", { marketId: market.id, side: nextSide });
    setMarketLive(live);
  }, [side]);

  const searchMarkets = async () => {
    saveSetting("keyword", keyword);
    await run("scan", async () => {
      const data = await callApi<{ ok: true; markets: Market[] }>(`search-markets?q=${encodeURIComponent(keyword)}`);
      setMarkets(data.markets);
      setMarketSearchOpen(true);
      if (!selected) {
        const firstTradeable = data.markets.find((market) => !market.disabledReason);
        if (firstTradeable) await selectMarket(firstTradeable);
      }
      setNotice(`${data.markets.length} market${data.markets.length === 1 ? "" : "s"}`);
    });
  };

  const selectMarket = async (market: Market) => {
    if (market.disabledReason) return;
    setSelected(market);
    setMarketSearchOpen(false);
    saveSetting("selectedMarket", market);
    await run("market", () => loadMarketLive(market));
  };

  const connectWallet = () => run("unlock", async () => {
    if (!window.ethereum) throw new Error("Open this app in a browser with Rabby or MetaMask.");
    const accounts = await window.ethereum.request<string[]>({ method: "eth_requestAccounts" });
    const address = accounts[0];
    if (!address) throw new Error("No wallet address returned.");
    const challenge = await callApi<{ ok: true; nonce: string; message: string }>("auth-challenge", { address });
    const signature = await window.ethereum.request<string>({
      method: "personal_sign",
      params: [challenge.message, address],
    });
    const verified = await callApi<{ ok: true; token: string; address: string; expiresAt: number }>("auth-verify", {
      address,
      nonce: challenge.nonce,
      signature,
    });
    const next = { token: verified.token, address: verified.address, expiresAt: verified.expiresAt };
    saveSession(next);
    setSession(next);
    setNotice("Unlocked");
    await refreshAll();
  });

  const setupWallet = () => run("wallet", async () => {
    const data = await callApi<{ ok: boolean; message: string }>("setup-wallet", {});
    setNotice(data.message);
    await refreshProtected();
  });

  const deposit = () => run("deposit", async () => {
    if (!depositAmount) return;
    const data = await callApi<{ message: string; status?: WalletStatus }>("deposit", { amountUsd: depositAmount });
    setNotice(data.message);
    if (data.status) setWallet(data.status);
    await refreshProtected();
  });

  const withdraw = () => run("withdraw", async () => {
    const data = await callApi<{ message: string; status?: WalletStatus }>("withdraw", { amountUsd: withdrawAmount });
    setNotice(data.message);
    if (data.status) setWallet(data.status);
    await refreshProtected();
  });

  const buy = () => run("buy", async () => {
    if (!selected || !selectedPrice) throw new Error("No selected market/price");
    const data = await callApi<{ ok: boolean; message: string; status?: WalletStatus }>("buy", {
      marketId: selected.id,
      side,
      amountUsd: amount,
      limitPrice: selectedPrice,
    });
    setNotice(data.message);
    if (data.status) setWallet(data.status);
    await refreshProtected();
  });

  const sell = (position: Position) => run("sell", async () => {
    const ok = window.confirm(`Sell ${position.shares.toFixed(2)} ${position.side} shares using the live CLOB bid?`);
    if (!ok) return;
    const data = await callApi<{ ok: boolean; message: string; status?: WalletStatus }>("sell", {
      positionId: position.id,
      marketId: position.marketId,
      side: position.side,
      tokenId: position.tokenId,
      shares: position.shares,
      reason: "manual",
    });
    setNotice(data.message);
    if (data.status) setWallet(data.status);
    await refreshProtected();
  });

  const pollExits = useCallback(async () => {
    const data = await callApi<{ ok: boolean; message: string; sold: number }>("poll-exits", {});
    if (data.sold) setNotice(data.message);
    await refreshProtected();
  }, [refreshProtected]);

  useEffect(() => {
    let cancelled = false;
    refreshAll()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setBooted(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshAll]);

  useEffect(() => {
    if (markets.length === 0 && !storedSelected) searchMarkets().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMarketLive(selected, side).catch(() => undefined);
  }, [loadMarketLive, selected, side]);

  useEffect(() => saveSetting("side", side), [side]);
  useEffect(() => saveSetting("activeTab", activeTab), [activeTab]);
  useEffect(() => {
    const clamped = clampTradeAmount(amount, risk);
    if (clamped !== amount) setAmount(clamped);
    else saveSetting("amount", amount);
  }, [amount, risk.maxTradeUsd, risk.minTradeUsd]);
  useEffect(() => saveSetting("withdrawAmount", withdrawAmount), [withdrawAmount]);
  useEffect(() => saveSetting("polling", polling), [polling]);

  useEffect(() => {
    if (!exitAutomationEnabled || !polling || !isUnlocked || !tradeFunded || positions.length === 0) return;
    let running = false;
    async function tick() {
      if (running) return;
      running = true;
      try {
        await pollExits();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        running = false;
      }
    }
    tick();
    const id = window.setInterval(tick, pollMs);
    return () => window.clearInterval(id);
  }, [isUnlocked, pollExits, polling, positions.length, tradeFunded]);

  useEffect(() => {
    let pointerId: number | null = null;
    let startY = 0;
    let startScrollTop = 0;
    let isDragging = false;

    const scroller = () => document.scrollingElement || document.documentElement;
    const isInteractive = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return Boolean(target.closest("button, a, input, textarea, select, label, summary, [role='button']"));
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || isInteractive(event.target)) return;
      const element = scroller();
      if (element.scrollHeight <= window.innerHeight) return;
      pointerId = event.pointerId;
      startY = event.clientY;
      startScrollTop = element.scrollTop;
      isDragging = false;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      const deltaY = event.clientY - startY;
      if (Math.abs(deltaY) < 6 && !isDragging) return;
      isDragging = true;
      document.body.classList.add("drag-scrolling");
      scroller().scrollTop = startScrollTop - deltaY;
      event.preventDefault();
    };

    const endDrag = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      isDragging = false;
      document.body.classList.remove("drag-scrolling");
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
      document.body.classList.remove("drag-scrolling");
    };
  }, []);

  useEffect(() => {
    if (!startupVisible || !booted) return;
    const timer = window.setTimeout(() => {
      const nextAction = startupChecks.find((check) => check.status === "action");
      setActiveTab(nextAction?.actionTab || "trade");
      setStartupVisible(false);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [booted, startupChecks, startupVisible]);

  return (
    <main className="wizard-shell">
      <TopBar
        address={session?.address}
        unlocked={isUnlocked}
        busy={busy}
        connectWallet={connectWallet}
        lock={() => clearSession(setSession)}
        sync={() => run("sync", refreshAll)}
      />

      {(error || notice) && <Toast tone={error ? "bad" : "good"}>{error || notice}</Toast>}

      {startupVisible ? (
        <StartupScreen
          checks={startupChecks}
          busy={busy}
          onJump={(tab) => {
            setActiveTab(tab);
            setStartupVisible(false);
          }}
          onContinue={() => setStartupVisible(false)}
        />
      ) : (
        <>
          <AppTabs
            active={activeTab}
            setActive={setActiveTab}
            positions={positions.length}
            tradeReady={!buyBlock}
          />

          {activeTab === "trade" && (
            <TradeScreen
              keyword={keyword}
              setKeyword={setKeyword}
              searchMarkets={searchMarkets}
              busy={busy}
              markets={markets}
              selected={selected}
              marketLive={marketLive}
              marketSearchOpen={marketSearchOpen}
              setMarketSearchOpen={setMarketSearchOpen}
              selectMarket={selectMarket}
              marketDataOpen={marketDataOpen}
              setMarketDataOpen={setMarketDataOpen}
              side={side}
              setSide={setSide}
              amount={amount}
              setAmount={(value) => setAmount(clampTradeAmount(value, risk))}
              risk={risk}
              selectedPrice={selectedPrice}
              tradeCollateralNeeded={tradeCollateralNeeded}
              wallet={wallet}
              buy={buy}
              buyBlock={buyBlock}
            />
          )}

          {activeTab === "positions" && (
            <PositionsScreen
              positions={positions}
              journal={journal}
              wallet={wallet}
              unlocked={isUnlocked}
              exposure={exposure}
              pnl={pnl}
              sell={sell}
              polling={polling}
              setPolling={setPolling}
              tradeFunded={tradeFunded}
            />
          )}

          {activeTab === "settings" && (
            <SettingsScreen
              booted={booted}
              env={env}
              wallet={wallet}
              unlocked={isUnlocked}
              walletArmed={walletArmed}
              tradeFunded={tradeFunded}
              marketReady={marketReady}
              amount={amount}
              setAmount={(value) => setAmount(clampTradeAmount(value, risk))}
              side={side}
              setSide={setSide}
              risk={risk}
              tradeCollateralNeeded={tradeCollateralNeeded}
              depositTopUp={depositTopUp}
              depositAmount={depositAmount}
              botCollateral={botCollateral}
              busy={busy}
              setupWallet={setupWallet}
              deposit={deposit}
              withdraw={withdraw}
              withdrawAmount={withdrawAmount}
              setWithdrawAmount={setWithdrawAmount}
              connectWallet={connectWallet}
            />
          )}
        </>
      )}
    </main>
  );
}

function StartupScreen({ checks, busy, onJump, onContinue }: {
  checks: StartupCheck[];
  busy: string | null;
  onJump: (tab: AppTab) => void;
  onContinue: () => void;
}) {
  const action = checks.find((check) => check.status === "action");
  const allDone = checks.every((check) => check.status === "done");

  return (
    <section className="startup-screen">
      <div className="startup-copy">
        <span>Starting wizard</span>
        <h1>Checking the path to a live trade</h1>
        <p>The app is syncing config, wallet readiness, funding, and market data before opening the trading screen.</p>
      </div>

      <div className="startup-card">
        <div className="startup-list">
          {checks.map((check) => (
            <button
              key={check.key}
              className={`startup-row ${check.status}`}
              onClick={() => check.status === "action" && onJump(check.actionTab)}
              disabled={check.status !== "action"}
            >
              <span className="status-dot" aria-hidden="true">
                {check.status === "done" && <CheckCircle2 size={16} />}
                {check.status === "action" && <XCircle size={16} />}
                {check.status === "checking" && <RefreshCcw size={15} />}
              </span>
              <span>
                <strong>{check.label}</strong>
                <small>{check.value}</small>
              </span>
              {check.status === "action" && <ArrowRight size={16} />}
            </button>
          ))}
        </div>
        <button className="solid-button wide" onClick={() => onJump(action?.actionTab || "trade")}>
          {allDone ? "Open trading" : action ? `Fix ${action.label}` : busy ? busyLabel(busy) : "Continue"}<ArrowRight size={16} />
        </button>
        <button className="ghost-button wide" onClick={onContinue}>Skip checks</button>
      </div>
    </section>
  );
}

function AppTabs({ active, setActive, positions, tradeReady }: {
  active: AppTab;
  setActive: (tab: AppTab) => void;
  positions: number;
  tradeReady: boolean;
}) {
  return (
    <nav className="app-tabs" aria-label="Primary">
      <button className={active === "trade" ? "active" : ""} onClick={() => setActive("trade")}>
        <TrendingUp size={16} />
        <span>Trade</span>
        <small>{tradeReady ? "Ready" : "Review"}</small>
      </button>
      <button className={active === "positions" ? "active" : ""} onClick={() => setActive("positions")}>
        <Wallet size={16} />
        <span>Positions</span>
        <small>{positions}</small>
      </button>
      <button className={active === "settings" ? "active" : ""} onClick={() => setActive("settings")}>
        <ShieldCheck size={16} />
        <span>Settings</span>
        <small>Wallet</small>
      </button>
    </nav>
  );
}

function TradeScreen(props: {
  keyword: string;
  setKeyword: (value: string) => void;
  searchMarkets: () => void;
  busy: string | null;
  markets: Market[];
  selected: Market | null;
  marketLive: MarketLive | null;
  marketSearchOpen: boolean;
  setMarketSearchOpen: (open: boolean) => void;
  selectMarket: (market: Market) => void;
  marketDataOpen: boolean;
  setMarketDataOpen: (open: boolean) => void;
  side: "YES" | "NO";
  setSide: (side: "YES" | "NO") => void;
  amount: number;
  setAmount: (amount: number) => void;
  risk: RiskLimits;
  selectedPrice?: number;
  tradeCollateralNeeded: number;
  wallet: WalletStatus | null;
  buy: () => void;
  buyBlock: string;
}) {
  return (
    <section className="app-screen trade-screen">
      <MarketDesk
        keyword={props.keyword}
        setKeyword={props.setKeyword}
        searchMarkets={props.searchMarkets}
        busy={props.busy}
        markets={props.markets}
        selected={props.selected}
        marketLive={props.marketLive}
        open={props.marketSearchOpen}
        setOpen={props.setMarketSearchOpen}
        selectMarket={props.selectMarket}
      />

      <MarketData
        open={props.marketDataOpen}
        setOpen={props.setMarketDataOpen}
        marketLive={props.marketLive}
        side={props.side}
      />

      <OrderTicket
        selected={props.selected}
        marketLive={props.marketLive}
        side={props.side}
        setSide={props.setSide}
        amount={props.amount}
        setAmount={props.setAmount}
        risk={props.risk}
        selectedPrice={props.selectedPrice}
        tradeCollateralNeeded={props.tradeCollateralNeeded}
        wallet={props.wallet}
        buy={props.buy}
        buyBlock={props.buyBlock}
        busy={props.busy}
      />
    </section>
  );
}

function PositionsScreen(props: {
  positions: Position[];
  journal: JournalEntry[];
  wallet: WalletStatus | null;
  unlocked: boolean;
  exposure: number;
  pnl: number;
  sell: (position: Position) => void;
  polling: boolean;
  setPolling: (enabled: boolean) => void;
  tradeFunded: boolean;
}) {
  return (
    <section className="app-screen positions-screen">
      <PositionsPanel {...props} />
      <ActivityPanel journal={props.journal} unlocked={props.unlocked} />
    </section>
  );
}

function SettingsScreen(props: {
  booted: boolean;
  env: EnvCheck | null;
  wallet: WalletStatus | null;
  unlocked: boolean;
  walletArmed: boolean;
  tradeFunded: boolean;
  marketReady: boolean;
  amount: number;
  setAmount: (amount: number) => void;
  side: "YES" | "NO";
  setSide: (side: "YES" | "NO") => void;
  risk: RiskLimits;
  tradeCollateralNeeded: number;
  depositTopUp: number;
  depositAmount: number;
  botCollateral: number;
  busy: string | null;
  setupWallet: () => void;
  deposit: () => void;
  withdraw: () => void;
  withdrawAmount: number;
  setWithdrawAmount: (value: number) => void;
  connectWallet: () => void;
}) {
  return (
    <section className="app-screen settings-screen">
      <AccountRail
        booted={props.booted}
        env={props.env}
        wallet={props.wallet}
        unlocked={props.unlocked}
        walletArmed={props.walletArmed}
        tradeFunded={props.tradeFunded}
        marketReady={props.marketReady}
        amount={props.amount}
        tradeCollateralNeeded={props.tradeCollateralNeeded}
        depositTopUp={props.depositTopUp}
        depositAmount={props.depositAmount}
        botCollateral={props.botCollateral}
        busy={props.busy}
        setupWallet={props.setupWallet}
        deposit={props.deposit}
        withdraw={props.withdraw}
        withdrawAmount={props.withdrawAmount}
        setWithdrawAmount={props.setWithdrawAmount}
      />

      <section className="settings-panel">
        <PanelHeader icon={<ShieldCheck size={16} />} title="Trading defaults" value={props.side} />
        <div className="settings-stack">
          {!props.unlocked && (
            <button className="solid-button wide" onClick={props.connectWallet} disabled={Boolean(props.busy)}>
              <KeyRound size={15} />Unlock wallet
            </button>
          )}

          <div className="setting-card">
            <span>Default outcome</span>
            <div className="mini-segment">
              <button className={props.side === "YES" ? "active yes" : "yes"} onClick={() => props.setSide("YES")}>YES</button>
              <button className={props.side === "NO" ? "active no" : "no"} onClick={() => props.setSide("NO")}>NO</button>
            </div>
          </div>

          <div className="setting-card">
            <span>Default trade size</span>
            <div className="amount-tools compact">
              <button onClick={() => props.setAmount(props.amount - 0.1)}><Minus size={14} /></button>
              <input type="range" min={props.risk.minTradeUsd} max={props.risk.maxTradeUsd} step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} />
              <button onClick={() => props.setAmount(props.amount + 0.1)}><Plus size={14} /></button>
            </div>
            <strong>{money(props.amount)}</strong>
          </div>

          <details className="settings-details" open={!props.env?.ok}>
            <summary><span>Environment</span><ChevronDown size={15} /></summary>
            <div className="detail-lines">
              <KeyValue label="Mode" value={props.env?.mode || "--"} />
              <KeyValue label="RPC" value={props.env?.rpcConfigured ? "Configured" : "Missing"} tone={props.env?.rpcConfigured ? "good" : "bad"} />
              <KeyValue label="Auth" value={props.env?.authRequired ? "Required" : "Open"} />
              <KeyValue label="Missing" value={props.env?.missing?.length ? props.env.missing.join(", ") : "None"} tone={props.env?.missing?.length ? "bad" : "good"} />
            </div>
          </details>

          <details className="settings-details" open>
            <summary><span>Guardrails</span><ChevronDown size={15} /></summary>
            <div className="guardrail-grid">
              <KeyValue label="Min trade" value={money(props.risk.minTradeUsd)} />
              <KeyValue label="Max trade" value={money(props.risk.maxTradeUsd)} />
              <KeyValue label="Max funding" value={money(props.risk.maxFundingUsd)} />
              <KeyValue label="Max spread" value={`${props.risk.maxSpreadCents}c`} />
              <KeyValue label="Min liquidity" value={money(props.risk.minLiquidityUsd)} />
              <KeyValue label="Min resolution" value={`${props.risk.minHoursToResolution}h`} />
            </div>
          </details>
        </div>
      </section>
    </section>
  );
}

function TopBar({ address, unlocked, busy, connectWallet, lock, sync }: {
  address?: string;
  unlocked: boolean;
  busy: string | null;
  connectWallet: () => void;
  lock: () => void;
  sync: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-icon"><Bot size={18} /></div>
        <div>
          <strong>Polymarket Wizard</strong>
          <span>{unlocked ? short(address || "") : "Locked"}</span>
        </div>
      </div>
      <div className="topbar-actions">
        <button className="icon-button" onClick={sync} disabled={Boolean(busy)}><RefreshCcw size={15} />Sync</button>
        {unlocked ? (
          <button className="icon-button" onClick={lock}><LogOut size={15} />Lock</button>
        ) : (
          <button className="solid-button" onClick={connectWallet}><KeyRound size={15} />Unlock</button>
        )}
      </div>
    </header>
  );
}

function AccountRail(props: {
  booted: boolean;
  env: EnvCheck | null;
  wallet: WalletStatus | null;
  unlocked: boolean;
  walletArmed: boolean;
  tradeFunded: boolean;
  marketReady: boolean;
  amount: number;
  tradeCollateralNeeded: number;
  depositTopUp: number;
  depositAmount: number;
  botCollateral: number;
  busy: string | null;
  setupWallet: () => void;
  deposit: () => void;
  withdraw: () => void;
  withdrawAmount: number;
  setWithdrawAmount: (value: number) => void;
}) {
  const canTopUp = props.unlocked && props.walletArmed && !props.tradeFunded && props.depositAmount > 0 && props.botCollateral >= props.depositAmount;
  const canWithdraw = props.unlocked && props.walletArmed && (props.wallet?.pusdBalance || 0) > 0 && props.withdrawAmount > 0 && !props.busy;

  return (
    <aside className="account-rail">
      <PanelHeader icon={<ShieldCheck size={16} />} title="Account" value={props.unlocked ? "Unlocked" : "Locked"} />
      <div className="readiness-list">
        <ReadyRow label="System" ready={props.booted && Boolean(props.env?.ok)} value={props.env?.ok ? "Ready" : "Check"} />
        <ReadyRow label="Session" ready={props.unlocked} value={props.unlocked ? "Signed" : "Locked"} />
        <ReadyRow label="Wallet" ready={props.unlocked && props.walletArmed} value={props.walletArmed ? "Armed" : "Setup"} />
        <ReadyRow label="Funds" ready={props.unlocked && props.tradeFunded} value={props.unlocked ? money(props.wallet?.pusdBalance || 0) : "--"} />
        <ReadyRow label="Market" ready={props.marketReady} value={props.marketReady ? "Live" : "Select"} />
      </div>

      <section className="funding-block">
        <div className="funding-head">
          <span>Trading wallet</span>
          <strong>{props.tradeFunded ? "Ready" : "Needs funds"}</strong>
        </div>
        <div className="funding-bars">
          <KeyValue label="Available" value={props.unlocked ? money(props.wallet?.pusdBalance || 0) : "Unlock first"} />
          {props.unlocked && <KeyValue label="Required" value={money(props.tradeCollateralNeeded)} />}
          {props.unlocked && props.walletArmed && !props.tradeFunded && <KeyValue label="Suggested top-up" value={money(props.depositAmount)} />}
        </div>
        {!props.walletArmed && (
          <button className="solid-button wide" onClick={props.setupWallet} disabled={!props.unlocked || Boolean(props.busy)}>
            <LockKeyhole size={15} />Arm wallet
          </button>
        )}
        {props.walletArmed && !props.tradeFunded && (
          <button className="solid-button wide" onClick={props.deposit} disabled={!canTopUp || Boolean(props.busy)}>
            <ArrowDownToLine size={15} />Top up pUSD
          </button>
        )}
      </section>

      <details className="rail-details">
        <summary><span>Balances</span><ChevronDown size={15} /></summary>
        <div className="detail-lines">
          <KeyValue label="Bot" value={short(props.wallet?.botAddress || "")} />
          <KeyValue label="POL quote" value={money(props.wallet?.polUsdcEstimate || 0)} />
          <KeyValue label="USDC.e" value={money(props.wallet?.usdcBalance || 0)} />
          <KeyValue label="pUSD" value={money(props.wallet?.pusdBalance || 0)} />
        </div>
      </details>

      <details className="rail-details">
        <summary><span>Withdraw</span><ChevronDown size={15} /></summary>
        <div className="withdraw-line">
          <label>
            <span>Amount</span>
            <input type="number" min="0.01" step="0.01" value={props.withdrawAmount} onChange={(event) => props.setWithdrawAmount(Number(event.target.value))} />
          </label>
          <button className="icon-button" onClick={props.withdraw} disabled={!canWithdraw}>
            <Wallet size={15} />Send
          </button>
        </div>
      </details>
    </aside>
  );
}

function MarketDesk(props: {
  keyword: string;
  setKeyword: (value: string) => void;
  searchMarkets: () => void;
  busy: string | null;
  markets: Market[];
  selected: Market | null;
  marketLive: MarketLive | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  selectMarket: (market: Market) => void;
}) {
  return (
    <section className="market-desk">
      <div className="desk-head">
        <div>
          <span>Market</span>
          <strong>{props.selected?.question || "Select a market"}</strong>
        </div>
        <button className="icon-button" onClick={() => props.setOpen(!props.open)}>
          <Search size={15} />{props.open ? "Hide" : "Search"}
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

      {props.open && (
        <div className="market-search-panel">
          <div className="search-row">
            <Search size={17} />
            <input
              value={props.keyword}
              onChange={(event) => props.setKeyword(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && props.searchMarkets()}
              placeholder="Search markets"
            />
            <button className="solid-button" onClick={props.searchMarkets} disabled={props.busy === "scan"}>Search</button>
          </div>
          <div className="market-list">
            {props.markets.length === 0 && <Empty text="No markets" />}
            {props.markets.map((market) => (
              <button key={market.id} className={props.selected?.id === market.id ? "market-row selected" : "market-row"} onClick={() => props.selectMarket(market)} disabled={Boolean(market.disabledReason)}>
                <MarketThumb market={market} />
                <span>
                  <strong>{market.question}</strong>
                  <small>{market.eventTitle || market.slug || market.disabledReason || "Market"}</small>
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

function OrderTicket(props: {
  selected: Market | null;
  marketLive: MarketLive | null;
  side: "YES" | "NO";
  setSide: (side: "YES" | "NO") => void;
  amount: number;
  setAmount: (amount: number) => void;
  risk: RiskLimits;
  selectedPrice?: number;
  tradeCollateralNeeded: number;
  wallet: WalletStatus | null;
  buy: () => void;
  buyBlock: string;
  busy: string | null;
}) {
  const shares = props.selectedPrice ? props.amount / props.selectedPrice : 0;
  const remainingPusd = (props.wallet?.pusdBalance || 0) - props.tradeCollateralNeeded;
  const remainingLabel = remainingPusd >= 0 ? money(remainingPusd) : `Short ${money(Math.abs(remainingPusd))}`;
  const adjustAmount = (delta: number) => props.setAmount(props.amount + delta);

  return (
    <section className="order-ticket">
      <PanelHeader icon={<ShieldCheck size={16} />} title="Order" value={props.buyBlock || "Ready"} />
      <div className="ticket-layout">
        <div className="ticket-controls">
          <div className="outcome-picker">
            <button className={props.side === "YES" ? "yes active" : "yes"} onClick={() => props.setSide("YES")}>
              <span>YES</span><b>{cents(props.marketLive?.yesPrice)}</b>
            </button>
            <button className={props.side === "NO" ? "no active" : "no"} onClick={() => props.setSide("NO")}>
              <span>NO</span><b>{cents(props.marketLive?.noPrice)}</b>
            </button>
          </div>

          <div className="amount-box">
            <label>
              <span>Amount</span>
              <div className="amount-input">
                <b>$</b>
                <input type="number" min={props.risk.minTradeUsd} max={props.risk.maxTradeUsd} step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} />
              </div>
            </label>
            <div className="amount-tools">
              <button onClick={() => adjustAmount(-0.1)}><Minus size={14} /></button>
              <input type="range" min={props.risk.minTradeUsd} max={props.risk.maxTradeUsd} step="0.01" value={props.amount} onChange={(event) => props.setAmount(Number(event.target.value))} />
              <button onClick={() => adjustAmount(0.1)}><Plus size={14} /></button>
            </div>
            <div className="preset-row">
              <button onClick={() => props.setAmount(props.risk.minTradeUsd)}>Min {money(props.risk.minTradeUsd)}</button>
              <button onClick={() => props.setAmount(props.risk.maxTradeUsd)}>Max {money(props.risk.maxTradeUsd)}</button>
            </div>
          </div>
        </div>

        <div className="ticket-summary">
          <KeyValue label="Outcome" value={`Buy ${props.side}`} tone={props.side === "YES" ? "good" : "bad"} />
          <KeyValue label="Limit" value={cents(props.selectedPrice)} />
          <KeyValue label="Shares" value={shares ? shares.toFixed(2) : "--"} />
          <KeyValue label="Max collateral" value={money(props.tradeCollateralNeeded)} />
          <KeyValue label="pUSD after" value={remainingLabel} tone={remainingPusd >= 0 ? "good" : "bad"} />
          <button className="solid-button wide trade-submit" onClick={props.buy} disabled={Boolean(props.buyBlock || props.busy)}>
            {props.busy ? busyLabel(props.busy) : props.buyBlock || `Buy ${props.side} ${money(props.amount)}`}<ArrowRight size={16} />
          </button>
        </div>
      </div>

      <details className="inline-details">
        <summary><span>Guardrails</span><ChevronDown size={15} /></summary>
        <div className="guardrail-grid">
          <KeyValue label="Max trade" value={money(props.risk.maxTradeUsd)} />
          <KeyValue label="Max spread" value={`${props.risk.maxSpreadCents}c`} />
          <KeyValue label="Min liquidity" value={money(props.risk.minLiquidityUsd)} />
          <KeyValue label="Min resolution" value={`${props.risk.minHoursToResolution}h`} />
        </div>
      </details>
    </section>
  );
}

function PositionsPanel(props: {
  positions: Position[];
  unlocked: boolean;
  exposure: number;
  pnl: number;
  wallet: WalletStatus | null;
  sell: (position: Position) => void;
  polling: boolean;
  setPolling: (enabled: boolean) => void;
  tradeFunded: boolean;
}) {
  return (
    <section className="desk-panel">
      <PanelHeader icon={<Wallet size={16} />} title="Positions" value={props.unlocked ? `${props.positions.length}` : "Locked"} />
      <div className="mini-metrics">
        <KeyValue label="Exposure" value={props.unlocked ? money(props.exposure) : "--"} />
        <KeyValue label="P&L" value={props.unlocked ? signedMoney(props.pnl) : "--"} tone={props.pnl >= 0 ? "good" : "bad"} />
        <KeyValue label="pUSD" value={props.unlocked ? money(props.wallet?.pusdBalance || 0) : "--"} />
      </div>
      <div className="position-list">
        {!props.unlocked && <Empty text="Locked" />}
        {props.unlocked && props.positions.length === 0 && <Empty text="No open positions" />}
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
              <KeyValue label="Stop loss" value={`${position.stopLossPercent}%`} />
              <KeyValue label="Take profit" value={`${position.takeProfitPercent}%`} />
              <KeyValue label="Token" value={short(position.tokenId)} />
            </div>
            <button className="icon-button wide" onClick={() => props.sell(position)}>Sell at live bid</button>
          </details>
        ))}
      </div>
      <label className="toggle-row">
        <input type="checkbox" checked={exitAutomationEnabled && props.polling} disabled={!exitAutomationEnabled || !props.unlocked || !props.tradeFunded || props.positions.length === 0} onChange={(event) => props.setPolling(event.target.checked)} />
        <span>{exitAutomationEnabled ? "Auto exits" : "Auto exits unavailable"}</span>
      </label>
    </section>
  );
}

function ActivityPanel({ journal, unlocked }: { journal: JournalEntry[]; unlocked: boolean }) {
  return (
    <section className="desk-panel">
      <PanelHeader icon={<Flame size={16} />} title="Activity" value={unlocked ? String(journal.length) : "Locked"} />
      <div className="activity-list">
        {!unlocked && <Empty text="Locked" />}
        {unlocked && journal.length === 0 && <Empty text="No activity" />}
        {journal.slice(0, 12).map((entry) => (
          <article className="activity-row" key={entry.id}>
            <time>{new Date(entry.at).toLocaleTimeString()}</time>
            <strong>{entry.type}</strong>
            <span>{entry.message}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function MarketData({ open, setOpen, marketLive, side }: {
  open: boolean;
  setOpen: (open: boolean) => void;
  marketLive: MarketLive | null;
  side: "YES" | "NO";
}) {
  return (
    <section className="market-data">
      <button className="drawer-toggle" onClick={() => setOpen(!open)}>
        <span>Market data</span>
        <ChevronDown className={open ? "open" : ""} size={16} />
      </button>
      {open && (
        <div className="data-grid">
          <LiveChart history={marketLive?.history || []} yes={marketLive?.yesPrice} no={marketLive?.noPrice} />
          <DepthBook side={side} levels={marketLive?.orderBook} />
          <TradeTape rows={marketLive?.trades || []} />
        </div>
      )}
    </section>
  );
}

function PanelHeader({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return <div className="panel-header">{icon}<span>{title}</span><strong>{value}</strong></div>;
}

function ReadyRow({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return <div className={ready ? "ready-row ready" : "ready-row"}><span>{label}</span><strong>{value}</strong></div>;
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

function Toast({ tone, children }: { tone: "good" | "bad"; children: ReactNode }) {
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

function LiveChart({ history, yes, no }: { history: { t: number; p: number }[]; yes?: number; no?: number }) {
  const points = history.slice(-80).map((point) => point.p);
  const fallback = points.length < 2;
  const values = fallback ? [yes || 0.5, yes || 0.5] : points;
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
      <div className="chart-tabs"><span>YES {cents(yes)}</span><span>NO {cents(no)}</span></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="live CLOB price history">
        <path d={`${d} L 100 100 L 0 100 Z`} className="chart-fill" />
        <path d={d} className="chart-line" />
      </svg>
      {fallback && <small>No recent history</small>}
    </div>
  );
}

function DepthBook({ side, levels }: { side: "YES" | "NO"; levels?: MarketLive["orderBook"] }) {
  const bids = levels?.bids || [];
  const asks = levels?.asks || [];
  return (
    <div className="book-card">
      <PanelHeader icon={<TrendingUp size={16} />} title="Order book" value={side} />
      <BookSide label="Asks" rows={asks} tone="bad" />
      <BookSide label="Bids" rows={bids} tone="good" />
      {!bids.length && !asks.length && <Empty text="No book" />}
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
      <PanelHeader icon={<Flame size={16} />} title="Tape" value={String(rows.length)} />
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

function buyBlockReason(input: {
  booted: boolean;
  env: EnvCheck | null;
  isUnlocked: boolean;
  wallet: WalletStatus | null;
  walletArmed: boolean;
  tradeFunded: boolean;
  selected: Market | null;
  marketLive: MarketLive | null;
  selectedPrice?: number;
}) {
  if (!input.booted) return "Syncing";
  if (!input.isUnlocked) return "Locked";
  if (!input.env?.ok) return "Config";
  if (!input.walletArmed) return "Arm wallet";
  if (!input.wallet?.readyToTrade || !input.tradeFunded) return "Fund pUSD";
  if (!input.selected) return "Select market";
  if (!input.marketLive?.ok) return input.marketLive?.reason || "No quote";
  if (!input.selectedPrice) return "No price";
  return "";
}

function saveSession(session: AuthSession) {
  localStorage.setItem("wizardSessionToken", session.token);
  localStorage.setItem("wizardSession", JSON.stringify(session));
}

function loadSession(): AuthSession | null {
  try {
    const session = JSON.parse(localStorage.getItem("wizardSession") || "null") as AuthSession | null;
    if (!session?.token || session.expiresAt < Date.now()) {
      localStorage.removeItem("wizardSession");
      localStorage.removeItem("wizardSessionToken");
      return null;
    }
    localStorage.setItem("wizardSessionToken", session.token);
    return session;
  } catch {
    return null;
  }
}

function clearSession(setSession: (session: AuthSession | null) => void) {
  localStorage.removeItem("wizardSession");
  localStorage.removeItem("wizardSessionToken");
  setSession(null);
}

function busyLabel(value: string) {
  return `${value[0]?.toUpperCase() || ""}${value.slice(1)}...`;
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

function formatDate(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function short(value: string) {
  if (!value || value === "unknown") return value || "--";
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function isAppTab(value: string): value is AppTab {
  return value === "trade" || value === "positions" || value === "settings";
}

function clampTradeAmount(value: number, risk: Pick<RiskLimits, "minTradeUsd" | "maxTradeUsd">) {
  if (!Number.isFinite(value)) return risk.minTradeUsd;
  return Math.min(risk.maxTradeUsd, Math.max(risk.minTradeUsd, Math.round(value * 100) / 100));
}
