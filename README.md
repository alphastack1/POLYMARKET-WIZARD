# Polymarket Wizard

A public connected-wallet Polymarket trading prototype.

This branch is for a hosted app where each user connects their own wallet. The
server signs Builder relayer headers, but it does not store user seed phrases,
user CLOB credentials, or user funds.

The app can:

- Search live Polymarket markets.
- Connect a browser wallet on Polygon.
- Derive, deploy, and approve that wallet's Polymarket deposit wallet.
- Fund the deposit wallet with pUSD.
- Review and submit small YES/NO CLOB orders.
- Show positions, local activity, wallet balances, and withdrawal controls.

## Bot Checklist Guide

Read the base-layer checklist for what any Polymarket trading bot must have:

[docs/polymarket-wizard-guide.md](docs/polymarket-wizard-guide.md)

The guide is the important part for builders. This frontend is one working
prototype that implements the flow.

## Local Run

```bash
npm install
npm run build
npm run dev:netlify
```

Open `http://localhost:8888`.

Never commit `.env.local`.

## Required Environment

Copy `.env.example`, then fill in:

- `POLYGON_RPC_URL`
- `VITE_POLYGON_RPC_URL`
- `POLYMARKET_BUILDER_API_KEY`
- `POLYMARKET_BUILDER_SECRET`
- `POLYMARKET_BUILDER_PASSPHRASE`
- `POLYMARKET_BUILDER_CODE`

Netlify Functions should run in the Ireland region for Polymarket relayer
latency. Keep `PUBLIC_APP_DISABLED=true` available as an emergency switch: it
blocks new trades while keeping withdrawals usable.

## Project Layout

```txt
src/                 React public-wallet trading app
netlify/functions/   Builder signing, market data, relay, and positions functions
docs/                Bot checklist guide
public/              Static assets
```

## Safety Model

Users sign setup, approvals, funding, withdrawals, and trades from their own
wallet. The backend supplies Builder routing and market checks. If you do not
want new orders going through the hosted app, set `PUBLIC_APP_DISABLED=true`.
