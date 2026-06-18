import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Flame,
  Gauge,
  History,
  LockKeyhole,
  RefreshCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { callApi } from "./api";
import { loadSetting, saveSetting } from "./storage";
import type { EnvCheck, JournalEntry, Market, Position, WalletStatus } from "./types";

type MarketCheck = {
  ok: boolean;
  reason?: string;
  market?: Market;
  yesPrice?: number;
  noPrice?: number;
  spreadCents?: number;
};

const pollMs = Number(import.meta.env.VITE_POLL_INTERVAL_MS || 60000);

export default function App() {
  const [env, setEnv] = useState<EnvCheck | null>(null);
  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [keyword, setKeyword] = useState(loadSetting("keyword", "bitcoin"));
  const storedSelected = useMemo(() => loadSetting<Market | null>("selectedMarket", null), []);
  const [markets, setMarkets] = useState<Market[]>(storedSelected ? [storedSelected] : []);
  const [selected, setSelected] = useState<Market | null>(storedSelected);
  const [marketCheck, setMarketCheck] = useState<MarketCheck | null>(null);
  const [side, setSide] = useState<"YES" | "NO">(loadSetting("side", "YES"));
  const [amount, setAmount] = useState(loadSetting("amount", 1));
  const [stopLoss, setStopLoss] = useState(loadSetting("stopLoss", 20));
  const [takeProfit, setTakeProfit] = useState(loadSetting("takeProfit", 35));
  const [polling, setPolling] = useState(loadSetting("polling", false));
  const [positions, setPositions] = useState<Position[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedPrice = side === "YES" ? marketCheck?.yesPrice : marketCheck?.noPrice;
  const botCollateral = (wallet?.botPusdBalance || 0) + (wallet?.usdcBalance || 0) + (wallet?.polUsdcEstimate || 0);
  const walletArmed = Boolean(wallet?.depositWalletExists && wallet?.approvalsReady);
  const blockedReason = useMemo(() => {
    if (!env?.ok) return "SYS LOCK";
    if (!wallet?.readyToTrade) {
      if (walletArmed && botCollateral >= amount) return "DEPOSIT";
      if (walletArmed) return "FUND BOT";
      return "ARM WALLET";
    }
    if (!selected) return "SELECT";
    if (!marketCheck?.ok) return "BLOCKED";
    if (!selectedPrice) return "NO PRICE";
    if (!amount || amount <= 0) return "SIZE";
    return null;
  }, [amount, botCollateral, env, marketCheck, selected, selectedPrice, wallet, walletArmed]);

  const readinessScore = useMemo(() => {
    const checks = [Boolean(env?.ok), Boolean(wallet?.readyToTrade), Boolean(selected && marketCheck?.ok), Boolean(selectedPrice), Boolean(positions.length || selected)];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [env, marketCheck, positions.length, selected, selectedPrice, wallet]);

  const activeStep = useMemo(() => {
    if (!env?.ok) return 0;
    if (!walletArmed || !wallet?.readyToTrade) return 1;
    if (!selected || !marketCheck?.ok) return 2;
    if (positions.length === 0) return 3;
    return 4;
  }, [env, marketCheck, positions.length, selected, wallet, walletArmed]);

  const nextAction = useMemo(() => {
    if (!env?.ok) return { label: "CHECK", action: "env" as const, icon: ShieldCheck };
    if (!walletArmed) return { label: "ARM", action: "setup" as const, icon: Wallet };
    if (!wallet?.readyToTrade && botCollateral >= amount) return { label: "DEPOSIT", action: "deposit" as const, icon: CircleDollarSign };
    if (!wallet?.readyToTrade) return { label: "FUND BOT", action: "fund" as const, icon: Wallet };
    if (!selected) return { label: "SCAN", action: "search" as const, icon: Search };
    if (!marketCheck?.ok) return { label: "VERIFY", action: "market" as const, icon: ShieldCheck };
    return { label: blockedReason || `BUY ${side} $${amount}`, action: "buy" as const, icon: Flame };
  }, [amount, blockedReason, botCollateral, env, marketCheck, selected, side, wallet, walletArmed]);

  const exposure = useMemo(() => positions.reduce((sum, position) => sum + position.value, 0), [positions]);
  const pnl = useMemo(() => positions.reduce((sum, position) => sum + position.pnl, 0), [positions]);
  const steps: Array<{ label: string; value: string; Icon: LucideIcon }> = [
    { label: "SYS", value: env?.ok ? "OK" : "LOCK", Icon: ShieldCheck },
    { label: "WALLET", value: wallet?.readyToTrade ? "OK" : "LOCK", Icon: Wallet },
    { label: "MARKET", value: marketCheck?.ok ? "OK" : "WAIT", Icon: Search },
    { label: "TRADE", value: positions.length ? String(positions.length) : "0", Icon: Activity },
    { label: "BOT", value: polling ? "ON" : "OFF", Icon: Bot },
  ];

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

  const refreshEnv = useCallback(async () => setEnv(await callApi<EnvCheck>("env-check")), []);
  const refreshWallet = useCallback(async () => setWallet(await callApi<WalletStatus>("wallet-status")), []);
  const refreshPositions = useCallback(async () => setPositions((await callApi<{ ok: true; positions: Position[] }>("positions")).positions), []);
  const refreshJournal = useCallback(async () => setJournal((await callApi<{ ok: true; entries: JournalEntry[] }>("journal")).entries), []);
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshEnv(), refreshWallet(), refreshPositions(), refreshJournal()]);
  }, [refreshEnv, refreshJournal, refreshPositions, refreshWallet]);

  const searchMarkets = async () => {
    saveSetting("keyword", keyword);
    await run("scan", async () => {
      const data = await callApi<{ ok: true; markets: Market[] }>(`search-markets?q=${encodeURIComponent(keyword)}`);
      setMarkets(data.markets);
      setNotice(`${data.markets.length} MARKET${data.markets.length === 1 ? "" : "S"} FOUND`);
    });
  };

  const checkSelectedMarket = useCallback(async (market: Market | null) => {
    if (!market) return setMarketCheck(null);
    setMarketCheck(await callApi<MarketCheck>("market-check", { marketId: market.id }));
  }, []);

  const selectMarket = async (market: Market) => {
    if (market.disabledReason) return;
    setSelected(market);
    saveSetting("selectedMarket", market);
    await run("market", () => checkSelectedMarket(market));
  };

  const setupWallet = () => run("wallet", async () => {
    const data = await callApi<{ ok: boolean; message: string }>("setup-wallet", {});
    setNotice(data.message);
    await refreshWallet();
  });

  const deposit = () => run("deposit", async () => {
    const data = await callApi<{ message: string; status?: WalletStatus }>("deposit", { amountUsd: amount });
    setNotice(data.message);
    if (data.status) setWallet(data.status);
    await refreshWallet();
  });
  const withdraw = () => run("withdraw", async () => {
    const data = await callApi<{ message: string; status?: WalletStatus }>("withdraw", { amountUsd: amount });
    setNotice(data.message);
    if (data.status) setWallet(data.status);
    await refreshWallet();
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
    await refreshPositions();
    await refreshJournal();
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
    await refreshPositions();
    await refreshJournal();
  });

  const pollExits = useCallback(async () => {
    const data = await callApi<{ ok: boolean; message: string; sold: number }>("poll-exits", {});
    if (data.sold) setNotice(data.message);
    await refreshPositions();
    await refreshJournal();
  }, [refreshJournal, refreshPositions]);

  const runNextAction = () => {
    if (nextAction.action === "env") return run("system", refreshEnv);
    if (nextAction.action === "setup") return setupWallet();
    if (nextAction.action === "deposit") return deposit();
    if (nextAction.action === "fund") {
      setNotice("Send POL, USDC.e, or pUSD to the bot wallet, then SYNC.");
      return run("refresh", refreshWallet);
    }
    if (nextAction.action === "search") return searchMarkets();
    if (nextAction.action === "market") return run("market", () => checkSelectedMarket(selected));
    return buy();
  };

  useEffect(() => {
    refreshAll().catch(() => undefined);
  }, [refreshAll]);

  useEffect(() => {
    checkSelectedMarket(selected).catch(() => undefined);
  }, [checkSelectedMarket, selected]);

  useEffect(() => saveSetting("side", side), [side]);
  useEffect(() => saveSetting("amount", amount), [amount]);
  useEffect(() => saveSetting("stopLoss", stopLoss), [stopLoss]);
  useEffect(() => saveSetting("takeProfit", takeProfit), [takeProfit]);
  useEffect(() => saveSetting("polling", polling), [polling]);

  useEffect(() => {
    if (!polling || !env?.ok || !wallet?.readyToTrade || positions.length === 0) return;
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
  }, [env, pollExits, polling, positions.length, wallet]);

  const NextIcon = nextAction.icon;

  return (
    <main className="deck">
      <header className="topline">
        <div className="mark"><Bot size={18} /></div>
        <strong>WIZARD</strong>
        <span>{short(env?.botAddress || wallet?.botAddress || "NO WALLET")}</span>
        <button onClick={() => run("refresh", refreshAll)} disabled={Boolean(busy)}><RefreshCcw size={15} />SYNC</button>
      </header>

      {(error || notice) && (
        <section className={error ? "alert error" : "alert ok"}>
          {error ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{error || notice}</span>
        </section>
      )}

      <section className="layout">
        <aside className="rail panel">
          <ReadinessRing score={readinessScore} />
          <div className="steps">
            {steps.map(({ label, value, Icon }, index) => (
              <div className={index === activeStep ? "step active" : index < activeStep ? "step done" : "step"} key={label}>
                <Icon size={16} />
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <button className="prime" onClick={runNextAction} disabled={Boolean(busy)}>
            <NextIcon size={18} />
            {busy ? busy.toUpperCase() : nextAction.label}
            <ArrowRight size={18} />
          </button>
        </aside>

        <section className="panel scan">
          <Title icon={Search} k="SCAN" v="MARKET" />
          <div className="search-row">
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchMarkets()} />
            <button onClick={searchMarkets} disabled={busy === "scan"}><Search size={16} /></button>
          </div>
          <div className="market-list">
            {markets.length === 0 && <Empty text="READY" />}
            {markets.map((market) => (
              <button key={market.id} className={selected?.id === market.id ? "market selected" : "market"} onClick={() => selectMarket(market)} disabled={Boolean(market.disabledReason)}>
                {market.image && <img src={market.image} alt="" />}
                <strong>{market.question}</strong>
                <span>{market.disabledReason || `$${compactNumber(market.liquidity)} LIQ`}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel trade">
          <Title icon={Flame} k="TRADE" v={side} />
          <div className="question">{selected?.question || "SELECT"}</div>
          <ProbabilityChart yes={marketCheck?.yesPrice} no={marketCheck?.noPrice} />
          <div className="side-row">
            <button className={side === "YES" ? "yes active" : "yes"} onClick={() => setSide("YES")}>YES</button>
            <button className={side === "NO" ? "no active" : "no"} onClick={() => setSide("NO")}>NO</button>
          </div>
          <div className="inputs">
            <Num label="SIZE" prefix="$" value={amount} setValue={setAmount} />
            <Read label="LIMIT" value={cents(selectedPrice)} />
            <Num label="STOP" suffix="%" value={stopLoss} setValue={setStopLoss} />
            <Num label="TAKE" suffix="%" value={takeProfit} setValue={setTakeProfit} />
          </div>
          <ExitRuleChart stopLoss={stopLoss} takeProfit={takeProfit} selectedPrice={selectedPrice} />
          <button className="buy" onClick={buy} disabled={Boolean(blockedReason || busy)}>
            <CircleDollarSign size={18} />
            {blockedReason || `${side} $${amount}`}
          </button>
          <div className="guardline"><SlidersHorizontal size={14} /><span>GUARDS</span><i /></div>
        </section>

        <section className="panel wallet">
          <Title icon={Wallet} k="FUND" v="WALLET" />
          <div className="kv"><span>ENV</span><strong className={env?.ok ? "good" : "bad"}>{env?.ok ? "READY" : "LOCKED"}</strong></div>
          <div className="kv"><span>WALLET</span><strong className={wallet?.readyToTrade ? "good" : "bad"}>{wallet?.readyToTrade ? "READY" : "LOCKED"}</strong></div>
          <div className="kv"><span>BOT</span><strong>{short(wallet?.botAddress || "--")}</strong></div>
          <div className="kv"><span>DEPLOY</span><strong className={wallet?.depositWalletExists ? "good" : "bad"}>{wallet?.depositWalletExists ? short(wallet?.depositWallet || "") : "NO"}</strong></div>
          <div className="kv"><span>POL</span><strong>{(wallet?.polBalance || 0).toFixed(4)}</strong></div>
          <div className="kv"><span>POL EST</span><strong>${(wallet?.polUsdcEstimate || 0).toFixed(2)}</strong></div>
          <div className="kv"><span>USDC.E</span><strong>{(wallet?.usdcBalance || 0).toFixed(2)}</strong></div>
          <div className="kv"><span>BOT PUSD</span><strong>{(wallet?.botPusdBalance || 0).toFixed(2)}</strong></div>
          <div className="kv"><span>DEPOSIT PUSD</span><strong>{(wallet?.pusdBalance || 0).toFixed(2)}</strong></div>
          {wallet?.reason && <div className="reason">{wallet.reason}</div>}
          <FundingGauge balance={wallet?.pusdBalance || 0} target={amount || 1} />
          <div className="stack">
            <button onClick={() => run("system", refreshEnv)}><ShieldCheck size={16} />CHECK</button>
            <button onClick={setupWallet}><LockKeyhole size={16} />ARM</button>
            <button onClick={deposit}><CircleDollarSign size={16} />DEPOSIT</button>
            <button onClick={withdraw}><ArrowRight size={16} />WITHDRAW</button>
          </div>
        </section>

        <section className="panel bot-panel">
          <Title icon={Gauge} k="BOT" v={polling ? "ON" : "OFF"} />
          <ExposureChart exposure={exposure} pnl={pnl} maxDailyLoss={10} />
          <label className="toggle">
            <input type="checkbox" checked={polling} disabled={!env?.ok || !wallet?.readyToTrade || positions.length === 0} onChange={(event) => setPolling(event.target.checked)} />
            <span>60S EXIT</span>
          </label>
          <div className="positions">
            {positions.length === 0 && <Empty text="FLAT" />}
            {positions.map((position) => (
              <article className="position" key={position.id}>
                <strong>{position.question}</strong>
                <span>{position.side} / {position.shares.toFixed(2)} / ${position.pnl.toFixed(2)}</span>
                <button onClick={() => sell(position)}>SELL</button>
              </article>
            ))}
          </div>
        </section>

        <section className="panel journal-panel">
          <Title icon={History} k="LOG" v={String(journal.length)} />
          <JournalTimeline entries={journal} />
          <div className="journal">
            {journal.length === 0 && <Empty text="CLEAR" />}
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

function Num({ label, value, setValue, prefix = "", suffix = "" }: { label: string; value: number; setValue: (value: number) => void; prefix?: string; suffix?: string }) {
  return <label className="num"><span>{label}</span><div>{prefix}<input type="number" min="0" value={value} onChange={(event) => setValue(Number(event.target.value))} />{suffix}</div></label>;
}

function Read({ label, value }: { label: string; value: string }) {
  return <div className="read"><span>{label}</span><strong>{value}</strong></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function ReadinessRing({ score }: { score: number }) {
  const r = 33;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 88 88" role="img" aria-label={`readiness ${score}`}>
      <circle cx="44" cy="44" r={r} className="track" />
      <circle cx="44" cy="44" r={r} className="value" strokeDasharray={c} strokeDashoffset={c - (score / 100) * c} />
      <text x="44" y="50" textAnchor="middle">{score}</text>
    </svg>
  );
}

function ProbabilityChart({ yes, no }: { yes?: number; no?: number }) {
  const yesPct = yes ? Math.max(0, Math.min(100, Math.round(yes * 100))) : 50;
  const noPct = no ? Math.max(0, Math.min(100, Math.round(no * 100))) : 100 - yesPct;
  return <div className="prob"><div><span style={{ width: `${yesPct}%` }} /><i style={{ width: `${noPct}%` }} /></div><p>YES {yes ? `${yesPct}C` : "--"} / NO {no ? `${noPct}C` : "--"}</p></div>;
}

function ExitRuleChart({ stopLoss, takeProfit, selectedPrice }: { stopLoss: number; takeProfit: number; selectedPrice?: number }) {
  const entry = selectedPrice || 0.5;
  const stop = Math.max(0.01, entry * (1 - stopLoss / 100));
  const take = Math.min(0.99, entry * (1 + takeProfit / 100));
  return <div className="exit"><b style={{ left: `${stop * 100}%` }} /><em style={{ left: `${entry * 100}%` }} /><strong style={{ left: `${take * 100}%` }} /><p>{Math.round(stop * 100)}C / {Math.round(entry * 100)}C / {Math.round(take * 100)}C</p></div>;
}

function FundingGauge({ balance, target }: { balance: number; target: number }) {
  const pct = Math.max(0, Math.min(100, target ? Math.round((balance / target) * 100) : 0));
  return <div className="fund"><span>FUNDING</span><strong>{pct}%</strong><div><i style={{ width: `${pct}%` }} /></div></div>;
}

function ExposureChart({ exposure, pnl, maxDailyLoss }: { exposure: number; pnl: number; maxDailyLoss: number }) {
  const risk = Math.max(0, Math.min(100, Math.round((Math.abs(Math.min(0, pnl)) / maxDailyLoss) * 100)));
  return <div className="exposure"><div><span>EXPOSURE</span><strong>${exposure.toFixed(2)}</strong></div><div><span>PNL</span><strong className={pnl >= 0 ? "good" : "bad"}>${pnl.toFixed(2)}</strong></div><i><b style={{ width: `${risk}%` }} /></i></div>;
}

function JournalTimeline({ entries }: { entries: JournalEntry[] }) {
  const bars = entries.slice(0, 18).map((entry) => entry.type.length % 9 + 2);
  return <div className="bars">{Array.from({ length: 18 }).map((_, index) => <span key={index} style={{ height: `${(bars[index] || 2) * 6}px` }} />)}</div>;
}

function cents(value?: number) {
  return value ? `${Math.round(value * 100)}C` : "--";
}

function compactNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function short(value: string) {
  if (!value || value === "unknown" || value === "NO WALLET") return value;
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}
