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

declare global {
  interface Window {
    ethereum?: {
      request: <T = unknown>(args: { method: string; params?: unknown[] }) => Promise<T>;
    };
  }
}

const pollMs = Number(import.meta.env.VITE_POLL_INTERVAL_MS || 60000);

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession());
  const [env, setEnv] = useState<EnvCheck | null>(null);
  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [keyword, setKeyword] = useState(loadSetting("keyword", "bitcoin"));
  const storedSelected = useMemo(() => loadSetting<Market | null>("selectedMarket", null), []);
  const [markets, setMarkets] = useState<Market[]>(storedSelected ? [storedSelected] : []);
  const [selected, setSelected] = useState<Market | null>(storedSelected);
  const [marketLive, setMarketLive] = useState<MarketLive | null>(null);
  const [side, setSide] = useState<"YES" | "NO">(loadSetting("side", "YES"));
  const [amount, setAmount] = useState(Math.max(1.1, loadSetting("amount", 1.1)));
  const [stopLoss, setStopLoss] = useState(loadSetting("stopLoss", 20));
  const [takeProfit, setTakeProfit] = useState(loadSetting("takeProfit", 35));
  const [polling, setPolling] = useState(loadSetting("polling", false));
  const [positions, setPositions] = useState<Position[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isUnlocked = Boolean(session?.token && session.expiresAt > Date.now() && env?.authenticated);
  const selectedPrice = side === "YES" ? marketLive?.yesPrice : marketLive?.noPrice;
  const botCollateral = (wallet?.botPusdBalance || 0) + (wallet?.usdcBalance || 0) + (wallet?.polUsdcEstimate || 0);
  const walletArmed = Boolean(wallet?.depositWalletExists && wallet?.approvalsReady);
  const tradeCollateralNeeded = Math.max(1.05, amount * 1.04);
  const depositTopUp = Math.max(0, tradeCollateralNeeded - (wallet?.pusdBalance || 0));
  const depositAmount = Math.max(1, Math.ceil(depositTopUp * 100) / 100);
  const tradeFunded = Boolean(wallet?.readyToTrade && (wallet?.pusdBalance || 0) >= tradeCollateralNeeded);
  const exposure = useMemo(() => positions.reduce((sum, position) => sum + position.value, 0), [positions]);
  const pnl = useMemo(() => positions.reduce((sum, position) => sum + position.pnl, 0), [positions]);

  const stage = useMemo(() => {
    if (!isUnlocked) return "unlock";
    if (!env?.ok) return "system";
    if (!walletArmed) return "arm";
    if (!tradeFunded) return "fund";
    if (!selected || !marketLive?.ok) return "market";
    return "trade";
  }, [env?.ok, isUnlocked, marketLive?.ok, selected, tradeFunded, walletArmed]);

  const stepItems = [
    { key: "unlock", label: "Unlock", done: isUnlocked },
    { key: "arm", label: "Arm", done: walletArmed },
    { key: "fund", label: "Fund", done: tradeFunded },
    { key: "market", label: "Market", done: Boolean(selected && marketLive?.ok) },
    { key: "trade", label: "Trade", done: stage === "trade" },
  ];

  const hero = heroCopy(stage, wallet, selected, selectedPrice);

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
    if (!session?.token) return;
    await Promise.all([refreshWallet(), refreshPositions(), refreshJournal()]);
  }, [refreshJournal, refreshPositions, refreshWallet, session?.token]);

  const refreshAll = useCallback(async () => {
    const nextEnv = await refreshEnv();
    if (session?.token && nextEnv.authenticated) await refreshProtected();
  }, [refreshEnv, refreshProtected, session?.token]);

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
      const firstTradeable = data.markets.find((market) => !market.disabledReason);
      if ((!selected || selected.disabledReason) && firstTradeable) await selectMarket(firstTradeable);
      setNotice(`${data.markets.length} market${data.markets.length === 1 ? "" : "s"} found`);
    });
  };

  const selectMarket = async (market: Market) => {
    if (market.disabledReason) return;
    setSelected(market);
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
    setNotice("Wizard wallet unlocked.");
    await refreshAll();
  });

  const setupWallet = () => run("wallet", async () => {
    const data = await callApi<{ ok: boolean; message: string }>("setup-wallet", {});
    setNotice(data.message);
    await refreshProtected();
  });

  const deposit = () => run("deposit", async () => {
    const data = await callApi<{ message: string; status?: WalletStatus }>("deposit", { amountUsd: depositAmount });
    setNotice(data.message);
    if (data.status) setWallet(data.status);
    await refreshProtected();
  });

  const withdraw = () => run("withdraw", async () => {
    const data = await callApi<{ message: string; status?: WalletStatus }>("withdraw", { amountUsd: amount });
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
      stopLossPercent: stopLoss,
      takeProfitPercent: takeProfit,
    });
    setNotice(data.message);
    if (data.status) setWallet(data.status);
    await refreshProtected();
  });

  const sell = (position: Position) => run("sell", async () => {
    const data = await callApi<{ ok: boolean; message: string; status?: WalletStatus }>("sell", {
      positionId: position.id,
      marketId: position.marketId,
      side: position.side,
      tokenId: position.tokenId,
      shares: position.shares,
      limitPrice: position.currentPrice,
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

  const runPrimary = () => {
    if (!isUnlocked) return connectWallet();
    if (!env?.ok) return run("system", refreshEnv);
    if (!walletArmed) return setupWallet();
    if (!tradeFunded && botCollateral >= depositTopUp) return deposit();
    if (!tradeFunded) {
      setNotice("Send POL to the bot wallet, then Sync. The app swaps only what it needs.");
      return run("refresh", refreshProtected);
    }
    if (!selected || !marketLive?.ok) return searchMarkets();
    document.getElementById("trade-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setNotice("Review the order ticket, then press the Buy button when ready.");
  };

  useEffect(() => {
    refreshAll().catch(() => undefined);
  }, [refreshAll]);

  useEffect(() => {
    if (markets.length === 0 && !storedSelected) searchMarkets().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMarketLive(selected, side).catch(() => undefined);
  }, [loadMarketLive, selected, side]);

  useEffect(() => saveSetting("side", side), [side]);
  useEffect(() => saveSetting("amount", amount), [amount]);
  useEffect(() => saveSetting("stopLoss", stopLoss), [stopLoss]);
  useEffect(() => saveSetting("takeProfit", takeProfit), [takeProfit]);
  useEffect(() => saveSetting("polling", polling), [polling]);

  useEffect(() => {
    if (!polling || !isUnlocked || !tradeFunded || positions.length === 0) return;
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

  return (
    <main className="app-shell">
      <header className="app-top">
        <div className="brand-block">
          <div className="brand-mark"><Bot size={19} /></div>
          <div>
            <strong>Polymarket Wizard</strong>
            <span>{isUnlocked ? short(session?.address || "") : "Guarded trading console"}</span>
          </div>
        </div>
        <div className="top-actions">
          <button onClick={() => run("sync", refreshAll)} disabled={Boolean(busy)}><RefreshCcw size={15} />Sync</button>
          {isUnlocked ? (
            <button onClick={() => clearSession(setSession)}><LogOut size={15} />Lock</button>
          ) : (
            <button className="green-button" onClick={connectWallet}><KeyRound size={15} />Unlock</button>
          )}
        </div>
      </header>

      {(error || notice) && (
        <section className={error ? "alert error" : "alert ok"}>
          {error ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{error || notice}</span>
        </section>
      )}

      <section className="hero-card">
        <div>
          <span className="eyebrow">{hero.eyebrow}</span>
          <h1>{hero.title}</h1>
          <p>{hero.body}</p>
        </div>
        <button className="primary-action" onClick={runPrimary} disabled={Boolean(busy)}>
          {busy ? busyLabel(busy) : hero.action}
          <ArrowRight size={18} />
        </button>
      </section>

      <section className="progress-strip">
        {stepItems.map((step, index) => (
          <div className={step.done ? "progress-step done" : step.key === stage ? "progress-step active" : "progress-step"} key={step.key}>
            <b>{index + 1}</b>
            <span>{step.label}</span>
          </div>
        ))}
      </section>

      <section className="guided-layout">
        <aside className="side-card">
          <WalletSummary
            env={env}
            wallet={wallet}
            unlocked={isUnlocked}
            walletArmed={walletArmed}
            tradeFunded={tradeFunded}
          />
          <div className="side-actions">
            <button onClick={setupWallet} disabled={!isUnlocked || walletArmed || Boolean(busy)}><LockKeyhole size={16} />Arm wallet</button>
            <button onClick={deposit} disabled={!isUnlocked || !walletArmed || tradeFunded || Boolean(busy)}><ArrowDownToLine size={16} />Deposit {money(depositAmount)}</button>
            <button onClick={withdraw} disabled={!isUnlocked || !walletArmed || Boolean(busy)}><Wallet size={16} />Withdraw</button>
          </div>
        </aside>

        <section className="task-card" id="trade-workspace">
          {stage === "unlock" && <UnlockPanel connect={connectWallet} />}
          {stage === "system" && <SystemPanel env={env} refresh={() => run("system", refreshEnv)} />}
          {stage === "arm" && <ArmPanel setupWallet={setupWallet} wallet={wallet} />}
          {stage === "fund" && (
            <FundPanel
              wallet={wallet}
              depositAmount={depositAmount}
              deposit={deposit}
              refresh={() => run("sync", refreshAll)}
            />
          )}
          {stage === "market" && (
            <MarketPicker
              keyword={keyword}
              setKeyword={setKeyword}
              searchMarkets={searchMarkets}
              busy={busy}
              markets={markets}
              selected={selected}
              selectMarket={selectMarket}
            />
          )}
          {stage === "trade" && (
            <TradePanel
              selected={selected}
              marketLive={marketLive}
              side={side}
              setSide={setSide}
              amount={amount}
              setAmount={setAmount}
              selectedPrice={selectedPrice}
              tradeCollateralNeeded={tradeCollateralNeeded}
              stopLoss={stopLoss}
              setStopLoss={setStopLoss}
              takeProfit={takeProfit}
              setTakeProfit={setTakeProfit}
              buy={buy}
              busy={busy}
              openMarketPicker={() => {
                setSelected(null);
                setMarketLive(null);
              }}
            />
          )}
        </section>
      </section>

      <section className="below-grid">
        <section className="panel positions-card">
          <PanelTitle icon={<Wallet size={16} />} label="Positions" value={isUnlocked ? `${positions.length} open` : "Locked"} />
          <div className="metric-row">
            <Metric label="Exposure" value={isUnlocked ? money(exposure) : "--"} />
            <Metric label="P&L" value={isUnlocked ? signedMoney(pnl) : "--"} tone={pnl >= 0 ? "good" : "bad"} />
            <Metric label="pUSD" value={isUnlocked ? money(wallet?.pusdBalance || 0) : "--"} />
          </div>
          <div className="position-list">
            {!isUnlocked && <Empty text="Unlock to view positions" />}
            {isUnlocked && positions.length === 0 && <Empty text="No open positions" />}
            {positions.map((position) => (
              <article className="position-row" key={position.id}>
                <div>
                  <strong>{position.question}</strong>
                  <span>{position.side} / {position.shares.toFixed(2)} shares / {cents(position.currentPrice)}</span>
                </div>
                <b className={position.pnl >= 0 ? "good" : "bad"}>{signedMoney(position.pnl)}</b>
                <button onClick={() => sell(position)}>Sell</button>
              </article>
            ))}
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={polling} disabled={!isUnlocked || !tradeFunded || positions.length === 0} onChange={(event) => setPolling(event.target.checked)} />
            <span>Auto-check stop / take-profit every 60s</span>
          </label>
        </section>

        <section className="panel journal-card">
          <PanelTitle icon={<ShieldCheck size={16} />} label="Activity" value={isUnlocked ? String(journal.length) : "Locked"} />
          <div className="journal-list">
            {!isUnlocked && <Empty text="Unlock to view activity" />}
            {isUnlocked && journal.length === 0 && <Empty text="No activity yet" />}
            {journal.slice(0, 8).map((entry) => (
              <div className="journal-row" key={entry.id}>
                <span>{new Date(entry.at).toLocaleTimeString()}</span>
                <strong>{entry.type}</strong>
                <p>{entry.message}</p>
              </div>
            ))}
          </div>
        </section>
      </section>

      {selected && (
        <section className="details-card">
          <button className="details-toggle" onClick={() => setDetailsOpen((value) => !value)}>
            <span>Market details</span>
            <ChevronDown className={detailsOpen ? "open" : ""} size={17} />
          </button>
          {detailsOpen && (
            <div className="details-grid">
              <LiveChart history={marketLive?.history || []} yes={marketLive?.yesPrice} no={marketLive?.noPrice} />
              <DepthBook side={side} levels={marketLive?.orderBook} />
              <TradeTape rows={marketLive?.trades || []} />
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function heroCopy(stage: string, wallet: WalletStatus | null, selected: Market | null, selectedPrice?: number) {
  if (stage === "unlock") return {
    eyebrow: "Step 1",
    title: "Unlock the bot wallet",
    body: "Connect the wallet that owns this Wizard. Viewing is open, but funded actions stay locked until this wallet signs.",
    action: "Unlock wallet",
  };
  if (stage === "system") return {
    eyebrow: "System check",
    title: "Configuration needs attention",
    body: "The app is missing required server-side configuration. Sync after fixing the Netlify environment.",
    action: "Check system",
  };
  if (stage === "arm") return {
    eyebrow: "Step 2",
    title: "Arm the deposit wallet",
    body: "Deploy the Polymarket deposit wallet and set the approvals needed for trading.",
    action: "Arm wallet",
  };
  if (stage === "fund") return {
    eyebrow: "Step 3",
    title: "Fund the trading wallet",
    body: wallet?.reason || "Send POL to the bot wallet, then deposit the needed collateral into the Polymarket wallet.",
    action: "Deposit pUSD",
  };
  if (stage === "market") return {
    eyebrow: "Step 4",
    title: "Choose a tradeable market",
    body: "Search a keyword, pick an open market, then review live prices before placing a trade.",
    action: "Search markets",
  };
  return {
    eyebrow: "Ready",
    title: selected?.question || "Ready to trade",
    body: `${selectedPrice ? `Current ${cents(selectedPrice)} ${selected ? "price" : ""}.` : "Live quote loaded."} Pick YES or NO, size the trade, then place the order.`,
    action: "Review order",
  };
}

function WalletSummary({ env, wallet, unlocked, walletArmed, tradeFunded }: {
  env: EnvCheck | null;
  wallet: WalletStatus | null;
  unlocked: boolean;
  walletArmed: boolean;
  tradeFunded: boolean;
}) {
  return (
    <div className="wallet-summary">
      <PanelTitle icon={<ShieldCheck size={16} />} label="Status" value={unlocked ? "Unlocked" : "Locked"} />
      <div className="status-grid">
        <StatusTile label="Env" value={env?.ok ? "Ready" : "Check"} good={Boolean(env?.ok)} />
        <StatusTile label="Wallet" value={!unlocked ? "Locked" : walletArmed ? "Armed" : "Needs arm"} good={unlocked && walletArmed} />
        <StatusTile label="Funds" value={unlocked ? money(wallet?.pusdBalance || 0) : "--"} good={unlocked && tradeFunded} />
      </div>
      {unlocked && (
        <div className="wallet-lines">
          <span>Bot <b>{short(wallet?.botAddress || "")}</b></span>
          <span>POL quote <b>{money(wallet?.polUsdcEstimate || 0)}</b></span>
          <span>USDC.e <b>{money(wallet?.usdcBalance || 0)}</b></span>
        </div>
      )}
    </div>
  );
}

function UnlockPanel({ connect }: { connect: () => void }) {
  return (
    <div className="simple-panel">
      <KeyRound size={34} />
      <h2>Start with one signature</h2>
      <p>The app will ask your wallet to sign a login message. It does not spend funds.</p>
      <button className="primary-action" onClick={connect}>Unlock wallet <ArrowRight size={18} /></button>
    </div>
  );
}

function SystemPanel({ env, refresh }: { env: EnvCheck | null; refresh: () => void }) {
  return (
    <div className="simple-panel">
      <XCircle size={34} />
      <h2>Missing configuration</h2>
      <p>{env?.missing?.length ? env.missing.join(", ") : "Run a sync after checking Netlify environment variables."}</p>
      <button className="primary-action" onClick={refresh}>Sync again <RefreshCcw size={18} /></button>
    </div>
  );
}

function ArmPanel({ setupWallet, wallet }: { setupWallet: () => void; wallet: WalletStatus | null }) {
  return (
    <div className="simple-panel">
      <LockKeyhole size={34} />
      <h2>Prepare the Polymarket wallet</h2>
      <p>{wallet?.reason || "This deploys the deposit wallet and sets max approvals so future trades do not keep asking for setup."}</p>
      <button className="primary-action" onClick={setupWallet}>Arm wallet <ArrowRight size={18} /></button>
    </div>
  );
}

function FundPanel({ wallet, depositAmount, deposit, refresh }: {
  wallet: WalletStatus | null;
  depositAmount: number;
  deposit: () => void;
  refresh: () => void;
}) {
  return (
    <div className="fund-panel">
      <div>
        <span className="eyebrow">Bot wallet</span>
        <h2>{short(wallet?.botAddress || "No wallet")}</h2>
        <p>Send POL here, sync, then deposit only what the next trade needs.</p>
      </div>
      <div className="metric-row">
        <Metric label="POL quote" value={money(wallet?.polUsdcEstimate || 0)} />
        <Metric label="USDC.e" value={money(wallet?.usdcBalance || 0)} />
        <Metric label="Deposit pUSD" value={money(wallet?.pusdBalance || 0)} />
      </div>
      <div className="button-row">
        <button onClick={refresh}><RefreshCcw size={16} />Sync</button>
        <button className="green-button" onClick={deposit}>Deposit {money(depositAmount)} <ArrowRight size={16} /></button>
      </div>
    </div>
  );
}

function MarketPicker({ keyword, setKeyword, searchMarkets, busy, markets, selected, selectMarket }: {
  keyword: string;
  setKeyword: (value: string) => void;
  searchMarkets: () => void;
  busy: string | null;
  markets: Market[];
  selected: Market | null;
  selectMarket: (market: Market) => void;
}) {
  return (
    <div className="market-picker">
      <div className="search-box">
        <Search size={18} />
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchMarkets()} placeholder="Search bitcoin, Iran, elections..." />
        <button onClick={searchMarkets} disabled={busy === "scan"}>Search</button>
      </div>
      <div className="market-results">
        {markets.length === 0 && <Empty text="Search a market keyword" />}
        {markets.map((market) => (
          <button key={market.id} className={selected?.id === market.id ? "market-card selected" : "market-card"} onClick={() => selectMarket(market)} disabled={Boolean(market.disabledReason)}>
            {market.image && <img src={market.image} alt="" />}
            <div>
              <strong>{market.question}</strong>
              <span>{market.disabledReason || `${money(market.liquidity)} liquidity`}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TradePanel(props: {
  selected: Market | null;
  marketLive: MarketLive | null;
  side: "YES" | "NO";
  setSide: (side: "YES" | "NO") => void;
  amount: number;
  setAmount: (amount: number) => void;
  selectedPrice?: number;
  tradeCollateralNeeded: number;
  stopLoss: number;
  setStopLoss: (value: number) => void;
  takeProfit: number;
  setTakeProfit: (value: number) => void;
  buy: () => void;
  busy: string | null;
  openMarketPicker: () => void;
}) {
  return (
    <div className="trade-flow">
      <div className="selected-market-card">
        {props.selected?.image && <img src={props.selected.image} alt="" />}
        <div>
          <span className="eyebrow">Selected market</span>
          <h2>{props.selected?.question}</h2>
          <p>{money(props.selected?.liquidity || 0)} liquidity / spread {props.marketLive?.spreadCents ?? "--"}c</p>
        </div>
        <button onClick={props.openMarketPicker}>Change</button>
      </div>

      <div className="side-picker">
        <button className={props.side === "YES" ? "yes active" : "yes"} onClick={() => props.setSide("YES")}>YES <span>{cents(props.marketLive?.yesPrice)}</span></button>
        <button className={props.side === "NO" ? "no active" : "no"} onClick={() => props.setSide("NO")}>NO <span>{cents(props.marketLive?.noPrice)}</span></button>
      </div>

      <div className="trade-form">
        <MoneyInput label="Trade amount" value={props.amount} setValue={(value) => props.setAmount(Math.max(1.1, value))} />
        <div className="quick-row">
          {[1.1, 2].map((value) => (
            <button key={value} className={props.amount === value ? "active" : ""} onClick={() => props.setAmount(value)}>{money(value)}</button>
          ))}
        </div>
        <div className="metric-row">
          <Metric label="Limit" value={cents(props.selectedPrice)} />
          <Metric label="Shares" value={props.selectedPrice ? (props.amount / props.selectedPrice).toFixed(2) : "--"} />
          <Metric label="Buffer" value={money(props.tradeCollateralNeeded - props.amount)} />
        </div>
        <div className="risk-row">
          <NumberInput label="Stop loss" suffix="%" value={props.stopLoss} setValue={props.setStopLoss} />
          <NumberInput label="Take profit" suffix="%" value={props.takeProfit} setValue={props.setTakeProfit} />
        </div>
        <button className="primary-action trade-button" onClick={props.buy} disabled={Boolean(props.busy)}>
          {props.busy ? busyLabel(props.busy) : `Buy ${props.side} ${money(props.amount)}`}
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

function PanelTitle({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="panel-title">{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function StatusTile({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return <div className={good ? "status-tile good" : "status-tile"}><span>{label}</span><strong>{value}</strong></div>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return <div className={`metric ${tone || ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function MoneyInput({ label, value, setValue }: { label: string; value: number; setValue: (value: number) => void }) {
  return <label className="money-input"><span>{label}</span><div><b>$</b><input type="number" min="1.1" step="0.01" value={value} onChange={(event) => setValue(Number(event.target.value))} /></div></label>;
}

function NumberInput({ label, value, setValue, suffix = "" }: { label: string; value: number; setValue: (value: number) => void; suffix?: string }) {
  return <label className="number-input"><span>{label}</span><div><input type="number" min="0" step="1" value={value} onChange={(event) => setValue(Number(event.target.value))} />{suffix}</div></label>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
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
      {fallback && <p>No recent price history returned.</p>}
    </div>
  );
}

function DepthBook({ side, levels }: { side: "YES" | "NO"; levels?: MarketLive["orderBook"] }) {
  const bids = levels?.bids || [];
  const asks = levels?.asks || [];
  return (
    <div className="book-card">
      <PanelTitle icon={<TrendingUp size={16} />} label="Order book" value={side} />
      <BookSide label="Asks" rows={asks} tone="bad" />
      <BookSide label="Bids" rows={bids} tone="good" />
      {!bids.length && !asks.length && <Empty text="No order book returned" />}
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
      <PanelTitle icon={<Flame size={16} />} label="Live activity" value={String(rows.length)} />
      {rows.length === 0 && <Empty text="No recent trades" />}
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

function saveSession(session: AuthSession) {
  localStorage.setItem("wizardSessionToken", session.token);
  localStorage.setItem("wizardSession", JSON.stringify(session));
}

function loadSession(): AuthSession | null {
  try {
    const session = JSON.parse(localStorage.getItem("wizardSession") || "null") as AuthSession | null;
    if (!session?.token || session.expiresAt < Date.now()) return null;
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
  return `$${value.toFixed(2)}`;
}

function signedMoney(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function short(value: string) {
  if (!value || value === "unknown") return value || "--";
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}
