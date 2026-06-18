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

## Guide

Read the full build and setup guide:

[docs/polymarket-wizard-guide.md](docs/polymarket-wizard-guide.md)

## Local Run

```bash
npm install
npm run build
npx netlify dev -d dist -f netlify/functions --port 8888
```

Open `http://localhost:8888`.

Never commit `.env.local`.
