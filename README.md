# Polymarket Wizard

A guarded Polymarket trading console for one server-side bot wallet.

The app can:

- Search live Polymarket markets.
- Quote POL dynamically before funding.
- Deploy and approve a Polymarket deposit wallet.
- Convert only the needed collateral into pUSD.
- Place small guarded YES/NO trades through CLOB V2.
- Sell positions and track a lightweight activity log.
- Require the bot wallet to sign in before any funded action can run.

Auto-exit polling is intentionally disabled in the current build. Manual sells are
supported; stop-loss/take-profit automation should be treated as a future feature.

## Guide

Read the full build and setup guide:

[docs/polymarket-wizard-guide.md](docs/polymarket-wizard-guide.md)

## Local Run

```bash
npm install
npm run build
npm run dev:netlify
```

Open `http://localhost:8888`.

Never commit `.env.local`.

## Project Layout

```txt
src/                 React trading console
netlify/functions/   Server-side wallet, CLOB, relay, and auth functions
docs/                Build guide and setup screenshots
public/              Static assets
```

## Safety Model

Market search is public. Wallet balances, position history, setup, deposits,
orders, sells, withdrawals, and exit polling require a signed session from the
authorized bot wallet.
