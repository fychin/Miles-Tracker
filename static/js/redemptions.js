/* ── Redemptions tab ─────────────────────────────────────────── */
let redemptionMap = null;

async function renderRedemptions() {
  const pane = document.getElementById('pane-redemptions');
  pane.innerHTML = '<div style="color:var(--sq-text-muted);padding:2rem 0;font-size:13px">Loading…</div>';
  let rows = [];
  try { rows = await apiFetch('/api/redemptions'); } catch(e) {
    pane.innerHTML = `<div class="api-banner"><span class="api-dot err"></span>Could not load. Is the server running?</div>`;
    return;
  }
  const totalMi  = rows.reduce((s,r) => s + (r.miles_used||0), 0);
  const totalBlockMinutes = rows.reduce((s,r) => s + (r.block_time_minutes||0), 0);
  const avgMiPerMin = totalBlockMinutes > 0 ? (totalMi / totalBlockMinutes) : null;
  const premiums  = rows.filter(r => r.cabin==='F'||r.cabin==='J').length;
  const topProg  = (() => {
    const cnt = {}; rows.forEach(r => { cnt[r.program_id]=(cnt[r.program_id]||0)+r.miles_used; });
    const best = Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0];
    if (!best) return '—';
    const p = FFP.find(x=>x.id===best[0]);
    return p ? p.code : best[0];
  })();

  let listHtml = '';
  if (rows.length === 0) {
    listHtml = `<div class="empty-state">
      <div class="empty-state-icon">✈</div>
      <div style="font-size:14px;font-weight:500;color:var(--sq-text-mid)">No redemptions logged yet</div>
      <div style="font-size:12px;margin-top:6px">Click "Log redemption" to record your first award flight.</div>
    </div>`;
  } else {
    // Group by year
    const byYear = {};
    rows.forEach(r => {
      const yr = r.travel_date ? r.travel_date.slice(0,4) : 'Undated';
      (byYear[yr] = byYear[yr]||[]).push(r);
    });
    Object.keys(byYear).sort((a,b)=>b.localeCompare(a)).forEach(yr => {
      listHtml += `<div class="sec-hd">${yr}<div class="sec-hd-line"></div></div>`;
      byYear[yr].forEach(r => {
        const prog = FFP.find(x=>x.id===r.program_id);
        const dtLabel = r.travel_date ? new Date(r.travel_date+'T00:00:00').toLocaleDateString('en-SG',{day:'numeric',month:'short'}) : '';
        // Build route display: prefer origin/destination fields, fall back to legacy route string
        let routeDisplay;
        if (r.origin || r.destination) {
          const via = r.via ? ` <span style="color:var(--sq-text-muted);font-weight:400">via ${r.via}</span> ` : ' ';
          const arrow = r.one_way ? '→' : '⇄';
          routeDisplay = `${r.origin||'?'}${via}<span style="color:var(--sq-gold-dark)">${arrow}</span>${via}${r.destination||'?'}`;
        } else {
          routeDisplay = r.route || 'Route not set';
        }
        const tripTypeLabel = r.one_way
          ? '<span class="trip-badge trip-ow">One-way</span>'
          : '<span class="trip-badge trip-rt">Round-trip</span>';
        const blockTimeLabel = fmtBlockTime(r.block_time_minutes);
        const mpm = r.block_time_minutes > 0 ? (r.miles_used / r.block_time_minutes) : null;
        const basis = ST.costBasis[r.program_id];
        const cpm = basis && basis.cost_per_mile > 0 ? basis.cost_per_mile : null;
        const milesCost = cpm !== null ? r.miles_used * cpm : null;
        const totalSpent = milesCost !== null ? milesCost + (r.taxes_fees||0) : null;
        const savings = (totalSpent !== null && r.cash_value > 0) ? r.cash_value - totalSpent : null;
        let valueLine = '';
        if (r.cash_value > 0) {
          if (savings !== null) {
            const pct = r.cash_value > 0 ? (savings / r.cash_value * 100) : 0;
            const savCls = savings >= 0 ? 'c-ok' : 'c-danger';
            valueLine = `<div class="rdp-meta">
              <span class="${savCls}" style="font-weight:600">${savings>=0?'Saved':'Lost'} $${fmt(Math.abs(savings))}</span>
              <span>vs cash $${fmt(r.cash_value)} (${pct.toFixed(0)}% ${savings>=0?'off':'over'})</span>
            </div>`;
          } else {
            valueLine = `<div class="rdp-meta"><span style="color:var(--sq-text-muted)">Cash price $${fmt(r.cash_value)} · add cost-basis entries for ${prog?.name||r.program_id} to see savings</span></div>`;
          }
        }
        listHtml += `<div class="rdp-card">
          <div class="rdp-logo">${prog ? logoImg(prog.logo, prog.code, 32) : '<span style="font-size:10px;color:var(--sq-text-muted)">?</span>'}</div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <div class="rdp-route">${routeDisplay}</div>
              ${tripTypeLabel}
              ${cabinBadge(r.cabin)}
            </div>
            <div class="rdp-meta" title="${mpm !== null ? 'Miles used ÷ scheduled block (gate-to-gate) minutes for this flight — a rough way to compare miles \'spent per minute of flying\' across redemptions of different lengths and cabins. Higher isn\'t automatically worse: a long-haul First seat will show a high mi/min next to a short Economy hop, since both the miles and the minutes scale together.' : ''}">
              ${blockTimeLabel ? `<span class="block-time-pill">✈ ${blockTimeLabel}</span>` : ''}
              ${mpm !== null ? `<span class="mpm-pill">${mpm.toFixed(2)} mi/min</span>` : ''}
              ${dtLabel ? `<span>${dtLabel}</span>` : ''}
              ${r.airline && r.airline !== (prog?.airline||'') ? `<span>·</span><span>${r.airline}</span>` : ''}
              ${r.notes ? `<span>·</span><span style="font-style:italic">${r.notes}</span>` : ''}
            </div>
            ${valueLine}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
            <div class="rdp-miles">${fmt(r.miles_used)} <span style="font-size:11px;font-weight:400;color:var(--sq-text-muted)">mi</span></div>
            <div class="rdp-prog">${prog?.name||r.program_id}</div>
            ${cpm !== null ? `<div style="font-size:10px;color:var(--sq-text-muted)">≈$${fmt(totalSpent)} cost</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;margin-left:4px">
            <button class="btn btn-sm" onclick="editRedemption(${r.id})">Edit</button>
            <button class="btn btn-sm" style="color:var(--sq-danger);border-color:rgba(153,28,28,.3)" onclick="deleteRedemption(${r.id})">Del</button>
          </div>
        </div>`;
      });
    });
  }

  pane.innerHTML = `
    ${apiBanner()}
    <div class="grid4" style="margin-bottom:1.25rem">
      <div class="metric-card">
        <div class="metric-label">Total miles redeemed</div>
        <div class="metric-value gold">${fmt(totalMi)}</div>
        <div class="metric-sub">${rows.length} redemption${rows.length!==1?'s':''}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Premium cabin</div>
        <div class="metric-value">${premiums}</div>
        <div class="metric-sub">F / J redemption${premiums!==1?'s':''}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg miles / min</div>
        <div class="metric-value">${avgMiPerMin !== null ? avgMiPerMin.toFixed(2) : '—'}</div>
        <div class="metric-sub">Miles spent per minute flown, across all redemptions</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Top program</div>
        <div class="metric-value" style="font-size:18px">${topProg}</div>
        <div class="metric-sub">By miles redeemed</div>
      </div>
    </div>
    <div class="sec-hd">Route map<div class="sec-hd-line"></div></div>
    <div class="card mb-16" style="padding:0.6rem">
      ${rows.length > 0 ? `<div id="redemption-map"></div>` : `<div class="map-empty">Log a redemption with origin/destination to see it plotted here.</div>`}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="sec-hd" style="margin:0">Redemption history<div class="sec-hd-line" style="min-width:40px;margin-left:8px"></div></div>
      <button class="btn btn-gold" onclick="addRedemption()" style="flex-shrink:0">+ Log redemption</button>
    </div>
    ${listHtml}`;

  if (rows.length > 0) {
    await loadAirports();
    initRedemptionMap(rows);
  }
}

function initRedemptionMap(rows) {
  const el = document.getElementById('redemption-map');
  if (!el || typeof L === 'undefined') return;

  if (redemptionMap) { redemptionMap.remove(); redemptionMap = null; }

  redemptionMap = L.map(el, {scrollWheelZoom:false, worldCopyJump:true}).setView([20, 30], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(redemptionMap);

  const bounds = [];
  const seenAirports = new Set();
  const cabinColors = {F:'rgb(151, 66, 50)', J:'rgb(37, 65, 97)', W:'rgb(31, 99, 122)', Y:'rgb(46, 112, 91)'};

  rows.forEach(r => {
    const stops = [r.origin, ...(r.via ? r.via.split(/\s+/) : []), r.destination].filter(Boolean);
    const coords = stops.map(airportLL).filter(Boolean);
    if (coords.length < 2) return; // need at least 2 known airports to draw a line

    const color = cabinColors[r.cabin] || '#6b7da8';
    L.polyline(coords, {color, weight: 2.2, opacity: 0.75, dashArray: r.one_way ? null : '6 4'}).addTo(redemptionMap)
      .bindPopup(`<strong>${stops.join(' → ')}</strong><br>${cabinBadge(r.cabin).replace(/<[^>]+>/g,'')} · ${fmt(r.miles_used)} mi${r.travel_date?' · '+new Date(r.travel_date+'T00:00:00').toLocaleDateString('en-SG',{month:'short',year:'numeric'}):''}`);
    coords.forEach(c => bounds.push(c));

    stops.forEach((code, i) => {
      const ll = airportLL(code);
      if (!ll || seenAirports.has(code)) return;
      seenAirports.add(code);
      L.circleMarker(ll, {radius:5, color:'#0d1a3a', fillColor:'#c8a46a', fillOpacity:1, weight:1.5}).addTo(redemptionMap)
        .bindPopup(`<strong>${code}</strong><br>${airportCity(code)}`);
    });
  });

  if (bounds.length > 0) {
    redemptionMap.fitBounds(bounds, {padding:[30,30], maxZoom:5});
  }
}

function redemptionModal(data) {
  const d = data || {};
  document.getElementById('modal-hd').innerHTML = d.id ? 'Edit Redemption' : 'Log Redemption';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">FFP Program</label>
        <select class="select-input" id="e-prog"><option value="">Select…</option>${ffpOptions(d.program_id||'')}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Travel date</label>
        <input class="form-input" type="date" id="e-date" value="${d.travel_date||''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Origin</label>
        <input class="form-input" type="text" id="e-origin" value="${d.origin||''}" placeholder="e.g. SIN" maxlength="4"
          style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase();updateAirportPreview('e-origin','origin-preview')">
        <div id="origin-preview" class="airport-preview"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Destination</label>
        <input class="form-input" type="text" id="e-dest" value="${d.destination||''}" placeholder="e.g. LHR" maxlength="4"
          style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase();updateAirportPreview('e-dest','dest-preview')">
        <div id="dest-preview" class="airport-preview"></div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Via <span style="font-weight:400;color:var(--sq-text-muted)">(optional, connections)</span></label>
        <input class="form-input" type="text" id="e-via" value="${d.via||''}" placeholder="e.g. NRT" maxlength="20"
          style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase()">
      </div>
      <div class="form-group">
        <label class="form-label">Cabin</label>
        <select class="select-input" id="e-cabin">${cabinOptions(d.cabin||'J')}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Miles used</label>
        <input class="form-input num-input" type="text" inputmode="numeric" id="e-miles" value="${fmt(d.miles_used||0)}"
          onfocus="if(parseNum(this.value)===0)this.value=''" onblur="if(this.value==='')this.value='0'">
      </div>
      <div class="form-group">
        <label class="form-label">Operating airline <span style="font-weight:400;color:var(--sq-text-muted)">(if different)</span></label>
        <input class="form-input" type="text" id="e-airline" value="${d.airline||''}" placeholder="e.g. Lufthansa">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Block time — hours <span style="font-weight:400;color:var(--sq-text-muted)">(optional)</span></label>
        <input class="form-input" type="number" id="e-bt-hours" value="${d.block_time_minutes ? Math.floor(d.block_time_minutes/60) : ''}" min="0" max="48" placeholder="e.g. 13">
      </div>
      <div class="form-group">
        <label class="form-label">Block time — minutes</label>
        <input class="form-input" type="number" id="e-bt-mins" value="${d.block_time_minutes ? d.block_time_minutes%60 : ''}" min="0" max="59" placeholder="e.g. 45">
      </div>
    </div>
    <div class="form-group">
      <div class="toggle-row">
        <label class="toggle"><input type="checkbox" id="e-oneway" ${d.id ? (d.one_way ? 'checked' : '') : 'checked'}><span class="toggle-slider"></span></label>
        <span style="font-size:13px;color:var(--sq-text-mid)">One-way redemption <span style="color:var(--sq-text-muted);font-weight:400">(uncheck for round-trip)</span></span>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <input class="form-input" type="text" id="e-notes" value="${d.notes||''}" placeholder="e.g. Saver award, SQ18, great meal">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" style="min-height:32px;display:block">Cash price if paid cash<br><span style="font-weight:400;color:var(--sq-text-muted)">(S$, optional)</span></label>
        <input class="form-input num-input" data-decimal="true" type="text" inputmode="decimal" id="e-cashvalue" value="${fmt(d.cash_value||0)}"
          onfocus="if(parseNum(this.value)===0)this.value=''" onblur="if(this.value==='')this.value='0'">
      </div>
      <div class="form-group">
        <label class="form-label" style="min-height:32px;display:block">Taxes & fees paid<br><span style="font-weight:400;color:var(--sq-text-muted)">(S$)</span></label>
        <input class="form-input num-input" data-decimal="true" type="text" inputmode="decimal" id="e-taxes" value="${fmt(d.taxes_fees||0)}"
          onfocus="if(parseNum(this.value)===0)this.value=''" onblur="if(this.value==='')this.value='0'">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" style="color:var(--sq-text-muted)">Effective value preview</label>
      <div class="ref-box" id="rdp-value-preview">Enter cash price to see savings vs your cost basis.</div>
    </div>`;

  function updateValuePreview() {
    const progId  = document.getElementById('e-prog').value;
    const miles   = Math.max(0, Math.round(parseNum(document.getElementById('e-miles').value)));
    const cashVal = Math.max(0, parseNum(document.getElementById('e-cashvalue').value));
    const taxes   = Math.max(0, parseNum(document.getElementById('e-taxes').value));
    const basis   = ST.costBasis[progId];
    const box     = document.getElementById('rdp-value-preview');
    if (!progId) { box.innerHTML = 'Select a program to see cost-basis value.'; return; }
    if (!basis || basis.cost_per_mile <= 0) {
      box.innerHTML = `No cost-basis data for this program yet. Add entries in the <strong>Cost Basis</strong> tab to see effective savings.`;
      return;
    }
    const milesCost  = miles * basis.cost_per_mile;
    const totalSpent = milesCost + taxes;
    box.innerHTML = `Miles cost ≈ $${fmt(milesCost)} <span style="color:var(--sq-text-muted)">(${miles.toLocaleString()}mi × ${(basis.cost_per_mile*100).toFixed(3)}¢)</span> + $${fmt(taxes)} taxes = <strong>$${fmt(totalSpent)}</strong> out-of-pocket`
      + (cashVal > 0 ? `<br><span style="color:${cashVal-totalSpent>=0?'var(--sq-ok)':'var(--sq-danger)'};font-weight:600">${cashVal-totalSpent>=0?'Saved':'Lost'} $${fmt(Math.abs(cashVal-totalSpent))}</span> vs $${fmt(cashVal)} cash price` : '');
  }
  setTimeout(() => {
    ['e-prog','e-miles','e-cashvalue','e-taxes'].forEach(id => {
      document.getElementById(id).addEventListener('input', updateValuePreview);
      document.getElementById(id).addEventListener('change', updateValuePreview);
    });
    updateValuePreview();
  }, 0);

  // Airport preview: kick off dataset load (cached after first call) and
  // refresh the origin/destination hints once it lands.
  loadAirports().then(() => {
    updateAirportPreview('e-origin', 'origin-preview');
    updateAirportPreview('e-dest', 'dest-preview');
  });
  updateAirportPreview('e-origin', 'origin-preview');
  updateAirportPreview('e-dest', 'dest-preview');

  onSave = async () => {
    const btn = document.getElementById('save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const origin = document.getElementById('e-origin').value.trim().toUpperCase();
      const dest   = document.getElementById('e-dest').value.trim().toUpperCase();
      const via    = document.getElementById('e-via').value.trim().toUpperCase();
      const routeStr = origin && dest ? [origin, via, dest].filter(Boolean).join('-') : (origin || dest || '');
      const btHours = Math.max(0, parseInt(document.getElementById('e-bt-hours').value)||0);
      const btMins  = Math.max(0, Math.min(59, parseInt(document.getElementById('e-bt-mins').value)||0));
      const payload = {
        program_id:  document.getElementById('e-prog').value,
        travel_date: document.getElementById('e-date').value,
        miles_used:  Math.max(0, Math.round(parseNum(document.getElementById('e-miles').value))),
        cabin:       document.getElementById('e-cabin').value,
        route:       routeStr,
        origin:      origin,
        destination: dest,
        via:         via,
        airline:     document.getElementById('e-airline').value,
        one_way:     document.getElementById('e-oneway').checked ? 1 : 0,
        notes:       document.getElementById('e-notes').value,
        cash_value:  Math.max(0, parseNum(document.getElementById('e-cashvalue').value)),
        taxes_fees:  Math.max(0, parseNum(document.getElementById('e-taxes').value)),
        block_time_minutes: btHours*60 + btMins,
      };
      if (d.id) {
        await apiFetch('/api/redemptions/'+d.id, {method:'PUT', body:JSON.stringify(payload)});
        showToast('Redemption updated ✓');
      } else {
        await apiFetch('/api/redemptions', {method:'POST', body:JSON.stringify(payload)});
        showToast('Redemption logged ✓');
      }
      closeModal();
      renderRedemptions();
    } catch(e) { showToast('Save failed: '+e.message, 3500); }
    finally { btn.disabled = false; btn.textContent = 'Save changes'; }
  };
  openModal();
}

function addRedemption() { redemptionModal(null); }

async function editRedemption(id) {
  try {
    const rows = await apiFetch('/api/redemptions');
    const row = rows.find(r => r.id === id);
    if (row) {
      // Backward-compat: derive origin/dest from legacy "SIN-LHR" or "SIN-NRT-LAX" route string
      if (!row.origin && !row.destination && row.route) {
        const parts = row.route.split('-').map(s => s.trim().toUpperCase()).filter(Boolean);
        if (parts.length >= 2) {
          row.origin = parts[0];
          row.destination = parts[parts.length-1];
          row.via = parts.slice(1, -1).join(' ');
        }
      }
      redemptionModal(row);
    }
  } catch(e) { showToast('Error loading redemption', 3000); }
}

async function deleteRedemption(id) {
  if (!confirm('Delete this redemption? This cannot be undone.')) return;
  try {
    await apiFetch('/api/redemptions/'+id, {method:'DELETE'});
    showToast('Redemption deleted');
    renderRedemptions();
  } catch(e) { showToast('Delete failed: '+e.message, 3500); }
}
