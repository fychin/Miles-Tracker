/* ── Cost Basis tab ──────────────────────────────────────────── */
let costBasisShowLiveOnly = false;

async function renderCostBasis() {
  const pane = document.getElementById('pane-costbasis');
  pane.innerHTML = '<div style="color:var(--sq-text-muted);padding:2rem 0;font-size:13px">Loading…</div>';
  let entries = [], basisMap = {};
  try {
    [entries, basisMap] = await Promise.all([apiFetch('/api/cost-entries'), apiFetch('/api/cost-basis')]);
    ST.costBasis = basisMap || {};
  } catch(e) {
    pane.innerHTML = `<div class="api-banner"><span class="api-dot err"></span>Could not load cost basis. Is the server running?</div>`;
    return;
  }

  const idealCpm = Number(ST.settings?.ideal_cpm) || 0;
  // Green when a rate is at/under your target valuation (good value), red when it exceeds it (expensive).
  const cpmCls = cpmCents => idealCpm > 0 && cpmCents > 0 ? (cpmCents <= idealCpm ? 'c-ok' : 'c-danger') : '';

  const totalCost  = Object.values(basisMap).reduce((s,b) => s + (b.total_cost||0), 0);
  const totalMiles = Object.values(basisMap).reduce((s,b) => s + (b.total_miles||0), 0);
  const blendedCpm = totalMiles > 0 ? totalCost / totalMiles : 0;
  const progsCovered = Object.keys(basisMap).length;
  const cheapest = Object.entries(basisMap).filter(([,b]) => b.cost_per_mile > 0).sort((a,b) => a[1].cost_per_mile - b[1].cost_per_mile)[0];

  let listHtml = '';
  if (entries.length === 0) {
    listHtml = `<div class="empty-state">
      <div class="empty-state-icon">$</div>
      <div style="font-size:14px;font-weight:500;color:var(--sq-text-mid)">No cost entries logged yet</div>
      <div style="font-size:12px;margin-top:6px">Log what you actually paid for miles — annual fees, spend requirements, cash top-ups, transfer costs — to see your real ¢/mile per program.</div>
    </div>`;
  } else {
    // Group by program
    const byProg = {};
    entries.forEach(e => { (byProg[e.program_id] = byProg[e.program_id]||[]).push(e); });
    const progIds = Object.keys(byProg).sort((a,b) => progLabel(a).localeCompare(progLabel(b)));
    let anyProgramShown = false;
    progIds.forEach(progId => {
      // "Live only" hides fully-consumed lots (status === 'consumed') — the ones
      // that have been entirely transferred elsewhere and are pure audit trail.
      // Partially-consumed lots still show, since part of their balance is live.
      const rows = costBasisShowLiveOnly
        ? byProg[progId].filter(e => e.status !== 'consumed')
        : byProg[progId];
      if (rows.length === 0) return; // whole program has nothing live to show under this filter
      anyProgramShown = true;
      const basis = basisMap[progId];
      const pillCents = basis ? basis.cost_per_mile*100 : 0;
      const pillCls = basis ? cpmCls(pillCents) : '';
      listHtml += `<div class="sec-hd" style="display:flex;align-items:center;gap:8px">
        <div style="width:20px;height:20px;border-radius:4px;overflow:hidden;background:#fff;display:flex;align-items:center;justify-content:center;border:0.5px solid var(--sq-border)">${logoImg(progLogoUrl(progId), progId.slice(0,2).toUpperCase(), 20)}</div>
        ${progLabel(progId)}
        ${basis ? `<span class="basis-pill${pillCls==='c-danger'?' over-ideal':''}">${pillCents.toFixed(3)}¢/mi blended · ${fmt(basis.remaining_miles)} mi live</span>` : ''}
        <div class="sec-hd-line"></div>
      </div>
      <div class="card mb-16"><table class="tbl">
        <thead><tr><th>Date</th><th>Type</th><th>Source</th><th style="text-align:right">Miles/pts</th><th style="text-align:right">Cost (S$)</th><th style="text-align:right">¢/mi</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          ${rows.map(e => {
            const cpm = e.miles_acquired > 0 ? (e.cost_sgd / e.miles_acquired * 100) : 0;
            const dt = e.entry_date ? new Date(e.entry_date+'T00:00:00').toLocaleDateString('en-SG',{day:'numeric',month:'short',year:'numeric'}) : '—';
            const consumed = e.miles_acquired - e.remaining_miles;
            const isXfer = e.entry_type === 'transfer';
            const typePill = isXfer ? `<span class="entry-type-pill xfer">Transfer</span>` : `<span class="entry-type-pill acq">Acquisition</span>`;
            const statusNote = consumed > 0
              ? `<div class="entry-type-pill consumed" style="margin-top:3px;display:inline-block">${fmt(consumed)}mi transferred out</div>`
              : '';
            const actions = isXfer
              ? `<button class="btn btn-sm" onclick="viewCostTransfer(${e.id})">Breakdown</button>
                 <button class="btn btn-sm" style="color:var(--sq-danger);border-color:rgba(153,28,28,.3)" onclick="deleteCostTransfer(${e.id})">Undo</button>`
              : `<button class="btn btn-sm" onclick="editCostEntry(${e.id})">Edit</button>
                 <button class="btn btn-sm" style="color:var(--sq-danger);border-color:rgba(153,28,28,.3)" onclick="deleteCostEntry(${e.id})">Del</button>`;
            return `<tr>
              <td class="text-sm text-muted">${dt}</td>
              <td>${typePill}</td>
              <td style="font-weight:500">${e.source||'—'}${statusNote}</td>
              <td style="text-align:right" class="mono">${fmt(e.miles_acquired)}</td>
              <td style="text-align:right" class="mono">${e.cost_sgd.toFixed(2)}</td>
              <td style="text-align:right;font-weight:${cpmCls(cpm)?'600':'400'}" class="mono ${cpmCls(cpm)}">${cpm.toFixed(3)}¢</td>
              <td class="text-sm text-muted" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.notes||''}</td>
              <td style="white-space:nowrap">${actions}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;
    });
    if (!anyProgramShown) {
      listHtml = `<div class="empty-state">
        <div style="font-size:13px;color:var(--sq-text-mid)">No live lots right now — everything's been transferred elsewhere.</div>
        <div style="font-size:12px;margin-top:6px">Switch to "All" to see the full history, including consumed lots.</div>
      </div>`;
    }
  }

  pane.innerHTML = `
    ${apiBanner()}
    <div class="grid4" style="margin-bottom:1.25rem">
      <div class="metric-card">
        <div class="metric-label">Blended cost / mile</div>
        <div class="metric-value gold" style="${cpmCls(blendedCpm*100)==='c-ok'?'color:#7fdb94':cpmCls(blendedCpm*100)==='c-danger'?'color:#f08080':''}">${blendedCpm > 0 ? (blendedCpm*100).toFixed(3)+'¢' : '—'}</div>
        <div class="metric-sub" title="Each cost entry is a "lot" — miles/points you acquired at a known cost. When you transfer a lot elsewhere, it's removed from its original program's blend so it isn't counted twice. This number only reflects lots — or the still-unconsumed part of a lot — that haven't been transferred away.">Cost of what you still hold (transferred-out miles don't count here)</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total spent acquiring</div>
        <div class="metric-value">$${fmt(totalCost)}</div>
        <div class="metric-sub">${fmt(totalMiles)} mi/pts, all-time gross</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Programs tracked</div>
        <div class="metric-value">${progsCovered}</div>
        <div class="metric-sub">${entries.length} cost entr${entries.length!==1?'ies':'y'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Cheapest program</div>
        <div class="metric-value" style="font-size:16px">${cheapest ? progLookup(cheapest[0])?.code || progLabel(cheapest[0]) : '—'}</div>
        <div class="metric-sub">${cheapest ? (cheapest[1].cost_per_mile*100).toFixed(3)+'¢/mi' : 'No data yet'}</div>
      </div>
    </div>
    <div class="card mb-16" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:.85rem 1rem">
      <label class="form-label" style="margin:0;white-space:nowrap" title="What you personally consider a mile worth. Rates at or below this are shown in green (good value); rates above it are shown in red (overpaying).">Target valuation</label>
      <div style="display:flex;align-items:center;gap:5px">
        <input class="form-input num-input" data-decimal="true" type="text" inputmode="decimal" id="ideal-cpm-input"
          value="${idealCpm.toFixed(3)}" style="width:90px;text-align:right"
          onfocus="if(parseNum(this.value)===0)this.value=''" onblur="if(this.value==='')this.value='0'">
        <span class="text-muted text-sm">¢/mile</span>
      </div>
      <button class="btn btn-sm" onclick="saveIdealCpm()">Save</button>
      <span class="text-muted text-sm" style="flex:1;min-width:180px">Cost-basis rates ≤ your target show <span class="c-ok" style="font-weight:600">green</span>; rates over it show <span class="c-danger" style="font-weight:600">red</span>.</span>
    </div>
    <div class="help-note mb-16">
      <strong>How cost basis works, in short:</strong>
      <ul style="margin:6px 0 0 18px;padding:0">
        <li style="margin-bottom:4px"><strong>A "lot"</strong> = one cost entry, i.e. one specific batch of points/miles you got at a specific cost (e.g. one year's card fee, one tax payment).</li>
        <li style="margin-bottom:4px"><strong>Log cost entry</strong> when money left your pocket and points/miles landed directly in an account — annual fees, minimum-spend bonuses, cash-buy promos, or a card-processing fee on a tax payment. Log it under whatever currency you actually received (e.g. "DBS Points", not "KrisFlyer" — even if you plan to transfer it out later).</li>
        <li style="margin-bottom:4px"><strong>Log transfer</strong> when you move points/miles you've already logged into a different program (e.g. DBS Points → KrisFlyer). This carries the original cost forward with the miles and splits any transfer fee across the sources — it does <em>not</em> create new cost, so you avoid paying for the same dollar twice.</li>
        <li>Once a lot is transferred out, its balance drops to 0 there and it stops counting toward that program's blended rate — the cost basis "moves" with the miles to the destination program.</li>
      </ul>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="sec-hd" style="margin:0">Cost entries<div class="sec-hd-line" style="min-width:40px;margin-left:8px"></div></div>
        <div style="display:flex;gap:2px;background:var(--sq-navy-light);border-radius:6px;padding:2px;flex-shrink:0" title="Live only hides lots that have been fully transferred elsewhere (0 remaining) — pure audit-trail noise for day-to-day use.">
          <button class="btn btn-sm" style="${!costBasisShowLiveOnly?'background:var(--sq-navy);color:#fff;':'background:transparent;border-color:transparent;'}" onclick="setCostBasisFilter(false)">All</button>
          <button class="btn btn-sm" style="${costBasisShowLiveOnly?'background:var(--sq-navy);color:#fff;':'background:transparent;border-color:transparent;'}" onclick="setCostBasisFilter(true)">Live only</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button class="btn" onclick="addCostEntry()">+ Log cost entry</button>
        <button class="btn btn-gold" onclick="addCostTransfer()">+ Log transfer</button>
      </div>
    </div>
    ${listHtml}`;
}

function setCostBasisFilter(liveOnly) {
  costBasisShowLiveOnly = liveOnly;
  renderCostBasis();
}

async function saveIdealCpm() {
  const val = Math.max(0, parseNum(document.getElementById('ideal-cpm-input').value));
  try {
    const settings = await apiFetch('/api/settings', {method:'PUT', body: JSON.stringify({ideal_cpm: val})});
    ST.settings = settings;
    showToast('Target valuation saved ✓');
    renderCostBasis();
  } catch(e) { showToast('Save failed: '+e.message, 3500); }
}

function costEntryModal(data) {
  const d = data || {};
  document.getElementById('modal-hd').innerHTML = d.id ? 'Edit Cost Entry' : 'Log Cost Entry';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Program</label>
        <select class="select-input" id="e-progc"><option value="">Select…</option>${allProgOptions(d.program_id||'')}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input class="form-input" type="date" id="e-datec" value="${d.entry_date||''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Source</label>
      <input class="form-input" type="text" id="e-source" value="${d.source||''}" placeholder="e.g. DBS Altitude annual fee, min. spend bonus, cash-buy promo">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Miles / points acquired</label>
        <input class="form-input num-input" type="text" inputmode="numeric" id="e-miles-acq" value="${fmt(d.miles_acquired||0)}"
          onfocus="if(parseNum(this.value)===0)this.value=''" onblur="if(this.value==='')this.value='0'">
      </div>
      <div class="form-group">
        <label class="form-label">Cost (S$)</label>
        <input class="form-input num-input" data-decimal="true" type="text" inputmode="decimal" id="e-cost" value="${(d.cost_sgd||0).toFixed(2)}"
          onfocus="if(parseNum(this.value)===0)this.value=''" onblur="if(this.value==='')this.value='0'">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" style="color:var(--sq-text-muted)">Cost per mile preview</label>
      <div class="ref-box" id="cost-preview">Enter miles and cost to see ¢/mile.</div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <input class="form-input" type="text" id="e-notesc" value="${d.notes||''}" placeholder="e.g. Est. 40,000 mi/yr from $192.60 annual fee">
    </div>`;

  function updateCostPreview() {
    const miles = Math.max(0, Math.round(parseNum(document.getElementById('e-miles-acq').value)));
    const cost  = Math.max(0, parseNum(document.getElementById('e-cost').value));
    const box   = document.getElementById('cost-preview');
    if (miles <= 0) { box.innerHTML = 'Enter miles and cost to see ¢/mile.'; return; }
    const cpm = cost / miles * 100;
    box.innerHTML = `$${cost.toFixed(2)} ÷ ${miles.toLocaleString()} mi/pts = <strong>${cpm.toFixed(3)}¢ per mile</strong>`;
  }
  setTimeout(() => {
    ['e-miles-acq','e-cost'].forEach(id => {
      document.getElementById(id).addEventListener('input', updateCostPreview);
    });
    updateCostPreview();
  }, 0);

  onSave = async () => {
    const btn = document.getElementById('save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const payload = {
        program_id:     document.getElementById('e-progc').value,
        entry_date:     document.getElementById('e-datec').value,
        source:         document.getElementById('e-source').value,
        miles_acquired: Math.max(0, Math.round(parseNum(document.getElementById('e-miles-acq').value))),
        cost_sgd:       Math.max(0, parseNum(document.getElementById('e-cost').value)),
        notes:          document.getElementById('e-notesc').value,
      };
      if (!payload.program_id) { showToast('Please select a program', 2500); btn.disabled=false; btn.textContent='Save changes'; return; }
      if (d.id) {
        await apiFetch('/api/cost-entries/'+d.id, {method:'PUT', body:JSON.stringify(payload)});
        showToast('Cost entry updated ✓');
      } else {
        await apiFetch('/api/cost-entries', {method:'POST', body:JSON.stringify(payload)});
        showToast('Cost entry logged ✓');
      }
      closeModal();
      renderCostBasis();
    } catch(e) { showToast('Save failed: '+e.message, 3500); }
    finally { btn.disabled = false; btn.textContent = 'Save changes'; }
  };
  openModal();
}

function addCostEntry() { costEntryModal(null); }

async function editCostEntry(id) {
  try {
    const rows = await apiFetch('/api/cost-entries');
    const row = rows.find(r => r.id === id);
    if (row) costEntryModal(row);
  } catch(e) { showToast('Error loading cost entry', 3000); }
}

async function deleteCostEntry(id) {
  if (!confirm('Delete this cost entry? This cannot be undone.')) return;
  try {
    await apiFetch('/api/cost-entries/'+id, {method:'DELETE'});
    showToast('Cost entry deleted');
    renderCostBasis();
  } catch(e) { showToast(e.message, 4000); }
}

/* ── Transfers (reconcile bought points + organic miles into one dest lot) ── */

async function addCostTransfer() { await transferModal(); }

async function transferModal() {
  let lots = [];
  try { lots = await apiFetch('/api/cost-entries?available=true'); }
  catch(e) { showToast('Could not load available lots: '+e.message, 3500); return; }
  // Source lots are always bank-points programs — a transfer fee converts
  // points into miles, so a source that's already an FFP wouldn't have
  // anything to "convert" (see help-note below).
  lots = lots.filter(e => BANK.find(b => b.id === e.program_id));

  let rateHistory = {};
  try { rateHistory = await apiFetch('/api/cost-transfer-rate-history'); } catch(e) { /* non-critical */ }

  document.querySelector('#modal .modal').classList.add('wide');
  document.getElementById('modal-hd').innerHTML = 'Log Transfer';

  if (lots.length === 0) {
    document.getElementById('modal-body').innerHTML = `<div class="help-note">No bank-points lots with remaining balance yet. Log a bank-points acquisition entry first (annual fee, cash-buy, tax-payment fee, etc.), then transfer from it.</div>`;
    onSave = () => closeModal();
    openModal();
    return;
  }

  const lotRow = e => {
    const p = progLookup(e.program_id);
    const ownCpm = e.miles_acquired > 0 ? (e.cost_sgd / e.miles_acquired * 100) : 0;
    const suggested = suggestDestMiles(e.program_id, e.remaining_miles);
    const curRate = e.remaining_miles > 0 ? suggested / e.remaining_miles : 0;
    const hist = rateHistory[e.program_id];
    // Rate-drift note: purely informational — never changes any stored value,
    // just flags if today's suggested rate differs from what you actually got
    // on your most recent past transfer for this program.
    const driftNote = (hist && Math.abs(hist.conversion_rate - curRate) > 0.0005)
      ? `<div class="text-muted" style="font-size:10px;margin-top:2px" title="This won't change any past entries — it only affects the default suggestion for new transfers.">⚠ Last transfer used ${hist.conversion_rate.toFixed(4)} mi/pt; today's suggested rate is ${curRate.toFixed(4)} mi/pt</div>`
      : '';
    return `<div class="lot-row" data-lot-id="${e.id}" data-remaining="${e.remaining_miles}" data-prog="${e.program_id}">
      <input type="checkbox" id="lot-chk-${e.id}" onchange="onLotToggle(${e.id})">
      <div class="lot-info">
        <div style="font-weight:500">${p ? progLabel(e.program_id) : e.program_id}</div>
        <div class="text-muted">${e.source||'—'} · ${fmt(e.remaining_miles)} mi/pts available · ${ownCpm.toFixed(3)}¢/mi own cost</div>
        ${driftNote}
      </div>
      <div class="lot-inputs">
        <input class="form-input num-input" type="text" inputmode="numeric" id="lot-consumed-${e.id}" placeholder="Consumed" value="${fmt(e.remaining_miles)}" disabled onblur="onLotToggle(${e.id}, true)" title="How many of this lot's ${p?progLabel(e.program_id):e.program_id} points/miles are going into this transfer.">
        <input class="form-input num-input" type="text" inputmode="numeric" id="lot-destmi-${e.id}" placeholder="→ dest mi" value="${fmt(suggested)}" disabled title="How many destination-program miles this lot's points converted into (check your loyalty statement — promos and rounding can differ from the standard rate).">
      </div>
    </div>`;
  };

  document.getElementById('modal-body').innerHTML = `
    <div class="help-note mb-16" style="font-size:12px">
      Pick the FFP you're transferring <em>into</em>, then check off the bank-points lots feeding this transfer. Each lot already has a known cost; this step carries that cost forward at a snapshot of today's conversion rate — frozen permanently, even if the bank's published rate changes later.
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Destination frequent-flyer program</label>
        <select class="select-input" id="xf-dest">${ffpOptions('')}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Transfer date</label>
        <input class="form-input" type="date" id="xf-date" value="${new Date().toISOString().slice(0,10)}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Transfer fee (S$, split across sources by share of destination miles)</label>
      <input class="form-input num-input" data-decimal="true" type="text" inputmode="decimal" id="xf-fee" value="0"
        onfocus="if(parseNum(this.value)===0)this.value=''" onblur="if(this.value==='')this.value='0'">
    </div>
    <div class="form-group">
      <label class="form-label">Source lots <span class="text-muted" style="font-weight:400">— check each bank-points lot feeding this transfer</span></label>
      <div style="display:flex;gap:8px;padding:4px 10px 6px;font-size:10px;color:var(--sq-text-muted);text-transform:uppercase;letter-spacing:.03em">
        <div style="width:16px;flex-shrink:0"></div>
        <div style="flex:1">Lot (program · what it was · balance · own cost)</div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <div style="width:88px;text-align:center">Sent from lot</div>
          <div style="width:88px;text-align:center">Received as miles</div>
        </div>
      </div>
      <div style="border:0.5px solid var(--sq-border);border-radius:8px;padding:0 10px;max-height:220px;overflow-y:auto" id="xf-lots-container">
        ${lots.map(lotRow).join('')}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" style="color:var(--sq-text-muted)">Resulting destination lot</label>
      <div class="ref-box" id="xf-preview">Select at least one source lot.</div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <input class="form-input" type="text" id="xf-notes" placeholder="e.g. Monthly DBS → KrisFlyer batch transfer">
    </div>`;

  window.onLotToggle = (id, blurOnly) => {
    const chk = document.getElementById('lot-chk-'+id);
    const consumedEl = document.getElementById('lot-consumed-'+id);
    const destEl = document.getElementById('lot-destmi-'+id);
    if (!blurOnly) {
      consumedEl.disabled = !chk.checked;
      destEl.disabled = !chk.checked;
    }
    if (chk.checked) {
      // Re-suggest dest miles proportionally if the consumed amount was edited down from full remaining
      const row = document.querySelector(`.lot-row[data-lot-id="${id}"]`);
      const remaining = parseInt(row.dataset.remaining) || 0;
      const prog = row.dataset.prog;
      const consumed = Math.max(0, Math.min(remaining, Math.round(parseNum(consumedEl.value))));
      consumedEl.value = fmt(consumed);
      if (blurOnly) destEl.value = suggestDestMiles(prog, consumed);
    }
    updateTransferPreview();
  };

  function updateTransferPreview() {
    const box = document.getElementById('xf-preview');
    const fee = Math.max(0, parseNum(document.getElementById('xf-fee').value));
    const checked = lots.filter(e => document.getElementById('lot-chk-'+e.id)?.checked);
    if (checked.length === 0) { box.innerHTML = 'Select at least one source lot.'; return; }

    let totalDestMiles = 0, lines = [];
    checked.forEach(e => {
      const destMi = Math.max(0, Math.round(parseNum(document.getElementById('lot-destmi-'+e.id).value)));
      totalDestMiles += destMi;
    });
    let totalCost = 0;
    checked.forEach(e => {
      const consumed = Math.max(0, Math.round(parseNum(document.getElementById('lot-consumed-'+e.id).value)));
      const destMi = Math.max(0, Math.round(parseNum(document.getElementById('lot-destmi-'+e.id).value)));
      const lotCpm = e.miles_acquired > 0 ? (e.cost_sgd / e.miles_acquired) : 0;
      const inherited = consumed * lotCpm;
      const feeShare = totalDestMiles > 0 ? fee * (destMi / totalDestMiles) : 0;
      totalCost += inherited + feeShare;
      lines.push(`${progLabel(e.program_id)}: ${fmt(consumed)} → ${fmt(destMi)}mi (inherited $${inherited.toFixed(2)} + fee $${feeShare.toFixed(2)})`);
    });
    const cpm = totalDestMiles > 0 ? (totalCost / totalDestMiles * 100) : 0;
    box.innerHTML = `<strong>${fmt(totalDestMiles)} mi</strong> for <strong>$${totalCost.toFixed(2)}</strong> = <strong>${cpm.toFixed(3)}¢/mi</strong>
      <div class="text-muted text-sm" style="margin-top:6px">${lines.join('<br>')}</div>`;
  }

  setTimeout(() => {
    document.getElementById('xf-fee').addEventListener('input', updateTransferPreview);
    lots.forEach(e => {
      document.getElementById('lot-destmi-'+e.id).addEventListener('input', updateTransferPreview);
      document.getElementById('lot-consumed-'+e.id).addEventListener('input', updateTransferPreview);
    });
  }, 0);

  onSave = async () => {
    const btn = document.getElementById('save-btn');
    const destProg = document.getElementById('xf-dest').value;
    if (!destProg) { showToast('Please select a destination program', 2500); return; }
    const checked = lots.filter(e => document.getElementById('lot-chk-'+e.id)?.checked);
    if (checked.length === 0) { showToast('Select at least one source lot', 2500); return; }

    const sources = checked.map(e => ({
      entry_id: e.id,
      miles_consumed: Math.max(0, Math.round(parseNum(document.getElementById('lot-consumed-'+e.id).value))),
      dest_miles_contributed: Math.max(0, Math.round(parseNum(document.getElementById('lot-destmi-'+e.id).value))),
    }));
    if (sources.some(s => s.miles_consumed <= 0 || s.dest_miles_contributed <= 0)) {
      showToast('Every checked lot needs a consumed amount and a destination amount > 0', 3000); return;
    }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await apiFetch('/api/cost-transfers', {method:'POST', body: JSON.stringify({
        dest_program_id: destProg,
        entry_date: document.getElementById('xf-date').value,
        transfer_fee: Math.max(0, parseNum(document.getElementById('xf-fee').value)),
        notes: document.getElementById('xf-notes').value,
        sources,
      })});
      showToast('Transfer logged — cost basis reconciled ✓');
      document.querySelector('#modal .modal').classList.remove('wide');
      closeModal();
      renderCostBasis();
    } catch(e) { showToast(e.message, 4000); }
    finally { btn.disabled = false; btn.textContent = 'Save changes'; }
  };

  openModal();
}

async function viewCostTransfer(id) {
  let data;
  try { data = await apiFetch('/api/cost-transfers/'+id); }
  catch(e) { showToast('Could not load transfer: '+e.message, 3500); return; }
  document.querySelector('#modal .modal').classList.remove('wide');
  document.getElementById('modal-hd').innerHTML = 'Transfer Breakdown';
  const rows = data.links.map(l => {
    return `<tr>
      <td class="text-sm">Lot #${l.source_entry_id}</td>
      <td style="text-align:right" class="mono">${fmt(l.miles_consumed)}</td>
      <td style="text-align:right" class="mono">${fmt(l.dest_miles)}mi</td>
      <td style="text-align:right" class="mono">${l.conversion_rate.toFixed(4)}</td>
      <td style="text-align:right" class="mono">$${l.inherited_cost.toFixed(2)}</td>
      <td style="text-align:right" class="mono">$${l.fee_share.toFixed(2)}</td>
    </tr>`;
  }).join('');
  document.getElementById('modal-body').innerHTML = `
    <div class="ref-box mb-16">${fmt(data.entry.miles_acquired)}mi produced for $${data.entry.cost_sgd.toFixed(2)} in ${progLabel(data.entry.program_id)} on ${data.entry.entry_date}</div>
    <table class="tbl">
      <thead><tr><th>Source</th><th style="text-align:right">Consumed</th><th style="text-align:right">Dest mi</th><th style="text-align:right">Rate</th><th style="text-align:right">Inherited $</th><th style="text-align:right">Fee $</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="help-note" style="margin-top:12px;font-size:11px">Rate is frozen at the moment of this transfer — it stays put even if the bank's published conversion rate changes later, so past transfers never get silently recalculated.</div>`;
  onSave = () => closeModal();
  openModal();
}

async function deleteCostTransfer(id) {
  if (!confirm('Undo this transfer? Consumed miles will be restored to their source lots.')) return;
  try {
    await apiFetch('/api/cost-transfers/'+id, {method:'DELETE'});
    showToast('Transfer undone — source lots restored');
    renderCostBasis();
  } catch(e) { showToast(e.message, 4000); }
}
