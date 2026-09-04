/* ── App state ───────────────────────────────────────────────── */
let ST = {ffp:{}, bank:{}, costBasis:{}, settings:{ideal_cpm:1.5}};
let apiOnline = false;

/* ── API layer ───────────────────────────────────────────────── */
async function apiFetch(path, opts={}) {
  const r = await fetch(API + path, {headers:{'Content-Type':'application/json'}, ...opts});
  if (!r.ok) {
    const raw = await r.text();
    try { throw new Error(JSON.parse(raw).error || raw); } catch(parseErr) {
      if (parseErr instanceof SyntaxError) throw new Error(raw);
      throw parseErr;
    }
  }
  return r.json();
}

async function loadData() {
  try {
    const [ffpRows, bankRows, basisMap, settings] = await Promise.all([
      apiFetch('/api/ffp'), apiFetch('/api/bank'), apiFetch('/api/cost-basis'), apiFetch('/api/settings')
    ]);
    ST.ffp = {}; ffpRows.forEach(r => { ST.ffp[r.id] = r; });
    ST.bank = {}; bankRows.forEach(r => { ST.bank[r.id] = r; });
    ST.costBasis = basisMap || {};
    ST.settings = settings || {ideal_cpm: 1.5};
    apiOnline = true;
  } catch(e) {
    apiOnline = false;
    console.warn('API unreachable:', e);
  }
  FFP.forEach(p  => { if (!ST.ffp[p.id])  ST.ffp[p.id]  = {id:p.id, miles:0,  expiry:'', notes:'', updated_at:''}; });
  BANK.forEach(p => { if (!ST.bank[p.id]) ST.bank[p.id] = {id:p.id, points:0, expiry:'', updated_at:''}; });
}

function apiBanner() {
  const dot = `<span class="api-dot ${apiOnline ? 'ok' : 'err'}"></span>`;
  const msg = apiOnline ? 'Connected to local database'
    : 'API offline — data will not be saved. Start the server and refresh.';
  return `<div class="api-banner">${dot}<span>${msg}</span>${apiOnline ? `<span style="margin-left:auto"><a href="/api/export" style="font-size:11px;color:var(--sq-gold-dark);font-weight:500">Export JSON ↓</a></span>` : ''}</div>`;
}
