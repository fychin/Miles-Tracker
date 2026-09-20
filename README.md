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
Portfolio at a glance — top balances, miles/points expiring soon ("at risk"), orphan miles, transferable bank points.  
<img width="60%" alt="miles-tracker_dashboard" src="https://github.com/user-attachments/assets/42bbcbea-a635-47a1-b17a-e7179171878f" />

### Redemptions
Map your award flights and uncover the true ROI of your miles. Measure your personal cash-equivalent value against true acquisition costs, including annual card fees, direct miles purchases, transfer fees, and taxes—to track your net return on every redemption.  
<img width="60%" height="1511" alt="miles-tracker_redemption" src="https://github.com/user-attachments/assets/11cdb809-1d80-4ea8-a34c-073f888b5b68" />

### FFP Miles
Airline loyalty balances, grouped by alliance.  
<img width="60%" alt="miles-tracker_ffp" src="https://github.com/user-attachments/assets/6f298f49-23f9-43ea-a87f-965444ad6783" />

### Bank Points
Credit card and wallet points balances (incl. HeyMax Max Miles), with transfer-block math.  
<img width="60%" height="1767" alt="miles-tracker_bank" src="https://github.com/user-attachments/assets/3e8959fa-4625-4fe0-9b0b-78ab8000f30e" />

### Cost Basis
The core ledger — acquisitions, transfers, and blended ¢/pt / ¢/mi per program, split cleanly between bank points and FFP miles.  
<img width="60%" height="3348" alt="miles-tracker_costbasis" src="https://github.com/user-attachments/assets/c6001402-7499-4297-a6c0-8a1104c38a80" />

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
