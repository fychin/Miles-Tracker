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
  CABINS.forEach(c => { cabinStats[c.id] = {seats: 0, redemptions: 0, miSum: 0, minSum: 0, costSum: 0, costSeats: 0, netValueSum: 0, netMilesSum: 0}; });
  rows.forEach(r => {
    const stat = cabinStats[r.cabin];
    if (!stat) return;
    const pax = r.pax || 1;
    stat.seats += pax;
    stat.redemptions += 1;
    if (r.block_time_minutes > 0) { stat.miSum += r.miles_used; stat.minSum += r.block_time_minutes; }
    const basis = ST.costBasis[r.program_id];
    const cpm = basis && basis.cost_per_mile > 0 ? basis.cost_per_mile : null;
    if (cpm !== null) {
      stat.costSum += (r.miles_used * cpm + (r.taxes_fees||0)) * pax;
      stat.costSeats += pax;
    }
    // Weighted by miles (a rate metric, like mi/min) rather than a naive
    // per-redemption average — a big multi-seat trip should count for its
    // actual share of miles, not get the same single "vote" as a tiny one.
    const personalValue = r.cash_fare_benchmark > 0 ? r.cash_fare_benchmark * (r.wtp_multiplier||1) : (r.cash_value||0);
    if (personalValue > 0 && r.miles_used > 0) {
      stat.netValueSum += (personalValue - (r.taxes_fees||0)) * pax;
      stat.netMilesSum += r.miles_used * pax;
    }
  });
  const grandTotalCost = CABINS.reduce((s,c) => s + cabinStats[c.id].costSum, 0);
  const anyCostKnown = CABINS.some(c => cabinStats[c.id].costSeats > 0);
  const grandNetValue = CABINS.reduce((s,c) => s + cabinStats[c.id].netValueSum, 0);
  const grandNetMiles = CABINS.reduce((s,c) => s + cabinStats[c.id].netMilesSum, 0);
  const avgValuePerMile = grandNetMiles > 0 ? (grandNetValue / grandNetMiles * 100) : null;

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
        // Personal value = a real, comparable cash fare benchmark × how many
        // times more you'd genuinely have paid for this specific cabin/
        // experience — deliberately not the premium cabin's own rack-rate
        // fare, which is routinely inflated and makes every redemption look
        // artificially "worth" more than it realistically was to you.
        // Redemptions logged before this model existed only have a flat
        // cash_value; treat that as benchmark×1 rather than losing the data.
        const personalValue = r.cash_fare_benchmark > 0 ? r.cash_fare_benchmark * (r.wtp_multiplier||1) : (r.cash_value||0);
        const groupCashValue = personalValue * pax;
        const savings = (groupTotalSpent !== null && groupCashValue > 0) ? groupCashValue - groupTotalSpent : null;
        // ¢/mi actually realized by this redemption — personal value net of
        // taxes, ÷ miles spent, both already per-seat. Deliberately NOT
        // called "cpm" anywhere in code or UI: this app's own Cost Basis tab
        // already uses that term for the opposite direction (¢/mi you paid
        // to *acquire* the miles), and reusing it here would be exactly the
        // kind of unit-conflation this app exists to avoid.
        const valuePerMile = (personalValue > 0 && r.miles_used > 0) ? ((personalValue - (r.taxes_fees||0)) / r.miles_used * 100) : null;
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

        let costPill = '';
        let costBreakdown = '';
        if (cpm !== null) {
          // Round the two parts first, then sum the rounded parts for the
          // pill total — rounding the precise total independently can make
          // "$454 + $80" appear to equal "$533" instead of "$534" purely
          // from display rounding, which reads as a math error even though
          // the underlying (unrounded) figures used for savings elsewhere
          // are exact.
          const milesCostDisp = Math.round(milesCostPerSeat);
          const taxesDisp = Math.round(r.taxes_fees||0);
          const totalDisp = milesCostDisp + taxesDisp;
          costPill = `<span class="cost-pill" title="${pax>1?`$${fmt(totalDisp*pax)} total for ${pax} seats`:'Per seat'}">Cost $${fmt(totalDisp)}</span>`;
          costBreakdown = `<span class="rdp-cost-breakdown">$${fmt(milesCostDisp)} miles + $${fmt(taxesDisp)} taxes =</span>`;
        } else if (r.taxes_fees > 0) {
          costPill = `<span class="cost-pill cost-pill-muted" title="Taxes only — add cost-basis entries for ${prog?.name||r.program_id} to see the full cost">Cost $${fmt(r.taxes_fees)}</span>`;
          costBreakdown = `<span class="rdp-cost-breakdown">taxes only, no miles-cost data</span>`;
        }
        let valueLine = '';
        if (personalValue > 0) {
          if (savings !== null) {
            const pct = groupCashValue > 0 ? (savings / groupCashValue * 100) : 0;
            const savCls = savings >= 0 ? 'c-ok' : 'c-danger';
            valueLine = `<div style="display:flex;justify-content:flex-end;align-items:center;gap:5px;flex-wrap:wrap;font-size:10px;text-align:right">
              <span class="${savCls}" style="font-weight:600">${savings>=0?'Saved':'Lost'} $${fmt(Math.abs(savings))}</span>
              <span style="color:var(--sq-text-muted)">vs $${fmt(groupCashValue)} value${pax>1?` (${pax} seats)`:''} (${pct.toFixed(0)}% ${savings>=0?'off':'over'})</span>
            </div>`;
          } else {
            valueLine = `<div style="font-size:10px;color:var(--sq-text-muted);text-align:right">$${fmt(groupCashValue)} value${pax>1?` (${pax} seats)`:''} · add cost-basis entries for ${prog?.name||r.program_id} to see savings</div>`;
          }
        }
        listHtml += `<div class="rdp-card" style="border-left-color:${cabinColor(r.cabin)}">
          <div class="rdp-logo-col">
            <div class="rdp-logo">${prog ? logoImg(prog.logo, prog.code, 30) : '<span style="font-size:10px;color:var(--sq-text-muted)">?</span>'}</div>
            <div class="rdp-logo-label">${prog?.name || r.program_id}</div>
          </div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
            <div class="rdp-route">${routeDisplay}</div>
            <div class="rdp-compare-row">
              ${cabinBadge(r.cabin, true)}
              ${mpm !== null ? `<span class="mpm-pill" title="Miles used ÷ scheduled block (gate-to-gate) minutes for this flight — a rough way to compare miles 'spent per minute of flying' across redemptions of different lengths and cabins. Per seat — unaffected by how many seats were booked. Higher isn't automatically worse: a long-haul First seat will show a high mi/min next to a short Economy hop, since both the miles and the minutes scale together.">${mpm.toFixed(2)} mi/min</span>` : ''}
              ${valuePerMile !== null ? `<span class="value-pill" title="Personal value (estimated cash fare × WTP multiplier) minus taxes, ÷ miles used, per seat — what each mile was actually worth to you on this redemption.${valueMultiple !== null ? ` That's ${valueMultiple.toFixed(1)}× your ${(cpm*100).toFixed(2)}¢/mi cost basis for these miles.` : ''}">${valuePerMile.toFixed(2)}¢/mi value</span>` : ''}
            </div>
            <div class="rdp-meta">${secondaryBits.join(' <span class="rdp-dot">·</span> ')}</div>
            ${r.notes ? `<div class="rdp-notes">${r.notes}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
            <div class="rdp-miles">${fmt(r.miles_used)} <span style="font-weight:400;font-size:13px;color:var(--sq-text-muted)">mi</span></div>
            <div style="display:flex;align-items:baseline;gap:5px">${costBreakdown}${costPill}</div>
            ${valueLine}
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
        <div class="metric-sub" style="display:flex;gap:8px;flex-wrap:wrap">
          ${['F','J','W'].map(c => cabinStats[c]?.seats > 0 ? `<span><span class="cabin-badge cabin-${c}" style="padding:1px 5px;font-size:8.5px">${c}</span> ${cabinStats[c].seats}</span>` : '').filter(Boolean).join('') || 'No F/J/W seats yet'}
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg value/mi</div>
        <div class="metric-value">${avgValuePerMile !== null ? avgValuePerMile.toFixed(2)+'¢' : '—'}</div>
        <div class="metric-sub" style="display:flex;gap:8px;flex-wrap:wrap" title="Weighted by miles used across every redemption with an estimated cash fare logged — (personal value − taxes) ÷ miles, not your acquisition cost basis.">
          ${CABINS.map(c => {
            const s = cabinStats[c.id];
            if (!s || s.netMilesSum <= 0) return '';
            return `<span><span class="cabin-badge cabin-${c.id}" style="padding:1px 5px;font-size:8.5px">${c.id}</span> ${(s.netValueSum/s.netMilesSum*100).toFixed(2)}¢</span>`;
          }).filter(Boolean).join('') || 'No cash fare logged yet'}
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
        <div class="metric-label">Total cost</div>
        <div class="metric-value gold">${anyCostKnown ? '$'+fmt(grandTotalCost) : '—'}</div>
        <div class="metric-sub" style="display:flex;gap:8px;flex-wrap:wrap" title="Miles cost basis + taxes/fees, summed across all seats — only counts redemptions in programs with cost-basis data logged.">
          ${CABINS.map(c => {
            const s = cabinStats[c.id];
            if (!s || s.costSeats <= 0) return '';
            return `<span><span class="cabin-badge cabin-${c.id}" style="padding:1px 5px;font-size:8.5px">${c.id}</span> $${fmt(s.costSum)}</span>`;
          }).filter(Boolean).join('') || 'No cost-basis data yet'}
        </div>
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
    // opacity was 0.75 — alpha-blending a dark navy like J's rgb(37,65,97)
    // over light map tiles visibly shifts its hue toward gray, so it read as
    // a different blue than the solid color shown in the cabin badge
    // elsewhere. Near-opaque keeps the rendered line true to that color.
    L.polyline(coords, {color, weight: 2.6, opacity: 0.95, dashArray: r.one_way ? null : '6 4'}).addTo(redemptionMap)
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
  // Back-compat: redemptions logged before the benchmark/multiplier model
  // existed only have a flat cash_value. Treat that as benchmark×1 so
  // editing an old entry doesn't show blank/zero fields.
  const legacyBenchmark  = d.cash_fare_benchmark > 0 ? d.cash_fare_benchmark : (d.cash_value || 0);
  const legacyMultiplier = d.cash_fare_benchmark > 0 ? (d.wtp_multiplier || 1) : 1;
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
        <label class="form-label">Estimated cash fare <span class="info-icon" title="The conservative cash price for a baseline flight (Economy, or Premium Economy if Economy isn't offered) on the same route and period.">ⓘ</span></label>
        <input class="form-input num-input" data-decimal="true" type="text" inputmode="decimal" id="e-cashbench" value="${legacyBenchmark.toFixed(2)}"
          onfocus="if(parseNum(this.value)===0)this.value=''" onblur="if(this.value==='')this.value='0'">
      </div>
      <div class="form-group">
        <label class="form-label">WTP multiplier <span class="info-icon" title="Personal premium applied to the cash benchmark to estimate your value of the redeemed cabin.&#10;E.g. Economy 1.0×, Business 1.75–2.0×, Ultra Long-Haul Business 2.5×, Suites 3.0×">ⓘ</span></label>
        <input class="form-input num-input" data-decimal="true" type="text" inputmode="decimal" id="e-wtpmult" value="${legacyMultiplier.toFixed(2)}"
          onfocus="if(parseNum(this.value)===0)this.value=''" onblur="if(this.value==='')this.value='0'">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Taxes & fees paid <span style="font-weight:400;color:var(--sq-text-muted)">(S$/seat)</span></label>
      <input class="form-input num-input" data-decimal="true" type="text" inputmode="decimal" id="e-taxes" value="${(d.taxes_fees||0).toFixed(2)}"
        onfocus="if(parseNum(this.value)===0)this.value=''" onblur="if(this.value==='')this.value='0'">
    </div>
    <div class="form-group">
      <label class="form-label" style="color:var(--sq-text-muted)">Effective value preview</label>
      <div class="ref-box" id="rdp-value-preview">Enter an estimated cash fare to see personal value and ¢/mi.</div>
    </div>`;

  function updateValuePreview() {
    const progId    = document.getElementById('e-prog').value;
    const miles     = Math.max(0, Math.round(parseNum(document.getElementById('e-miles').value)));
    const benchmark = Math.max(0, parseNum(document.getElementById('e-cashbench').value));
    const multiplier= Math.max(0, parseNum(document.getElementById('e-wtpmult').value));
    const taxes     = Math.max(0, parseNum(document.getElementById('e-taxes').value));
    const pax       = Math.max(1, parseInt(document.getElementById('e-pax').value)||1);
    const basis     = ST.costBasis[progId];
    const box       = document.getElementById('rdp-value-preview');
    const personalValue = benchmark * multiplier;

    let html = '';
    if (benchmark > 0) {
      html += `Personal value: $${fmt(benchmark)} <span style="color:var(--sq-text-muted)">estimated fare</span> × ${multiplier.toFixed(2)}× = <strong>$${fmt(personalValue)}</strong> per seat`;
      if (miles > 0) {
        const cpm = (personalValue - taxes) / miles * 100;
        html += `<br>Personal CPM: <strong>${cpm.toFixed(2)}¢/mi</strong> <span style="color:var(--sq-text-muted)">(($${fmt(personalValue)} − $${fmt(taxes)} taxes) ÷ ${miles.toLocaleString()}mi)</span>`;
      }
    }
    if (!progId) {
      box.innerHTML = html || 'Select a program to see cost-basis value.';
      return;
    }
    if (!basis || basis.cost_per_mile <= 0) {
      box.innerHTML = (html ? html+'<br>' : '') + `No cost-basis data for this program yet. Add entries in the <strong>Cost Basis</strong> tab to see effective savings.`;
      return;
    }
    const milesCost  = miles * basis.cost_per_mile;
    const totalSpent = milesCost + taxes; // per-seat
    const paxNote = pax > 1 ? ` <span class="text-muted">× ${pax} seats</span>` : '';
    html += `${html?'<br>':''}Per seat: miles cost ≈ $${fmt(milesCost)} <span style="color:var(--sq-text-muted)">(${miles.toLocaleString()}mi × ${(basis.cost_per_mile*100).toFixed(3)}¢)</span> + $${fmt(taxes)} taxes = <strong>$${fmt(totalSpent)}</strong>${paxNote}`;
    if (pax > 1) {
      html += `<br>Group total (${pax} seats): <strong>$${fmt(totalSpent*pax)}</strong> out-of-pocket`;
    }
    if (personalValue > 0) {
      const groupSavings = (personalValue - totalSpent) * pax;
      html += `<br><span style="color:${groupSavings>=0?'var(--sq-ok)':'var(--sq-danger)'};font-weight:600">${groupSavings>=0?'Saved':'Lost'} $${fmt(Math.abs(groupSavings))}</span> vs $${fmt(personalValue*pax)} value${pax>1?' for all seats':''}`;
    }
    box.innerHTML = html;
  }
  setTimeout(() => {
    ['e-prog','e-miles','e-cashbench','e-wtpmult','e-taxes','e-pax'].forEach(id => {
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
        cash_fare_benchmark: Math.max(0, parseNum(document.getElementById('e-cashbench').value)),
        wtp_multiplier:      Math.max(0, parseNum(document.getElementById('e-wtpmult').value)),
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
