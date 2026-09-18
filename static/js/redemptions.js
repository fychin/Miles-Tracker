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
  const totalMi  = rows.reduce((s,r) => s + (r.miles_used||0) * (r.pax||1), 0);
  const totalBlockMinutes = rows.reduce((s,r) => s + (r.block_time_minutes||0), 0);
  const avgMiPerMin = totalBlockMinutes > 0 ? (totalMi / totalBlockMinutes) : null;
  // Broken down per cabin (F/J/W/Y) rather than one flat number — a single
  // "premium cabin count" or "avg mi/min" hides how differently each cabin
  // actually performs, and mixes seat count (a quantity) with efficiency
  // (a rate) into one misleading figure.
  const cabinStats = {};
  CABINS.forEach(c => { cabinStats[c.id] = {seats: 0, redemptions: 0, miSum: 0, minSum: 0}; });
  rows.forEach(r => {
    const stat = cabinStats[r.cabin];
    if (!stat) return;
    stat.seats += (r.pax||1);
    stat.redemptions += 1;
    if (r.block_time_minutes > 0) { stat.miSum += r.miles_used; stat.minSum += r.block_time_minutes; }
  });
  const premiumSeats = (cabinStats['F']?.seats||0) + (cabinStats['J']?.seats||0);
  // Weighted average ¢/mi realized across every redemption with a cash price
  // logged — cash_value and miles_used are both stored per-seat, so weighting
  // by (miles_used × pax) correctly reflects redemptions of different party
  // sizes without letting a single big multi-seat trip get double-counted
  // per passenger in a naive average.
  let valuedCashSum = 0, valuedMilesSum = 0;
  rows.forEach(r => {
    if (r.cash_value > 0 && r.miles_used > 0) {
      const pax = r.pax || 1;
      valuedCashSum  += r.cash_value * pax;
      valuedMilesSum += r.miles_used * pax;
    }
  });
  const avgValuePerMile = valuedMilesSum > 0 ? (valuedCashSum / valuedMilesSum * 100) : null;

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
        const tripTypeLabel = r.one_way ? 'One-way' : 'Round-trip';
        const pax = r.pax || 1;
        const blockTimeLabel = fmtBlockTime(r.block_time_minutes);
        const mpm = r.block_time_minutes > 0 ? (r.miles_used / r.block_time_minutes) : null; // per-seat efficiency, unaffected by pax
        const basis = ST.costBasis[r.program_id];
        const cpm = basis && basis.cost_per_mile > 0 ? basis.cost_per_mile : null;
        const milesCostPerSeat = cpm !== null ? r.miles_used * cpm : null;
        const totalSpentPerSeat = milesCostPerSeat !== null ? milesCostPerSeat + (r.taxes_fees||0) : null;
        const groupTotalSpent = totalSpentPerSeat !== null ? totalSpentPerSeat * pax : null;
        const groupCashValue = (r.cash_value||0) * pax;
        const savings = (groupTotalSpent !== null && groupCashValue > 0) ? groupCashValue - groupTotalSpent : null;
        // ¢/mi actually realized by this redemption — cash price it would've
        // cost ÷ miles spent, both already per-seat. Deliberately NOT called
        // "cpm" anywhere in code or UI: this app's own Cost Basis tab already
        // uses that term for the opposite direction (¢/mi you paid to
        // *acquire* the miles), and reusing it here would be exactly the kind
        // of unit-conflation this app exists to avoid.
        const valuePerMile = (r.cash_value > 0 && r.miles_used > 0) ? (r.cash_value / r.miles_used * 100) : null;
        const valueMultiple = (valuePerMile !== null && cpm !== null) ? (valuePerMile / (cpm*100)) : null;

        // Secondary, de-emphasized details — everything that isn't part of
        // the cabin/mi-min/value-per-mile comparison row gets collapsed into
        // one small muted line instead of competing for attention with it.
        // Notes are kept off this line deliberately — free-text length varies
        // a lot and mixing it with short fixed-format badges is what made the
        // line read as cramped/uneven; it gets its own quiet line instead.
        const secondaryBits = [];
        if (dtLabel) secondaryBits.push(dtLabel);
        secondaryBits.push(tripTypeLabel);
        if (pax > 1) secondaryBits.push(`${pax} seats`);
        if (blockTimeLabel) secondaryBits.push(`✈ ${blockTimeLabel}`);
        if (r.airline && r.airline !== (prog?.airline||'')) secondaryBits.push(r.airline);

        let valueLine = '';
        if (r.cash_value > 0) {
          if (savings !== null) {
            const pct = groupCashValue > 0 ? (savings / groupCashValue * 100) : 0;
            const savCls = savings >= 0 ? 'c-ok' : 'c-danger';
            valueLine = `<div class="rdp-meta">
              <span class="${savCls}" style="font-weight:600">${savings>=0?'Saved':'Lost'} $${fmt(Math.abs(savings))}</span>
              <span>vs cash $${fmt(groupCashValue)}${pax>1?` (${pax} seats)`:''} (${pct.toFixed(0)}% ${savings>=0?'off':'over'}) · ≈$${fmt(groupTotalSpent)} cost${pax>1?' total':''}</span>
            </div>`;
          } else {
            valueLine = `<div class="rdp-meta"><span style="color:var(--sq-text-muted)">Cash price $${fmt(groupCashValue)}${pax>1?` (${pax} seats)`:''} · add cost-basis entries for ${prog?.name||r.program_id} to see savings</span></div>`;
          }
        }
        listHtml += `<div class="rdp-card" style="border-left-color:${cabinColor(r.cabin)}">
          <div class="rdp-logo-col">
            <div class="rdp-logo">${prog ? logoImg(prog.logo, prog.code, 24) : '<span style="font-size:9px;color:var(--sq-text-muted)">?</span>'}</div>
            <div class="rdp-logo-label">${prog?.name || r.program_id}</div>
          </div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
            <div class="rdp-route">${routeDisplay}</div>
            <div class="rdp-compare-row">
              ${cabinBadge(r.cabin, true)}
              ${mpm !== null ? `<span class="mpm-pill" title="Miles used ÷ scheduled block (gate-to-gate) minutes for this flight — a rough way to compare miles 'spent per minute of flying' across redemptions of different lengths and cabins. Per seat — unaffected by how many seats were booked. Higher isn't automatically worse: a long-haul First seat will show a high mi/min next to a short Economy hop, since both the miles and the minutes scale together.">${mpm.toFixed(2)} mi/min</span>` : ''}
              ${valuePerMile !== null ? `<span class="value-pill" title="Cash price ÷ miles used, per seat — what each mile was actually worth on this redemption.${valueMultiple !== null ? ` That's ${valueMultiple.toFixed(1)}× your ${(cpm*100).toFixed(2)}¢/mi cost basis for these miles.` : ''}">${valuePerMile.toFixed(2)}¢/mi value</span>` : ''}
            </div>
            <div class="rdp-meta">${secondaryBits.join(' <span class="rdp-dot">·</span> ')}</div>
            ${r.notes ? `<div class="rdp-notes">${r.notes}</div>` : ''}
            ${valueLine}
          </div>
          <div class="rdp-miles">${fmt(r.miles_used)} <span style="font-weight:400;font-size:11px;color:var(--sq-text-muted)">mi</span></div>
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
        <div class="metric-value">${premiumSeats}</div>
        <div class="metric-sub" style="display:flex;gap:8px;flex-wrap:wrap">
          ${['F','J','W'].map(c => cabinStats[c]?.seats > 0 ? `<span><span class="cabin-badge cabin-${c}" style="padding:1px 5px;font-size:8.5px">${c}</span> ${cabinStats[c].seats}</span>` : '').filter(Boolean).join('') || 'No F/J/W seats yet'}
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg miles / min</div>
        <div class="metric-value">${avgMiPerMin !== null ? avgMiPerMin.toFixed(2) : '—'}</div>
        <div class="metric-sub" style="display:flex;gap:8px;flex-wrap:wrap" title="Per-cabin average of miles used ÷ block minutes — a rate, not affected by how many seats you booked on a redemption.">
          ${CABINS.map(c => {
            const s = cabinStats[c.id];
            if (!s || s.minSum <= 0) return '';
            return `<span><span class="cabin-badge cabin-${c.id}" style="padding:1px 5px;font-size:8.5px">${c.id}</span> ${(s.miSum/s.minSum).toFixed(2)}</span>`;
          }).filter(Boolean).join('') || 'No block time logged yet'}
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg value/mi</div>
        <div class="metric-value gold">${avgValuePerMile !== null ? avgValuePerMile.toFixed(2)+'¢' : '—'}</div>
        <div class="metric-sub" title="Weighted by miles used across every redemption with a cash price logged — cash price ÷ miles, not your acquisition cost basis.">${valuedMilesSum > 0 ? 'Cash price ÷ miles, weighted' : 'Log a cash price to see this'}</div>
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

  rows.forEach(r => {
    const stops = [r.origin, ...(r.via ? r.via.split(/\s+/) : []), r.destination].filter(Boolean);
    const coords = stops.map(airportLL).filter(Boolean);
    if (coords.length < 2) return; // need at least 2 known airports to draw a line

    const color = cabinColor(r.cabin);
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
    <div class="form-row-3">
      <div class="form-group">
        <label class="form-label">Miles used <span style="font-weight:400;color:var(--sq-text-muted)">(per seat)</span></label>
        <input class="form-input num-input" type="text" inputmode="numeric" id="e-miles" value="${fmt(d.miles_used||0)}"
          onfocus="if(parseNum(this.value)===0)this.value=''" onblur="if(this.value==='')this.value='0'">
      </div>
      <div class="form-group">
        <label class="form-label">Seats <span style="font-weight:400;color:var(--sq-text-muted)">(same rate each)</span></label>
        <input class="form-input" type="number" id="e-pax" value="${d.pax||1}" min="1" max="20" step="1">
      </div>
      <div class="form-group">
        <label class="form-label">Operating airline</label>
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
        <label class="form-label" style="min-height:32px;display:block">Cash price if paid cash<br><span style="font-weight:400;color:var(--sq-text-muted)">(S$ per seat, optional)</span></label>
        <input class="form-input num-input" data-decimal="true" type="text" inputmode="decimal" id="e-cashvalue" value="${fmt(d.cash_value||0)}"
          onfocus="if(parseNum(this.value)===0)this.value=''" onblur="if(this.value==='')this.value='0'">
      </div>
      <div class="form-group">
        <label class="form-label" style="min-height:32px;display:block">Taxes & fees paid<br><span style="font-weight:400;color:var(--sq-text-muted)">(S$ per seat)</span></label>
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
    const pax     = Math.max(1, parseInt(document.getElementById('e-pax').value)||1);
    const basis   = ST.costBasis[progId];
    const box     = document.getElementById('rdp-value-preview');
    if (!progId) { box.innerHTML = 'Select a program to see cost-basis value.'; return; }
    if (!basis || basis.cost_per_mile <= 0) {
      box.innerHTML = `No cost-basis data for this program yet. Add entries in the <strong>Cost Basis</strong> tab to see effective savings.`;
      return;
    }
    const milesCost  = miles * basis.cost_per_mile;
    const totalSpent = milesCost + taxes; // per-seat
    const paxNote = pax > 1 ? ` <span class="text-muted">× ${pax} seats</span>` : '';
    let html = `Per seat: miles cost ≈ $${fmt(milesCost)} <span style="color:var(--sq-text-muted)">(${miles.toLocaleString()}mi × ${(basis.cost_per_mile*100).toFixed(3)}¢)</span> + $${fmt(taxes)} taxes = <strong>$${fmt(totalSpent)}</strong>${paxNote}`;
    if (pax > 1) {
      html += `<br>Group total (${pax} seats): <strong>$${fmt(totalSpent*pax)}</strong> out-of-pocket`;
    }
    if (cashVal > 0) {
      const groupSavings = (cashVal - totalSpent) * pax;
      html += `<br><span style="color:${groupSavings>=0?'var(--sq-ok)':'var(--sq-danger)'};font-weight:600">${groupSavings>=0?'Saved':'Lost'} $${fmt(Math.abs(groupSavings))}</span> vs $${fmt(cashVal*pax)} cash price${pax>1?' for all seats':''}`;
    }
    box.innerHTML = html;
  }
  setTimeout(() => {
    ['e-prog','e-miles','e-cashvalue','e-taxes','e-pax'].forEach(id => {
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
        pax: Math.max(1, parseInt(document.getElementById('e-pax').value)||1),
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
