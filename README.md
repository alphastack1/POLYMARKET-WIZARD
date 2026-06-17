# Polymarket Wizard

A polished React + Netlify starter for a guardrailed Polymarket trading bot.

The app is built around one rule:

```txt
If the wizard is not sure, it refuses to trade.
```

## What It Includes

- Vite + React frontend.
- Netlify Functions backend.
- Hot-wallet seed phrase support through server-side env vars.
- Polygon RPC fallback list.
- Polymarket market search through Gamma.
- Market guardrails for closed, inactive, invalid, low-liquidity, wide-spread, or missing-token markets.
- Wizard UI with readiness, funding, probability, exit-rule, exposure, and journal charts.
- Netlify Blobs trade journal scaffolding.
- Blocked buy/sell/deposit/withdraw endpoints until live CLOB and deposit-wallet flows are wired.

## Local Setup

```bash
npm install
cp .env.example .env.local
npx netlify dev -d dist -f netlify/functions --port 8888
```

For development, run a build before serving `dist`:

```bash
npm run build
npx netlify dev -d dist -f netlify/functions --port 8888
```

Open:

```txt
http://localhost:8888
```

## Required Env Vars

Server-side only:

```txt
POLYGON_RPC_URL
POLYGON_RPC_FALLBACKS
POLYMARKET_CLOB_API_KEY
POLYMARKET_CLOB_SECRET
POLYMARKET_CLOB_PASSPHRASE
POLYMARKET_BUILDER_API_KEY
POLYMARKET_BUILDER_SECRET
POLYMARKET_BUILDER_PASSPHRASE
POLYMARKET_BUILDER_CODE
POLYMARKET_RELAYER_API_KEY
POLYMARKET_RELAYER_API_KEY_ADDRESS
BOT_MNEMONIC
BOT_ACCOUNT_INDEX
```

Never commit `.env.local`.

## Current Status

The wizard UI, env validation, market discovery, market guardrails, wallet status shell, journal shell, and local Netlify runtime are working.

Live deposit wallet setup, pUSD deposit/withdraw routing, and CLOB buy/sell submission are intentionally blocked until those flows are wired and verified.
