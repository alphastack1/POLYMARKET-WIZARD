# Polymarket Wizard

A React + Netlify trading console for a single guarded Polymarket hot wallet.

The app is built around one rule:

```txt
If the wizard is not sure, it refuses to trade.
```

## What It Does

- Searches open Polymarket markets through Gamma.
- Blocks closed, inactive, low-liquidity, wide-spread, expired, or missing-token markets.
- Derives and deploys a Polymarket deposit wallet through the official relayer.
- Sets max pUSD and CTF approvals from the deposit wallet.
- Wraps bot-wallet USDC.e into pUSD and sends it to the deposit wallet.
- Places CLOB V2 YES/NO buy orders from the deposit wallet.
- Reads live positions from the Polymarket Data API.
- Supports manual sells and 60-second stop-loss / take-profit polling.
- Stores a small journal in Netlify Blobs.

## Funding Model

The seed phrase lives only in local/Netlify environment variables. The browser never sees it.

Send funds to the bot wallet:

```txt
POL:    gas and optional source collateral
USDC.e: collateral that the app can wrap into pUSD
pUSD:   collateral that the app can transfer directly
```

The app then:

```txt
POL in bot wallet -> USDC.e in bot wallet -> pUSD in Polymarket deposit wallet -> CLOB trade
USDC.e in bot wallet -> pUSD in Polymarket deposit wallet -> CLOB trade
pUSD in bot wallet -> pUSD in Polymarket deposit wallet -> CLOB trade
```

POL conversion uses the live Uniswap V3 quote at deposit time. The app keeps a gas reserve and refuses the deposit if the current POL balance cannot safely quote enough USDC.e for the requested USD amount.

If you already have pUSD, you can send pUSD directly to the Polymarket deposit wallet and skip the deposit/wrap step.

## Local Setup

```bash
npm install
cp .env.example .env.local
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

POLYMARKET_BUILDER_API_KEY
POLYMARKET_BUILDER_SECRET
POLYMARKET_BUILDER_PASSPHRASE
POLYMARKET_BUILDER_CODE

BOT_MNEMONIC
BOT_ACCOUNT_INDEX
```

Never commit `.env.local`.

CLOB API credentials are not copied into env. The app creates or derives them from `BOT_MNEMONIC` at runtime so they belong to this Wizard signer wallet.

## First Run

1. Open the app.
2. Confirm `ENV` is ready.
3. Click `ARM` to deploy and approve the Polymarket deposit wallet.
4. Send POL, USDC.e, or pUSD to the bot wallet.
5. Click `SYNC`.
6. Click `DEPOSIT` to swap/wrap collateral into pUSD in the deposit wallet.
7. Search a market.
8. Pick YES or NO.
9. Buy a small amount.

The first wallet deploy can take a little time to appear in Polymarket's registry. If `ARM` says the registry is syncing, wait a few seconds and click `ARM` again.
