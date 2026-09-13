# Miles & Points Tracker

A personal analytics tool for tracking and valuing a multi-program travel rewards portfolio — airline miles alongside bank and credit card points — in one place.

Frequent flyers and points collectors typically hold balances scattered across half a dozen loyalty programs and just as many bank rewards accounts, with no single view of what any of it actually cost or is currently worth. Miles & Points Tracker consolidates that portfolio and attaches a real, traceable cost to every mile and point in it, so redemption decisions can be based on actual value instead of a rough mental estimate.

## Key Features

Miles & Points Tracker brings the same rigor to a rewards portfolio that you'd expect from an investment ledger: every mile and point carries a real, traceable cost from acquisition through any transfers to the redemption that finally spends it — so you always know what your balances are actually worth, not what a rewards blog says they're worth.

- **A single portfolio view** across every airline program and every bank points program you hold, with balances, expiry dates, and at-a-glance alerts for anything expiring soon.
- **Real cost-per-mile, not a marketing valuation** — every mile and point traces back to what you actually paid or earned it for, all the way through any transfers, so blended cost figures reflect your actual portfolio rather than a published "average" redemption value.
- **Transfer history you can trust** — conversion rates are locked in at the moment you log a transfer, so a program changing its rates later never rewrites your history, and a noticeably worse rate than last time gets flagged automatically.
- **Honest redemption ROI** — log what a redemption actually consumed and cost, and see the real savings and efficiency behind every trip booked with points.

## Tabs

### Dashboard
Portfolio at a glance — top balances, miles/points expiring soon ("at risk"), blended rates.

<!-- ![Dashboard](docs/screenshots/dashboard.png) -->

### FFP Miles
Airline loyalty balances, grouped by alliance.

<!-- ![FFP Miles](docs/screenshots/ffp-miles.png) -->

### Bank Points
Credit card and wallet points balances (incl. HeyMax Max Miles), with transfer-block math.

<!-- ![Bank Points](docs/screenshots/bank-points.png) -->

### Cost Basis
The core ledger — acquisitions, transfers, and blended ¢/pt / ¢/mi per program, split cleanly between bank points and FFP miles.

<!-- ![Cost Basis](docs/screenshots/cost-basis.png) -->

### Redemptions
Logged redemptions with cabin coding, per-seat support, mi/min efficiency, savings, and a route map.

<!-- ![Redemptions](docs/screenshots/redemptions.png) -->

Two additional tabs round out the app — **Activity** (a chronological feed of everything logged) and **Settings** (JSON export / merge-import / reset-import for your whole portfolio).

## Tech stack

- **Backend:** Python (Flask), SQLite by default (swappable for Turso/libsql — see `db_driver.py`)
- **Frontend:** Vanilla JS, no build step, Leaflet.js for the redemption route map
- **Data:** [mwgg/Airports](https://github.com/mwgg/Airports) (7,900+ IATA-coded airports), cached server-side for 30 days
- **Deploy:** Runs locally out of the box; a Vercel serverless entry point (`api/index.py`) is included for hosted deployment

## Quick start

```bash
pip install -r requirements.txt
python server.py
# Open http://localhost:3000
```
