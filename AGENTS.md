# Miles & Points Tracker — Agent Guide

## Quick Start

```bash
pip install -r requirements.txt
python server.py
# Open http://localhost:3000
```

## Codebase Map

The full codebase guide with architecture details, API endpoints, DB schema,
and troubleshooting is at [`plans/codebase-guide.md`](plans/codebase-guide.md).

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

### Troubleshooting

See the [full guide](plans/codebase-guide.md#troubleshooting-guide) for a symptom→cause→fix table.

Quick checks:
- Server running? → `python server.py`
- API healthy? → `curl http://localhost:3000/api/health`
- Static files served? → Browser DevTools → Network tab → check 200s
- JS errors? → Browser console (F12)
