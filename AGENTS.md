# Miles & Points Tracker — Agent Guide

## Quick Start

```bash
pip install -r requirements.txt
python server.py
# Open http://localhost:3000
```

## Codebase Map

The full codebase guide with architecture details, API endpoints, DB schema.

### Where to Find Things

| Task | Files to Edit |
|------|---------------|
| Add/modify a tab | `static/js/<tab>.js`, `static/js/tabs.js`, `static/index.html` |
| Add/modify an API endpoint | `server.py` |
| Change styling | `static/css/styles.css` |
| Change static data (programs, banks, cabins) | `static/js/config.js` |
| Change DB schema | `db.py` |
| Change HTML structure | `static/index.html` |
| Change shared helpers | `static/js/utils.js` |
| Change API communication | `static/js/api.js` |
| Change modal behavior | `static/js/modal.js` |
| Deploy config | `vercel.json`, `api/index.py`, `DEPLOYMENT.md` |

### Notable Endpoints (server.py)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/cost-basis` | Blended ¢/pt or ¢/mi per program, from remaining lots |
| `GET /api/cost-entries?available=true` | Lots with remaining balance, for transfer-source selection |
| `GET /api/cost-transfers/<id>` | One transfer's full link breakdown (used by "Breakdown" modal) |
| `GET /api/cost-transfer-links` | Every transfer link across the whole portfolio, joined to source program — used to derive the FFP tables' Source column instead of trusting the frozen `source` text |
| `GET /api/cost-transfer-rate-history` | Last-used rate per source program → dest FFP, for rate-drift warnings |

### Script Load Order (critical — globals depend on earlier scripts)

```
CDN libs → config.js → utils.js → api.js → modal.js → tabs.js →
dashboard.js → ffp.js → bank.js → activity.js → redemptions.js →
costbasis.js → settings.js → app.js
```

### Key Patterns

- **No framework** — vanilla JS, global state (`ST` in `api.js`), `innerHTML` rendering
- **Modal pattern** — set `onSave` callback, call `openModal()`, `doSave()` triggers it
- **API calls** — always use `apiFetch(path, opts)` from `api.js`
- **CSS tokens** — use `--sq-navy`, `--sq-gold`, etc. from `:root` in `styles.css`
- **Modal focus** — `openModal()` focuses the first `.form-input` with `{preventScroll:true}`. Don't drop that option: focusing an element inside the fixed-position `.modal-overlay` without it makes the browser scroll the underlying page to the top.
- **Bank vs. FFP vs. variable-rate bank programs** — `BANK` and `FFP` in `config.js` are two distinct unit types (¢/pt vs. ¢/mi) and must never be conflated. Within `BANK`, a program can also be `variableRate:true` (currently only `heymax`/Max Miles) with `tm:null` — meaning it has no single fixed points→miles ratio, because the real rate depends on which FFP it's transferred into and is only known once that transfer is logged. Any code that reads `p.tm` / calls `mpp(p)` for a `BANK` program must handle this (see `rateStr`, `transferableMiles`, `suggestDestMiles`, `milesEquivCpm`, `isVariableRateProgram()` in `utils.js`) rather than assuming every bank program converts at a fixed rate.
- **Hide-zero-balance toggle** — both the FFP tab (`showZeroMiles`) and Bank tab (`showZeroPoints`) default to hiding 0-balance programs, with a checkbox toggle to reveal them. The Bank tab additionally ranks banks (and programs within a bank) by balance, highest first, so an empty bank sinks to the bottom instead of sitting wherever it was declared in `config.js`.
- **Transfer provenance = `cost_transfer_links`, not `cost_entries.source`** — a transfer-type cost entry's own `source` field is just free text frozen in at save time. The authoritative record of which lot(s)/programs fed a transfer is `cost_transfer_links`. The Cost Basis tab's FFP tables derive the Source column display for transfer rows from `GET /api/cost-transfer-links` (all links, joined to their source program) rather than from `e.source`, so it can't drift from what the "Breakdown" view shows for the same transfer.
