/* ── Airport coordinates — fetched from the public dataset via the backend ──
   The backend caches the public source (github.com/mwgg/Airports, ~7,900
   IATA-coded airports) for 30 days, so this stays fast after first load. */
let AIRPORTS = {};          // populated by loadAirports()
let airportsLoaded = false;
let airportsLoadPromise = null;

async function loadAirports() {
  if (airportsLoaded) return AIRPORTS;
  if (airportsLoadPromise) return airportsLoadPromise;
  airportsLoadPromise = (async () => {
    try {
      const data = await apiFetch('/api/airports');
      AIRPORTS = data.airports || {};
      airportsLoaded = true;
    } catch(e) {
      console.warn('Could not load airport database:', e);
      AIRPORTS = {};
    }
    return AIRPORTS;
  })();
  return airportsLoadPromise;
}

function airportLL(code) {
  const a = AIRPORTS[(code||'').toUpperCase().trim()];
  return a ? [a.lat, a.lon] : null;
}
function airportCity(code) {
  const a = AIRPORTS[(code||'').toUpperCase().trim()];
  return a ? a.city : code;
}
function airportKnown(code) {
  return !!AIRPORTS[(code||'').toUpperCase().trim()];
}

function updateAirportPreview(inputId, previewId) {
  const code = document.getElementById(inputId).value.trim().toUpperCase();
  const box = document.getElementById(previewId);
  if (!box) return;
  if (!code) { box.textContent = ''; return; }
  if (!airportsLoaded) { box.textContent = 'Loading airport data…'; box.className = 'airport-preview'; return; }
  const a = AIRPORTS[code];
  if (a) {
    box.textContent = `${a.city}${a.country ? ', '+a.country : ''}`;
    box.className = 'airport-preview ok';
  } else if (code.length === 3) {
    box.textContent = 'Not recognized — map line will be skipped for this trip';
    box.className = 'airport-preview warn';
  } else {
    box.textContent = '';
  }
}

function fmtBlockTime(mins) {
  if (!mins || mins <= 0) return null;
  const h = Math.floor(mins/60), m = mins%60;
  return h > 0 ? `${h}h ${m>0?m+'m':''}`.trim() : `${m}m`;
}

/* ── Helpers ─────────────────────────────────────────────────── */
const mpp = p => p.tm / p.fp;
const fmt = n => Math.round(n||0).toLocaleString('en-SG');

// Accepts "56,500" or "56500" typed into a number-ish text input → 56500.
function parseNum(v) {
  const n = parseFloat(String(v==null?'':v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
// Live thousands-separator formatting for inputs with class "num-input".
// data-decimal="true" allows up to 2 decimal places (for $ amounts); otherwise integers only.
function formatThousands(el) {
  const allowDecimal = el.dataset.decimal === 'true';
  const caretFromEnd = el.value.length - (el.selectionStart ?? el.value.length);
  let raw = el.value.replace(/[^0-9.]/g, '');
  if (!allowDecimal) raw = raw.replace(/\./g, '');
  const firstDot = raw.indexOf('.');
  if (firstDot !== -1) raw = raw.slice(0, firstDot+1) + raw.slice(firstDot+1).replace(/\./g, '');
  let [intPart, decPart] = raw.split('.');
  intPart = (intPart || '').replace(/^0+(?=\d)/, '');
  const formattedInt = intPart ? Number(intPart).toLocaleString('en-US') : '';
  const tail = decPart !== undefined ? '.' + decPart.slice(0,2) : '';
  el.value = formattedInt + tail;
  const newPos = Math.max(0, el.value.length - caretFromEnd);
  if (document.activeElement === el) el.setSelectionRange(newPos, newPos);
}
// Delegated: works for every num-input rendered into the modal now or in future,
// since the listener lives on the container rather than the (re-rendered) fields.
document.getElementById('modal-body').addEventListener('input', e => {
  if (e.target.classList && e.target.classList.contains('num-input')) formatThousands(e.target);
});

// Miles you can actually get after rounding points down to complete blocks
function transferableMiles(p, pts) {
  const completeBlocks = Math.floor((pts||0) / p.fp);
  return Math.round(completeBlocks * p.tm);
}

// Leftover points that can't yet fill a block
function remainderPts(p, pts) {
  return (pts||0) % p.fp;
}

function rateStr(p) {
  const r = mpp(p);
  return r >= 1 ? (Number.isInteger(r) ? r : r.toFixed(3)) + ' mi/pt'
                : (r * 1000).toFixed(2) + ' mi/1000pt';
}

function todayStr() {
  return new Date().toLocaleDateString('en-SG', {day:'numeric', month:'short', year:'numeric'});
}

function daysTo(s) {
  if (!s) return null;
  const a = new Date(s), b = new Date();
  b.setHours(0,0,0,0); a.setHours(0,0,0,0);
  return Math.ceil((a - b) / 86400000);
}

function expCls(d) {
  return d === null ? 'c-none' : d < 0 ? 'c-danger' : d <= 30 ? 'c-danger' : d <= 90 ? 'c-warn' : 'c-ok';
}

function expTxt(s) {
  if (!s) return 'No expiry set';
  const d = daysTo(s);
  const lbl = new Date(s).toLocaleDateString('en-SG', {month:'short', year:'numeric'});
  if (d < 0) return 'Expired (' + lbl + ')';
  if (d === 0) return 'Expires today!';
  if (d <= 90) return d + 'd left (' + lbl + ')';
  return 'Exp. ' + lbl;
}

function logoImg(url, fb, sz) {
  sz = sz || 36;
  const inner = Math.round(sz * .82);
  return `<img src="${url}" width="${inner}" height="${inner}" style="object-fit:contain;display:block"
    onerror="this.outerHTML='<span class=\\'logo-fb\\' style=\\'font-size:${Math.round(sz*.32)}px\\'>${fb}</span>'" alt="${fb}">`;
}

function showToast(msg, dur=2400) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), dur);
}

function cabinBadge(c) {
  const cab = CABINS.find(x => x.id === c) || {label:c||'—', cls:'cabin-Y'};
  return `<span class="cabin-badge ${cab.cls}">${cab.label}</span>`;
}
function cabinOptions(sel) {
  return CABINS.map(c => `<option value="${c.id}" ${sel===c.id?'selected':''}>${c.label}</option>`).join('');
}
function ffpOptions(sel) {
  return FFP.map(p => `<option value="${p.id}" ${sel===p.id?'selected':''}>${p.name} (${p.code})</option>`).join('');
}

function allProgOptions(sel) {
  let html = `<optgroup label="Frequent Flyer Programs">`;
  html += FFP.map(p => `<option value="${p.id}" ${sel===p.id?'selected':''}>${p.name} (${p.code})</option>`).join('');
  html += `</optgroup><optgroup label="Bank Points">`;
  html += BANK.map(p => `<option value="${p.id}" ${sel===p.id?'selected':''}>${p.name}</option>`).join('');
  html += `</optgroup>`;
  return html;
}
function progLookup(id) {
  return FFP.find(x => x.id === id) || BANK.find(x => x.id === id) || null;
}
function progLabel(id) {
  const p = progLookup(id);
  if (!p) return id;
  return p.code ? `${p.name} (${p.code})` : p.name;
}
function progLogoUrl(id) {
  const p = progLookup(id);
  return p ? p.logo : '';
}

// Best-effort suggested dest-miles for a source lot: use the bank's known
// points→miles block ratio if this program has one (fp/tm on BANK), else 1:1
// (organic FFP miles moving as-is). Always editable — real statements can differ
// (promo bonuses, rounding) so this is a starting point, not the final word.
function suggestDestMiles(sourceProgId, miles) {
  const bankProg = BANK.find(b => b.id === sourceProgId);
  if (bankProg) return transferableMiles(bankProg, miles);
  return miles;
}
