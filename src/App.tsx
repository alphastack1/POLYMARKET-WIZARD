import {
  ArrowDownToLine,
  ArrowRight,
  Bot,
  CheckCircle2,
  Flame,
  History,
  KeyRound,
  LockKeyhole,
  LogOut,
  RefreshCcw,
  Search,
  ShieldCheck,
  TrendingUp,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { callApi } from "./api";
import { loadSetting, saveSetting } from "./storage";
import type { EnvCheck, JournalEntry, Market, Position, WalletStatus } from "./types";

type AuthSession = {
  token: string;
  address: string;
  expiresAt: number;
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

  const blockedReason = useMemo(() => {
    if (!isUnlocked) return "UNLOCK";
    if (!env?.ok) return "SYSTEM";
    if (!walletArmed) return "ARM";
    if (!tradeFunded && botCollateral >= depositTopUp) return "DEPOSIT";
    if (!tradeFunded) return "FUND";
    if (!selected) return "MARKET";
    if (!marketLive?.ok) return "BLOCKED";
    if (!selectedPrice) return "PRICE";
    return null;
  }, [botCollateral, depositTopUp, env, isUnlocked, marketLive, selected, selectedPrice, tradeFunded, walletArmed]);

  const steps = useMemo(() => [
    { label: "Unlock", done: isUnlocked, detail: session?.address ? short(session.address) : "Sign once" },
    { label: "Fund", done: tradeFunded, detail: tradeFunded ? money(wallet?.pusdBalance || 0) : walletArmed ? `Need ${money(depositTopUp)}` : "Arm first" },
    { label: "Market", done: Boolean(selected && marketLive?.ok), detail: selected ? cents(selectedPrice) : "Pick one" },
    { label: "Trade", done: Boolean(!blockedReason), detail: blockedReason ? blockedReason.toLowerCase() : "Ready" },
    { label: "Manage", done: positions.length > 0, detail: positions.length ? `${positions.length} open` : "Flat" },
  ], [blockedReason, depositTopUp, isUnlocked, marketLive, positions.length, selected, selectedPrice, session?.address, tradeFunded, wallet?.pusdBalance, walletArmed]);

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
    if (!market) {
      setMarketLive(null);
      return;
    }
    const live = await callApi<MarketLive>("market-live", { marketId: market.id, side: nextSide });
    setMarketLive(live);
  }, [side]);

  const searchMarkets = async () => {
    saveSetting("keyword", keyword);
    await run("scan", async () => {
      const data = await callApi<{ ok: true; markets: Market[] }>(`search-markets?q=${encodeURIComponent(keyword)}`);
      setMarkets(data.markets);
      if (!selected && data.markets[0] && !data.markets[0].disabledReason) {
        await selectMarket(data.markets[0]);
      }
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
      setNotice("Send POL to the bot wallet, then Sync. The app swaps only what it needs at deposit time.");
      return run("refresh", refreshProtected);
    }
    if (!selected) return searchMarkets();
    if (!marketLive?.ok) return run("market", () => loadMarketLive(selected));
    return buy();
  };

  useEffect(() => {
    refreshAll().catch(() => undefined);
  }, [refreshAll]);

  useEffect(() => {
    if (markets.length === 0 && !storedSelected) searchMarkets().catch(() => undefined);
    // Run once on boot so the market explorer is not empty.
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
    <main className="terminal">
      <header className="command-bar">
        <div className="brand-block">
          <div className="brand-mark"><Bot size={18} /></div>
          <div>
            <strong>Polymarket Wizard</strong>
            <span>{isUnlocked ? `Unlocked ${short(session?.address || "")}` : "View-only until the Wizard wallet signs in"}</span>
          </div>
        </div>
        <div className="command-status">
          <StatusPill label="Env" value={env?.ok ? "Ready" : "Locked"} good={Boolean(env?.ok)} />
          <StatusPill label="Wallet" value={!isUnlocked ? "Locked" : tradeFunded ? "Ready" : walletArmed ? "Fund" : "Arm"} good={isUnlocked && tradeFunded} />
          <StatusPill label="pUSD" value={isUnlocked ? money(wallet?.pusdBalance || 0) : "--"} good={isUnlocked && tradeFunded} />
        </div>
        <div className="command-actions">
          {isUnlocked ? (
            <button onClick={() => clearSession(setSession)}><LogOut size={15} />Lock</button>
          ) : (
            <button className="unlock-button" onClick={connectWallet}><KeyRound size={15} />Unlock</button>
          )}
          <button onClick={() => run("sync", refreshAll)} disabled={Boolean(busy)}><RefreshCcw size={15} />Sync</button>
        </div>
      </header>

      {(error || notice) && (
        <section className={error ? "alert error" : "alert ok"}>
          {error ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{error || notice}</span>
        </section>
      )}

      <section className="wizard-rail">
        {steps.map((step, index) => (
          <article className={step.done ? "rail-step done" : "rail-step"} key={step.label}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{step.label}</strong>
            <p>{step.detail}</p>
          </article>
        ))}
      </section>

      <section className="workbench">
        <aside className="panel setup-panel">
          <Title icon={ShieldCheck} k="CONTROL" v={isUnlocked ? "Armed by signature" : "Locked"} />
          <LockedNotice locked={!isUnlocked} connect={connectWallet} />
          <WalletStack wallet={wallet} env={env} unlocked={isUnlocked} />
          <div className="control-grid">
            <button onClick={setupWallet} disabled={!isUnlocked || Boolean(busy)}><LockKeyhole size={16} />Arm</button>
            <button onClick={deposit} disabled={!isUnlocked || !walletArmed || Boolean(busy)}><ArrowDownToLine size={16} />Deposit {money(depositAmount)}</button>
            <button onClick={withdraw} disabled={!isUnlocked || !walletArmed || Boolean(busy)}><Wallet size={16} />Withdraw {money(amount)}</button>
          </div>
        </aside>

        <section className="panel markets-panel">
          <Title icon={Search} k="MARKETS" v={markets.length ? `${markets.length} found` : "Search"} />
          <div className="search-row">
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchMarkets()} aria-label="Search markets" />
            <button onClick={searchMarkets} disabled={busy === "scan"}><Search size={16} /></button>
          </div>
          <div className="market-list">
            {markets.length === 0 && <Empty text="Search a keyword" />}
            {markets.map((market) => (
              <button key={market.id} className={selected?.id === market.id ? "market selected" : "market"} onClick={() => selectMarket(market)} disabled={Boolean(market.disabledReason)}>
                {market.image && <img src={market.image} alt="" />}
                <strong>{market.question}</strong>
                <span>{market.disabledReason || `$${compactNumber(market.liquidity)} liq`}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel live-panel">
          <Title icon={TrendingUp} k="LIVE MARKET" v={marketLive?.ok ? "CLOB data" : "Waiting"} />
          <MarketHeader market={selected} live={marketLive} />
          <LiveChart history={marketLive?.history || []} yes={marketLive?.yesPrice} no={marketLive?.noPrice} />
          <div className="market-data-grid">
            <DepthBook side={side} levels={marketLive?.orderBook} />
            <TradeTape rows={marketLive?.trades || []} />
          </div>
          {marketLive?.liveErrors?.length ? <div className="inline-warning">{marketLive.liveErrors.join(" / ")}</div> : null}
        </section>

        <aside className="panel order-ticket">
          <Title icon={Flame} k="ORDER" v={side} />
          <div className="side-row">
            <button className={side === "YES" ? "yes active" : "yes"} onClick={() => setSide("YES")}>Yes <span>{cents(marketLive?.yesPrice)}</span></button>
            <button className={side === "NO" ? "no active" : "no"} onClick={() => setSide("NO")}>No <span>{cents(marketLive?.noPrice)}</span></button>
          </div>
          <MoneyInput label="Amount" value={amount} setValue={(value) => setAmount(Math.max(1.1, value))} />
          <div className="quick-sizes">
            {[1.1, 2].map((value) => (
              <button key={value} className={amount === value ? "active" : ""} onClick={() => setAmount(value)}>{money(value)}</button>
            ))}
          </div>
          <div className="quote-strip">
            <Read label="Limit" value={cents(selectedPrice)} />
            <Read label="Shares" value={selectedPrice ? (amount / selectedPrice).toFixed(2) : "--"} />
            <Read label="Fee buffer" value={money(tradeCollateralNeeded - amount)} />
          </div>
          <div className="risk-row">
            <NumberBox label="Stop" suffix="%" value={stopLoss} setValue={setStopLoss} />
            <NumberBox label="Take" suffix="%" value={takeProfit} setValue={setTakeProfit} />
          </div>
          <button className="prime action" onClick={runPrimary} disabled={Boolean(busy)}>
            {isUnlocked ? <Flame size={18} /> : <KeyRound size={18} />}
            {busy ? busy.toUpperCase() : primaryLabel(blockedReason, side, amount)}
            <ArrowRight size={18} />
          </button>
          <div className="guardline">{marketLive?.ok ? "Guardrails pass" : marketLive?.reason || "Select a live market"}</div>
        </aside>

        <section className="panel positions-panel">
          <Title icon={Wallet} k="POSITIONS" v={isUnlocked ? `${positions.length} open` : "Locked"} />
          <div className="performance-row">
            <Metric label="Exposure" value={isUnlocked ? money(exposure) : "--"} />
            <Metric label="P&L" value={isUnlocked ? signedMoney(pnl) : "--"} tone={pnl >= 0 ? "good" : "bad"} />
            <Metric label="Bot POL" value={isUnlocked ? `${(wallet?.polBalance || 0).toFixed(2)}` : "--"} />
            <Metric label="USDC.e" value={isUnlocked ? money(wallet?.usdcBalance || 0) : "--"} />
          </div>
          <div className="positions">
            {!isUnlocked && <Empty text="Unlock to view positions" />}
            {isUnlocked && positions.length === 0 && <Empty text="Flat" />}
            {positions.map((position) => (
              <article className="position" key={position.id}>
                <strong>{position.question}</strong>
                <span>{position.side} / {position.shares.toFixed(2)} shares / {cents(position.currentPrice)}</span>
                <b className={position.pnl >= 0 ? "good" : "bad"}>{signedMoney(position.pnl)}</b>
                <button onClick={() => sell(position)}>Sell</button>
              </article>
            ))}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={polling} disabled={!isUnlocked || !tradeFunded || positions.length === 0} onChange={(event) => setPolling(event.target.checked)} />
            <span>Auto-check stop / take-profit every 60s</span>
          </label>
        </section>

        <section className="panel activity-panel">
          <Title icon={History} k="ACTIVITY" v={isUnlocked ? String(journal.length) : "Locked"} />
          <div className="journal">
            {!isUnlocked && <Empty text="Unlock to view trade log" />}
            {isUnlocked && journal.length === 0 && <Empty text="No activity yet" />}
            {journal.map((entry) => (
              <div className="row" key={entry.id}>
                <span>{new Date(entry.at).toLocaleTimeString()}</span>
                <strong>{entry.type}</strong>
                <p>{entry.message}</p>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function Title({ icon: Icon, k, v }: { icon: LucideIcon; k: string; v: string }) {
  return <div className="title"><Icon size={17} /><span>{k}</span><strong>{v}</strong></div>;
}

function LockedNotice({ locked, connect }: { locked: boolean; connect: () => void }) {
  if (!locked) return null;
  return (
    <div className="locked-notice">
      <KeyRound size={18} />
      <div>
        <strong>Connect the Wizard wallet</strong>
        <p>Viewing is open. Trading controls require a signed wallet session.</p>
      </div>
      <button onClick={connect}>Unlock</button>
    </div>
  );
}

function StatusPill({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return <div className={good === undefined ? "status-pill" : good ? "status-pill good-pill" : "status-pill bad-pill"}><span>{label}</span><strong>{value}</strong></div>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return <article className={`metric ${tone || ""}`}><span>{label}</span><strong>{value}</strong></article>;
}

function WalletStack({ wallet, env, unlocked }: { wallet: WalletStatus | null; env: EnvCheck | null; unlocked: boolean }) {
  const rows = unlocked ? [
    ["System", env?.ok ? "Ready" : "Locked", env?.ok],
    ["Bot", short(wallet?.botAddress || env?.botAddress || ""), Boolean(wallet?.botAddress || env?.botAddress)],
    ["Deposit", wallet?.depositWalletExists ? short(wallet.depositWallet || "") : "Not armed", wallet?.depositWalletExists],
    ["Approvals", wallet?.approvalsReady ? "Maxed" : "Missing", wallet?.approvalsReady],
    ["Deposit pUSD", money(wallet?.pusdBalance || 0), wallet?.readyToTrade],
  ] as const : [
    ["System", env?.ok ? "Ready" : "Locked", env?.ok],
    ["Mode", "View-only", false],
    ["Wallet", "Locked", false],
  ] as const;

  return <div className="wallet-rows">{rows.map(([label, value, good]) => <div className="kv" key={label}><span>{label}</span><strong className={good ? "good" : undefined}>{value}</strong></div>)}{unlocked && wallet?.reason && <div className="reason">{wallet.reason}</div>}</div>;
}

function MarketHeader({ market, live }: { market: Market | null; live: MarketLive | null }) {
  return (
    <div className="market-head">
      {market?.image && <img src={market.image} alt="" />}
      <div>
        <h1>{market?.question || "Search and select one live market"}</h1>
        <p>{market ? `$${compactNumber(market.liquidity)} liquidity / $${compactNumber(market.volume)} volume / spread ${live?.spreadCents ?? "--"}c` : "The chart, order book, and tape load after selection."}</p>
      </div>
    </div>
  );
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
    <div className="price-card">
      <div className="price-tabs"><span>YES {cents(yes)}</span><span>NO {cents(no)}</span></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="live CLOB price history">
        <path d={`${d} L 100 100 L 0 100 Z`} className="chart-fill" />
        <path d={d} className="chart-line" />
      </svg>
      {fallback && <p className="chart-empty">No recent CLOB history returned yet.</p>}
    </div>
  );
}

function DepthBook({ side, levels }: { side: "YES" | "NO"; levels?: MarketLive["orderBook"] }) {
  const bids = levels?.bids || [];
  const asks = levels?.asks || [];
  return (
    <div className="depth-card">
      <div className="mini-title">Order book / {side}</div>
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
      <div className="mini-title">Live activity</div>
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

function MoneyInput({ label, value, setValue }: { label: string; value: number; setValue: (value: number) => void }) {
  return <label className="money-input"><span>{label}</span><div><b>$</b><input type="number" min="1.1" step="0.01" value={value} onChange={(event) => setValue(Number(event.target.value))} /></div></label>;
}

function NumberBox({ label, value, setValue, suffix = "" }: { label: string; value: number; setValue: (value: number) => void; suffix?: string }) {
  return <label className="num"><span>{label}</span><div><input type="number" min="0" step="1" value={value} onChange={(event) => setValue(Number(event.target.value))} />{suffix}</div></label>;
}

function Read({ label, value }: { label: string; value: string }) {
  return <div className="read"><span>{label}</span><strong>{value}</strong></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function primaryLabel(blockedReason: string | null, side: "YES" | "NO", amount: number) {
  if (blockedReason === "UNLOCK") return "Unlock to trade";
  if (blockedReason === "SYSTEM") return "Check system";
  if (blockedReason === "ARM") return "Arm deposit wallet";
  if (blockedReason === "DEPOSIT") return "Deposit pUSD";
  if (blockedReason === "FUND") return "Fund bot wallet";
  if (blockedReason === "MARKET") return "Choose market";
  if (blockedReason === "BLOCKED") return "Market blocked";
  if (blockedReason === "PRICE") return "Waiting for price";
  return `Buy ${side} ${money(amount)}`;
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

function cents(value?: number | null) {
  return value ? `${Math.round(value * 100)}c` : "--";
}

function compactNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
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
