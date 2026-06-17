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
  Sparkles,
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
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selected, setSelected] = useState<Market | null>(loadSetting<Market | null>("selectedMarket", null));
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
  const blockedReason = useMemo(() => {
    if (!env?.ok) return "Complete system check";
    if (!wallet?.readyToTrade) return wallet?.reason || "Set up and fund wallet";
    if (!selected) return "Choose a market";
    if (!marketCheck?.ok) return marketCheck?.reason || "Market not tradeable";
    if (!selectedPrice) return "No valid price";
    if (!amount || amount <= 0) return "Enter an amount";
    return null;
  }, [amount, env, marketCheck, selected, selectedPrice, wallet]);

  const activeStep = useMemo(() => {
    if (!env?.ok) return 0;
    if (!wallet?.readyToTrade) return 1;
    if (!selected || !marketCheck?.ok) return 2;
    if (positions.length === 0) return 3;
    return 4;
  }, [env, marketCheck, positions.length, selected, wallet]);
  const readinessScore = useMemo(() => {
    const checks = [
      Boolean(env?.ok),
      Boolean(wallet?.readyToTrade),
      Boolean(selected && marketCheck?.ok),
      Boolean(selectedPrice),
      Boolean(positions.length || selected),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [env, marketCheck, positions.length, selected, selectedPrice, wallet]);
  const exposure = useMemo(() => positions.reduce((sum, position) => sum + position.value, 0), [positions]);
  const pnl = useMemo(() => positions.reduce((sum, position) => sum + position.pnl, 0), [positions]);

  const nextAction = useMemo(() => {
    if (!env?.ok) return { label: "Run system check", action: "env" as const, icon: ShieldCheck };
    if (!wallet?.readyToTrade) return { label: "Prepare wallet", action: "setup" as const, icon: Wallet };
    if (!selected) return { label: "Find a market", action: "search" as const, icon: Search };
    if (!marketCheck?.ok) return { label: "Recheck market", action: "market" as const, icon: ShieldCheck };
    return { label: blockedReason || `Buy ${side} for $${amount}`, action: "buy" as const, icon: Flame };
  }, [amount, blockedReason, env, marketCheck, selected, side, wallet]);
  const steps: Array<{ label: string; value: string; Icon: LucideIcon }> = [
    { label: "System", value: env?.ok ? "Ready" : "Blocked", Icon: ShieldCheck },
    { label: "Wallet", value: wallet?.readyToTrade ? "Ready" : "Setup needed", Icon: Wallet },
    { label: "Market", value: marketCheck?.ok ? "Validated" : "Pick one", Icon: Search },
    { label: "Trade", value: positions.length ? `${positions.length} open` : "No position", Icon: Activity },
    { label: "Autopilot", value: polling ? "Watching" : "Off", Icon: Bot },
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

  const refreshEnv = useCallback(async () => {
    const data = await callApi<EnvCheck>("env-check");
    setEnv(data);
  }, []);

  const refreshWallet = useCallback(async () => {
    const data = await callApi<WalletStatus>("wallet-status");
    setWallet(data);
  }, []);

  const refreshPositions = useCallback(async () => {
    const data = await callApi<{ ok: true; positions: Position[] }>("positions");
    setPositions(data.positions);
  }, []);

  const refreshJournal = useCallback(async () => {
    const data = await callApi<{ ok: true; entries: JournalEntry[] }>("journal");
    setJournal(data.entries);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshEnv(), refreshWallet(), refreshPositions(), refreshJournal()]);
  }, [refreshEnv, refreshJournal, refreshPositions, refreshWallet]);

  const searchMarkets = async () => {
    saveSetting("keyword", keyword);
    await run("searching", async () => {
      const data = await callApi<{ ok: true; markets: Market[] }>(`search-markets?q=${encodeURIComponent(keyword)}`);
      setMarkets(data.markets);
      setNotice(`Found ${data.markets.length} guarded markets for "${keyword}"`);
    });
  };

  const checkSelectedMarket = useCallback(async (market: Market | null) => {
    if (!market) {
      setMarketCheck(null);
      return;
    }
    const data = await callApi<MarketCheck>("market-check", { marketId: market.id });
    setMarketCheck(data);
  }, []);

  const selectMarket = async (market: Market) => {
    if (market.disabledReason) return;
    setSelected(market);
    saveSetting("selectedMarket", market);
    await run("checking market", () => checkSelectedMarket(market));
  };

  const setupWallet = () => run("setup wallet", async () => {
    const data = await callApi<{ ok: boolean; message: string }>("setup-wallet", {});
    setNotice(data.message);
    await refreshWallet();
  });

  const deposit = () => run("deposit", async () => {
    const data = await callApi<{ message: string }>("deposit", {});
    setNotice(data.message);
  });

  const withdraw = () => run("withdraw", async () => {
    const data = await callApi<{ message: string }>("withdraw", {});
    setNotice(data.message);
  });

  const buy = () => run("buy", async () => {
    if (!selected || !selectedPrice) throw new Error("No selected market/price");
    const data = await callApi<{ ok: boolean; message: string }>("buy", {
      marketId: selected.id,
      side,
      amountUsd: amount,
      limitPrice: selectedPrice,
      stopLossPercent: stopLoss,
      takeProfitPercent: takeProfit,
    });
    setNotice(data.message);
    await refreshPositions();
    await refreshJournal();
  });

  const sell = (position: Position) => run("sell", async () => {
    const data = await callApi<{ ok: boolean; message: string }>("sell", {
      positionId: position.id,
      tokenId: position.tokenId,
      shares: position.shares,
      limitPrice: position.currentPrice,
      reason: "manual",
    });
    setNotice(data.message);
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
    if (nextAction.action === "env") return run("env check", refreshEnv);
    if (nextAction.action === "setup") return setupWallet();
    if (nextAction.action === "search") return searchMarkets();
    if (nextAction.action === "market") return run("checking market", () => checkSelectedMarket(selected));
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
    if (!polling) return;
    if (!env?.ok || !wallet?.readyToTrade || positions.length === 0) return;

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
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <div className="brand-lockup">
            <div className="brand-mark"><Sparkles size={22} /></div>
            <span>Polymarket Wizard</span>
          </div>
          <h1>One guided path from setup to guarded trades.</h1>
          <p>
            Search a market, fund the bot wallet, choose a side, and let the wizard block anything
            stale, closed, unfunded, or unsafe.
          </p>
        </div>
        <div className="command-card">
          <div className="command-head">
            <span>Next best action</span>
            <button className="ghost-button" onClick={() => run("refresh", refreshAll)} disabled={Boolean(busy)}>
              <RefreshCcw size={15} />
              {busy ? busy : "Refresh"}
            </button>
          </div>
          <div className="readiness">
            <ReadinessRing score={readinessScore} />
            <div>
              <span>Wizard readiness</span>
              <strong>{readinessScore}%</strong>
              <p>{blockedReason || "All core gates are open for the next trade."}</p>
            </div>
          </div>
          <button className="mega-button" onClick={runNextAction} disabled={Boolean(busy)}>
            <NextIcon size={22} />
            <span>{busy ? "Working..." : nextAction.label}</span>
            <ArrowRight size={20} />
          </button>
          <div className="mini-ledger">
            <Metric label="Bot wallet" value={short(env?.botAddress || wallet?.botAddress || "unknown")} />
            <Metric label="Deposit wallet" value={short(wallet?.depositWallet || "not ready")} />
            <Metric label="pUSD" value={`$${(wallet?.pusdBalance || 0).toFixed(2)}`} />
          </div>
        </div>
      </section>

      {(error || notice) && (
        <section className={error ? "toast error" : "toast ok"}>
          {error ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || notice}</span>
        </section>
      )}

      <section className="wizard-strip">
        {steps.map(({ label, value, Icon }, index) => (
          <div className={index === activeStep ? "wizard-step active" : index < activeStep ? "wizard-step done" : "wizard-step"} key={label}>
            <Icon size={18} />
            <div>
              <strong>{label}</strong>
              <span>{value}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="main-grid">
        <section className="surface market-surface">
          <SectionTitle icon={Search} label="Discover" title="Find a tradeable market" />
          <div className="search-box">
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchMarkets()} placeholder="bitcoin, fed, nba, elections..." />
            <button onClick={searchMarkets} disabled={busy === "searching"}><Search size={18} /> Search</button>
          </div>
          <div className="market-list">
            {markets.length === 0 && <EmptyState text="Search results appear here. Closed and invalid markets cannot be selected." />}
            {markets.map((market) => (
              <button key={market.id} className={`market-card ${selected?.id === market.id ? "selected" : ""}`} onClick={() => selectMarket(market)} disabled={Boolean(market.disabledReason)}>
                {market.image && <img src={market.image} alt="" />}
                <span className="market-question">{market.question}</span>
                <span className={market.disabledReason ? "market-badge bad" : "market-badge"}>
                  {market.disabledReason || `$${compactNumber(market.liquidity)} liquidity`}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="surface trade-surface">
          <SectionTitle icon={Flame} label="Execute" title="Build the trade" />
          <div className="selected-panel">
            <span>Selected market</span>
            <strong>{selected?.question || "No market selected yet"}</strong>
            <p>{marketCheck?.ok ? `YES ${cents(marketCheck.yesPrice)} / NO ${cents(marketCheck.noPrice)} - spread ${marketCheck.spreadCents}c` : marketCheck?.reason || "Wizard will validate the market before buying."}</p>
          </div>
          <ProbabilityChart yes={marketCheck?.yesPrice} no={marketCheck?.noPrice} />

          <div className="side-switch">
            <button className={side === "YES" ? "yes active" : "yes"} onClick={() => setSide("YES")}>YES</button>
            <button className={side === "NO" ? "no active" : "no"} onClick={() => setSide("NO")}>NO</button>
          </div>

          <div className="trade-form">
            <NumberField label="Amount" prefix="$" value={amount} onChange={setAmount} />
            <Readout label="Limit price" value={cents(selectedPrice)} />
            <NumberField label="Stop loss" suffix="%" value={stopLoss} onChange={setStopLoss} />
            <NumberField label="Take profit" suffix="%" value={takeProfit} onChange={setTakeProfit} />
          </div>
          <ExitRuleChart stopLoss={stopLoss} takeProfit={takeProfit} selectedPrice={selectedPrice} />

          <button className="buy-button" onClick={buy} disabled={Boolean(blockedReason || busy)}>
            <CircleDollarSign size={20} />
            <span>{blockedReason || `Buy ${side} for $${amount}`}</span>
          </button>

          <details className="advanced">
            <summary><SlidersHorizontal size={16} /> Advanced guardrails</summary>
            <p>Server-side checks revalidate env, wallet status, market status, liquidity, spread, token IDs, balance, and max trade size before every order.</p>
          </details>
        </section>

        <section className="surface wallet-surface">
          <SectionTitle icon={Wallet} label="Fund" title="Prepare the bot wallet" />
          <div className="wallet-state">
            <StatusPill good={Boolean(env?.ok)} label={env?.ok ? "Env ready" : "Env blocked"} />
            <StatusPill good={Boolean(wallet?.readyToTrade)} label={wallet?.readyToTrade ? "Wallet ready" : "Wallet locked"} />
          </div>
          <FundingGauge balance={wallet?.pusdBalance || 0} target={amount || 1} />
          <div className="action-stack">
            <button onClick={() => run("env check", refreshEnv)}><ShieldCheck size={18} /> Run system check</button>
            <button onClick={setupWallet} disabled={Boolean(busy)}><LockKeyhole size={18} /> One-click wallet setup</button>
            <button onClick={deposit}><CircleDollarSign size={18} /> Deposit pUSD</button>
            <button onClick={withdraw}><ArrowRight size={18} /> Withdraw</button>
          </div>
          <p className="fine-print">{env?.missing?.length ? `Missing: ${env.missing.join(", ")}` : wallet?.reason || "System credentials are present."}</p>
        </section>

        <section className="surface positions-surface">
          <SectionTitle icon={Gauge} label="Autopilot" title="Watch open positions" />
          <ExposureChart exposure={exposure} pnl={pnl} maxDailyLoss={10} />
          <label className="autopilot">
            <input type="checkbox" checked={polling} disabled={!env?.ok || !wallet?.readyToTrade || positions.length === 0} onChange={(event) => setPolling(event.target.checked)} />
            <span>Check exits every 60 seconds</span>
          </label>
          <div className="position-list">
            {positions.length === 0 && <EmptyState text="No open positions. The wizard will enable autopilot after the first position appears." />}
            {positions.map((position) => (
              <article className="position-card" key={position.id}>
                <strong>{position.question}</strong>
                <span>{position.side} - {position.shares.toFixed(2)} shares - PnL ${position.pnl.toFixed(2)}</span>
                <button onClick={() => sell(position)} disabled={Boolean(busy)}>Sell position</button>
              </article>
            ))}
          </div>
        </section>

        <section className="surface journal-surface">
          <SectionTitle icon={History} label="Memory" title="Trade journal" />
          <JournalTimeline entries={journal} />
          <div className="journal">
            {journal.length === 0 && <EmptyState text="Setup, trade attempts, blocks, and fills will appear here." />}
            {journal.map((entry) => (
              <div className="journal-row" key={entry.id}>
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

function SectionTitle({ icon: Icon, label, title }: { icon: LucideIcon; label: string; title: string }) {
  return (
    <div className="section-title">
      <div><Icon size={18} /></div>
      <span>{label}</span>
      <h2>{title}</h2>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function StatusPill({ good, label }: { good: boolean; label: string }) {
  return <span className={good ? "status-pill good" : "status-pill"}>{label}</span>;
}

function NumberField({ label, value, onChange, prefix = "", suffix = "" }: { label: string; value: number; onChange: (value: number) => void; prefix?: string; suffix?: string }) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        {prefix && <em>{prefix}</em>}
        <input type="number" min="0" value={value} onChange={(event) => onChange(Number(event.target.value))} />
        {suffix && <em>{suffix}</em>}
      </div>
    </label>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return <div className="readout"><span>{label}</span><strong>{value}</strong></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function ReadinessRing({ score }: { score: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  return (
    <svg className="readiness-ring" viewBox="0 0 88 88" role="img" aria-label={`Wizard readiness ${score}%`}>
      <circle cx="44" cy="44" r={radius} className="ring-track" />
      <circle cx="44" cy="44" r={radius} className="ring-value" strokeDasharray={circumference} strokeDashoffset={offset} />
      <text x="44" y="49" textAnchor="middle">{score}</text>
    </svg>
  );
}

function ProbabilityChart({ yes, no }: { yes?: number; no?: number }) {
  const yesPercent = yes ? Math.max(0, Math.min(100, Math.round(yes * 100))) : 50;
  const noPercent = no ? Math.max(0, Math.min(100, Math.round(no * 100))) : 100 - yesPercent;
  return (
    <div className="probability-chart" aria-label="YES and NO probability chart">
      <div className="probability-head">
        <span>Price map</span>
        <strong>{yes ? `${yesPercent} / ${noPercent}` : "awaiting market"}</strong>
      </div>
      <div className="probability-bar">
        <span className="yes-fill" style={{ width: `${yesPercent}%` }} />
        <span className="no-fill" style={{ width: `${noPercent}%` }} />
      </div>
      <div className="probability-labels">
        <span>YES {yes ? `${yesPercent}c` : "n/a"}</span>
        <span>NO {no ? `${noPercent}c` : "n/a"}</span>
      </div>
    </div>
  );
}

function ExitRuleChart({ stopLoss, takeProfit, selectedPrice }: { stopLoss: number; takeProfit: number; selectedPrice?: number }) {
  const entry = selectedPrice || 0.5;
  const stop = Math.max(0.01, entry * (1 - stopLoss / 100));
  const take = Math.min(0.99, entry * (1 + takeProfit / 100));
  const entryX = entry * 100;
  const stopX = stop * 100;
  const takeX = take * 100;
  return (
    <div className="exit-chart">
      <div className="exit-track">
        <span className="exit-stop" style={{ left: `${stopX}%` }} />
        <span className="exit-entry" style={{ left: `${entryX}%` }} />
        <span className="exit-take" style={{ left: `${takeX}%` }} />
      </div>
      <div className="exit-labels">
        <span>Stop {Math.round(stop * 100)}c</span>
        <span>Entry {Math.round(entry * 100)}c</span>
        <span>Take {Math.round(take * 100)}c</span>
      </div>
    </div>
  );
}

function FundingGauge({ balance, target }: { balance: number; target: number }) {
  const pct = Math.max(0, Math.min(100, target ? Math.round((balance / target) * 100) : 0));
  return (
    <div className="funding-gauge">
      <div>
        <span>Funding coverage</span>
        <strong>{pct}%</strong>
      </div>
      <div className="gauge-track">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p>${balance.toFixed(2)} pUSD available for a ${target.toFixed(2)} trade.</p>
    </div>
  );
}

function ExposureChart({ exposure, pnl, maxDailyLoss }: { exposure: number; pnl: number; maxDailyLoss: number }) {
  const riskPct = Math.max(0, Math.min(100, Math.round((Math.abs(Math.min(0, pnl)) / maxDailyLoss) * 100)));
  return (
    <div className="exposure-chart">
      <div className="exposure-stat">
        <span>Exposure</span>
        <strong>${exposure.toFixed(2)}</strong>
      </div>
      <div className="exposure-stat">
        <span>PnL</span>
        <strong className={pnl >= 0 ? "positive" : "negative"}>${pnl.toFixed(2)}</strong>
      </div>
      <div className="risk-meter">
        <span style={{ width: `${riskPct}%` }} />
      </div>
    </div>
  );
}

function JournalTimeline({ entries }: { entries: JournalEntry[] }) {
  const counts = entries.slice(0, 12).map((entry) => entry.type.length % 8 + 2);
  return (
    <div className="timeline-bars" aria-label="Recent journal activity">
      {Array.from({ length: 12 }).map((_, index) => (
        <span key={index} style={{ height: `${(counts[index] || 2) * 8}px` }} />
      ))}
    </div>
  );
}

function cents(value?: number) {
  return value ? `${Math.round(value * 100)}c` : "n/a";
}

function compactNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function short(value: string) {
  if (!value || value === "unknown" || value === "not ready") return value;
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}
