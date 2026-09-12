/* ── Cost Basis tab ──────────────────────────────────────────── */
let costBasisShowLiveOnly = false;
let lastBasisMap = {}; // cached for the lazily-rendered chart panel (see toggleChartPanel)
let costBasisChart = null;

async function renderCostBasis() {
  const pane = document.getElementById('pane-costbasis');
  pane.innerHTML = '<div style="color:var(--sq-text-muted);padding:2rem 0;font-size:13px">Loading…</div>';
  let entries = [], basisMap = {}, allLinks = [];
  try {
    [entries, basisMap, allLinks] = await Promise.all([apiFetch('/api/cost-entries'), apiFetch('/api/cost-basis'), apiFetch('/api/cost-transfer-links')]);
    ST.costBasis = basisMap || {};
    lastBasisMap = basisMap || {};
  } catch(e) {
    pane.innerHTML = `<div class="api-banner"><span class="api-dot err"></span>Could not load cost basis. Is the server running?</div>`;
    return;
  }

  // Group transfer links by their destination (transfer) entry id, so each
  // FFP transfer row can build its Source column from the actual source
  // lots feeding it — always in sync with what "Breakdown" shows — instead
  // of the transfer entry's own frozen `source` text.
  const linksByTransfer = {};
  (allLinks||[]).forEach(l => { (linksByTransfer[l.transfer_entry_id] = linksByTransfer[l.transfer_entry_id]||[]).push(l); });
  // Just the source program names (Type column already says "Transfer", so
  // "Transfer from DBS Points" would be redundant). Hover tooltip shows the
  // per-lot breakdown — which banks fed into this, and at what rates.
  const transferSourceHtml = (entryId, fallback) => {
    const links = linksByTransfer[entryId];
    if (!links || links.length === 0) return fallback||'—'; // legacy/imported entry with no link rows — fall back gracefully
    const names = [...new Set(links.map(l => progLabel(l.source_program_id)))];
    const tooltip = links.map(l => `${progLabel(l.source_program_id)}: ${fmt(l.miles_consumed)} → ${fmt(l.dest_miles)}mi (${l.source_label||'—'})`).join('\n');
    return `<span title="${tooltip.replace(/"/g,'&quot;')}">${names.join(' + ')}</span>`;
  };

  const idealCpm = Number(ST.settings?.ideal_cpm) || 0;
  // Green when a rate is at/under your target valuation (good value), red when it exceeds it (expensive).
  // IMPORTANT: this must always be fed a miles-EQUIVALENT cents figure, never a
  // raw bank-points cents figure — ideal_cpm is defined in ¢/mile terms.
  const cpmCls = cpmCents => idealCpm > 0 && cpmCents > 0 ? (cpmCents <= idealCpm ? 'c-ok' : 'c-danger') : '';

  // Aggregate on a common basis: dollars need no conversion, but "miles" do —
  // a bank program's remaining_miles/total_miles are actually POINTS, so they
  // must be converted through that program's rate before being summed
  // alongside real FFP miles. Without this, summing e.g. 3,096 DBS points +
  // 10,000 KrisFlyer miles into "13,096 mi/pts" would be meaningless.
  const equivMiles = (progId, rawUnits) => {
    const bankProg = BANK.find(b => b.id === progId);
    if (!bankProg) return rawUnits;
    if (bankProg.variableRate) return 0; // no known rate yet, see below
    const rate = mpp(bankProg);
    return rate > 0 ? rawUnits * rate : 0;
  };
  let totalCost = 0, totalEquivMiles = 0, remainingCostSum = 0, remainingEquivMilesSum = 0;
  Object.entries(basisMap).forEach(([progId, b]) => {
    // variableRate programs (HeyMax) have no fixed rate to convert through, so
    // their dollars can't be blended into a ¢/mile figure yet either — including
    // the cost without a matching miles-equivalent would inflate the blended
    // rate. They rejoin these totals naturally once transferred into an FFP,
    // where the real snapshotted rate applies.
    if (isVariableRateProgram(progId)) return;
    totalCost += b.total_cost || 0;
    totalEquivMiles += equivMiles(progId, b.total_miles || 0);
    remainingCostSum += b.remaining_cost || 0;
    remainingEquivMilesSum += equivMiles(progId, b.remaining_miles || 0);
  });
  const blendedCpm = remainingEquivMilesSum > 0 ? (remainingCostSum / remainingEquivMilesSum) : 0;
  // Rank on miles-equivalent cost, not raw stored units, so a bank program's
  // ¢/point rate isn't compared directly against an FFP's ¢/mile rate.
  const rankedByCpm = Object.entries(basisMap)
    .map(([id, b]) => [id, b, milesEquivCpm(id, (b.cost_per_mile||0)*100)])
    .filter(([,,equivCents]) => equivCents > 0)
    .sort((a,b) => a[2] - b[2]);
  const cheapest = rankedByCpm[0];
  // Acquisition spend: money paid directly to acquire points/miles — annual
  // fees, min-spend bonuses, cash-buy promos, tax-processing fees — summed
  // straight from 'acquisition' entries only. Deliberately excludes transfer
  // entries' cost, since that figure is inherited acquisition cost PLUS a
  // transfer fee already counted once at the acquisition entry; including it
  // again here would double-count the same dollars, and the fee itself is a
  // cost of moving currency, not of acquiring it in the first place.
  const acquisitionSpend = entries
    .filter(e => e.entry_type === 'acquisition')
    .reduce((s, e) => s + (e.cost_sgd||0), 0);
  const acquisitionCount = entries.filter(e => e.entry_type === 'acquisition' && e.cost_sgd > 0).length;

  let listHtml = '';
  if (entries.length === 0) {
    listHtml = `<div class="empty-state">
      <div class="empty-state-icon">$</div>
      <div style="font-size:14px;font-weight:500;color:var(--sq-text-mid)">No cost entries logged yet</div>
      <div style="font-size:12px;margin-top:6px">Log what you actually paid for miles or points — annual fees, spend requirements, cash top-ups, transfer costs — to see your real cost per program, in the correct unit (¢/mile for FFPs, ¢/point for bank programs).</div>
    </div>`;
  } else {
    // Group by program, then split into two top-level sections. Bank points
    // and FFP miles are fundamentally different concepts — different units
    // (pts vs mi), different meaning (not-yet-redeemable vs redeemable), and
    // different next action (transfer vs done) — so they're never interleaved
    // in one flat, alphabetically-sorted list.
    const byProg = {};
    entries.forEach(e => { (byProg[e.program_id] = byProg[e.program_id]||[]).push(e); });
    const allProgIds  = Object.keys(byProg).sort((a,b) => progLabel(a).localeCompare(progLabel(b)));
    const bankProgIds = allProgIds.filter(id => isBankProgram(id));
    const ffpProgIds  = allProgIds.filter(id => !isBankProgram(id));

    const renderProgramTable = (progId) => {
      // "Live only" hides fully-consumed lots (status === 'consumed') — the ones
      // that have been entirely transferred elsewhere and are pure audit trail.
      // Partially-consumed lots still show, since part of their balance is live.
      const rows = costBasisShowLiveOnly
        ? byProg[progId].filter(e => e.status !== 'consumed')
        : byProg[progId];
      if (rows.length === 0) return ''; // whole program has nothing live to show under this filter
      const basis = basisMap[progId];
      const isBank = isBankProgram(progId);
      const unitLabel = costUnitLabel(progId);
      const unitColHeader = isBank ? 'Points' : 'Miles'; // never the ambiguous "Miles/pts" — each table is one unit only
      const nativePillCents = basis ? basis.cost_per_mile*100 : 0;
      const equivPillCents = basis ? milesEquivCpm(progId, nativePillCents) : 0;
      const pillCls = basis ? cpmCls(equivPillCents) : '';
      // Bank Points entries are always type 'acquisition' — a transfer's
      // destination is always an FFP (the transfer modal only offers FFPs as
      // destinations), so a bank program can never receive a 'transfer' row.
      // The Type column would be 100% redundant here, so bank tables drop it
      // entirely — one fewer column also helps these tables fit narrower
      // screens without the horizontal-scroll fallback kicking in as often.
      // FFP tables keep it: they genuinely mix 'acquisition' (organic/buy-miles)
      // and 'transfer' (converted in from a bank) rows.
      return `<div class="sec-hd" style="display:flex;align-items:center;gap:8px">
        <div style="width:20px;height:20px;border-radius:4px;overflow:hidden;background:#fff;display:flex;align-items:center;justify-content:center;border:0.5px solid var(--sq-border)">${logoImg(progLogoUrl(progId), progId.slice(0,2).toUpperCase(), 20)}</div>
        ${progLabel(progId)}
        ${basis ? `<span class="basis-pill${pillCls==='c-danger'?' over-ideal':''}" title="${isBank ? `Own rate: ${nativePillCents.toFixed(3)}${unitLabel} · ≈${equivPillCents.toFixed(3)}¢/mi equivalent at today's published conversion rate — the exact rate only locks in once you actually transfer.` : ''}">${nativePillCents.toFixed(3)}${unitLabel}${isBank ? ` blended <span class="text-muted">(≈${equivPillCents.toFixed(3)}¢/mi)</span>` : ' blended'} · ${fmt(basis.remaining_miles)} ${isBank?'pts':'mi'} live</span>` : ''}
        ${!isBank && basis ? `<span class="basis-pill none" title="All-time totals for this FFP — includes miles later redeemed or that expired, not just what's currently live.">$${fmt(basis.total_cost)} spent · ${fmt(basis.total_miles)} mi acquired (all-time)</span>` : ''}
        <div class="sec-hd-line"></div>
      </div>
      <div class="card mb-16"><div class="table-scroll"><table class="tbl">
        <thead><tr>
          <th style="width:10%">Date</th>
          ${isBank ? '' : '<th style="width:9%">Type</th>'}
          <th style="width:${isBank ? 24 : 15}%">Source</th>
          <th style="width:9%;text-align:right">${unitColHeader}</th>
          <th style="width:8%;text-align:right">Cost (S$)</th>
          <th style="width:11%;text-align:right">¢/mi</th>
          <th style="width:${isBank ? 22 : 26}%">Notes</th>
          <th style="width:${isBank ? 16 : 14}%;text-align:right"></th>
        </tr></thead>
        <tbody>
          ${rows.map(e => {
            const nativeCpm = e.miles_acquired > 0 ? (e.cost_sgd / e.miles_acquired * 100) : 0;
            const equivCpm  = milesEquivCpm(progId, nativeCpm);
            const dt = e.entry_date ? new Date(e.entry_date+'T00:00:00').toLocaleDateString('en-SG',{day:'numeric',month:'short',year:'numeric'}) : '—';
            const consumed = e.miles_acquired - e.remaining_miles;
            const isXfer = e.entry_type === 'transfer';
            const typePill = isXfer ? `<span class="entry-type-pill xfer">Transfer</span>` : `<span class="entry-type-pill acq">Acquisition</span>`;
            const isFullyConsumed = e.remaining_miles <= 0 && consumed > 0;
            const isPartiallyConsumed = e.remaining_miles > 0 && consumed > 0;
            let statusBadge = '';
            if (isFullyConsumed) {
              statusBadge = `<span title="${fmt(consumed)}${isBank?' pts':' mi'} fully transferred to another program" style="font-size:9px;font-weight:600;padding:1px 7px;border-radius:4px;background:rgba(153,28,28,.08);color:var(--sq-danger);margin-left:8px;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;vertical-align:middle">Transferred</span>`;
            } else if (isPartiallyConsumed) {
              statusBadge = `<span title="${fmt(consumed)}${isBank?' pts':' mi'} transferred · ${fmt(e.remaining_miles)}${isBank?' pts':' mi'} remaining" style="font-size:9px;font-weight:600;padding:1px 7px;border-radius:4px;background:rgba(191,155,48,.1);color:#8a6d1a;margin-left:8px;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;vertical-align:middle">Transferred (partial)</span>`;
            }
            const actions = isXfer
              ? `<button class="btn btn-sm" onclick="viewCostTransfer(${e.id})">Breakdown</button>
                 <button class="btn btn-sm" style="color:var(--sq-danger);border-color:rgba(153,28,28,.3)" onclick="deleteCostTransfer(${e.id})">Undo</button>`
              : `<button class="btn btn-sm" onclick="editCostEntry(${e.id})">Edit</button>
                 <button class="btn btn-sm" style="color:var(--sq-danger);border-color:rgba(153,28,28,.3)" onclick="deleteCostEntry(${e.id})">Del</button>`;
            return `<tr>
              <td class="text-sm text-muted" style="white-space:nowrap">${dt}</td>
              ${isBank ? '' : `<td>${typePill}</td>`}
              <td style="font-weight:500">${isXfer ? transferSourceHtml(e.id, e.source) : (e.source||'—')}${statusBadge}</td>
              <td style="text-align:right" class="mono">${fmt(e.miles_acquired)}</td>
              <td style="text-align:right" class="mono">${e.cost_sgd.toFixed(2)}</td>
              <td style="text-align:right;font-weight:${cpmCls(equivCpm)?'600':'400'};position:relative;height:32px" class="mono ${cpmCls(equivCpm)}" title="${isBank ? `Raw cost: ${nativeCpm.toFixed(3)}¢/pt — ≈${equivCpm.toFixed(3)}¢/mi equivalent at today's rate` : ''}">${isBank ? `<span style="display:block;line-height:1.3">${equivCpm.toFixed(3)}¢/mi</span><span class="text-muted" style="display:block;font-size:8.5px;font-weight:400;line-height:1.3;opacity:.7;margin-top:1px">(${nativeCpm.toFixed(3)}¢/pt)</span>` : `${equivCpm.toFixed(3)}¢/mi`}</td>
              <td class="text-sm text-muted notes-cell" title="${e.notes||''}">${e.notes||''}</td>
              <td style="white-space:nowrap;text-align:right">${actions}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div></div>`;
    };

    const bankHtml = bankProgIds.map(renderProgramTable).join('');
    const ffpHtml  = ffpProgIds.map(renderProgramTable).join('');

    if (bankHtml) {
      listHtml += `<div class="cbg-hd">
        <span class="cbg-title">Bank Points</span>
        <span class="cbg-badge bank">Convert via transfer</span>
        <span class="cbg-sub">Card-earned points — not yet redeemable until transferred to an FFP</span>
        <div class="sec-hd-line"></div>
      </div>${bankHtml}`;
    }
    if (ffpHtml) {
      listHtml += `<div class="cbg-hd">
        <span class="cbg-title">Frequent Flyer Programs</span>
        <span class="cbg-badge ffp">Redeemable</span>
        <span class="cbg-sub">Miles you can book flights with directly</span>
        <div class="sec-hd-line"></div>
      </div>${ffpHtml}`;
    }
    if (!bankHtml && !ffpHtml) {
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
        <div class="metric-sub" title="Each cost entry is a &quot;lot&quot; — miles/points you acquired at a known cost. When you transfer a lot elsewhere, it's removed from its original program's blend so it isn't counted twice. This number only reflects lots — or the still-unconsumed part of a lot — that haven't been transferred away. Bank points are converted to a miles-equivalent at today's published rate so they can be blended alongside real FFP miles on a common basis.">Cost of what you still hold, in miles-equivalent</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total spent acquiring</div>
        <div class="metric-value">$${fmt(totalCost)}</div>
        <div class="metric-sub" title="Bank points are converted to their miles-equivalent at today's rate so this total is on one consistent unit — see each program's row below for the raw ¢/pt figure.">≈${fmt(totalEquivMiles)} mi-equiv, all-time gross</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Spent to acquire miles/pts</div>
        <div class="metric-value">$${fmt(acquisitionSpend)}</div>
        <div class="metric-sub" title="Sum of 'acquisition' entries only — annual fees, min-spend bonuses, cash-buy promos, tax-processing fees. Excludes transfer fees, and excludes double-counting a transfer's inherited cost, since that's the same dollars already counted here at the point of acquisition.">Across ${acquisitionCount} acquisition${acquisitionCount!==1?'s':''} (excl. transfer fees)</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Cheapest program</div>
        <div class="metric-value" style="font-size:16px">${cheapest ? progLookup(cheapest[0])?.code || progLabel(cheapest[0]) : '—'}</div>
        <div class="metric-sub" title="${cheapest && isBankProgram(cheapest[0]) ? 'Ranked on miles-equivalent cost, not raw ¢/point, so bank programs and FFPs compare fairly.' : ''}">${cheapest ? cheapest[2].toFixed(3)+'¢/mi equiv' : 'No data yet'}</div>
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
    <div id="help-panel-wrapper" style="margin-bottom:1rem">
      <div id="help-toggle-header" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--sq-navy-light);border-radius:6px;cursor:pointer;border:0.5px solid var(--sq-border);user-select:none" onclick="toggleHelpPanel()" title="Toggle cost basis explanation">
        <span id="help-chevron" style="display:inline-block;transition:transform 0.2s ease;font-size:12px;color:var(--sq-text-muted)">▼</span>
        <span style="font-weight:500;font-size:13px">How cost basis works</span>
        <span class="text-muted text-sm" style="flex:1;text-align:right" id="help-toggle-hint">(click to expand)</span>
      </div>
      <div id="help-panel-content" style="max-height:0;overflow:hidden;transition:max-height 0.25s ease,padding 0.25s ease">
        <div class="help-note mb-16">
          <ul style="margin:6px 0 0 18px;padding:0">
            <li style="margin-bottom:4px"><strong>A "lot"</strong> = one cost entry, i.e. one specific batch of points/miles you got at a specific cost (e.g. one year's card fee, one tax payment).</li>
            <li style="margin-bottom:4px"><strong>+ Log bank points</strong> when a bank card earned it — annual fee, min-spend bonus, a card's processing fee on a tax payment — even though you'll convert it to an FFP later via Log Transfer. These always show up in the <strong>Bank Points</strong> section below.</li>
            <li style="margin-bottom:4px"><strong>+ Log miles</strong> when miles landed directly in an FFP with no bank in between — organic flying (cost $0), an airline's "buy miles" promo, or a co-branded card that credits miles straight to the FFP. These show up in the <strong>Frequent Flyer Programs</strong> section.</li>
            <li style="margin-bottom:4px"><strong>+ Log transfer</strong> when you move points/miles you've already logged into an FFP (e.g. DBS Points → KrisFlyer). This carries the original cost forward with the miles and splits any transfer fee across the sources — it does <em>not</em> create new cost, so you avoid paying for the same dollar twice. A transfer always lands in the FFP section, since bank programs can never be a transfer's destination.</li>
            <li style="margin-bottom:4px">Once a lot is transferred out, its balance drops to 0 there and it stops counting toward that program's blended rate — the cost basis "moves" with the miles to the destination program. That's why the <strong>Bank Points</strong> tables never show a "Type" column: every row there is always an acquisition (nothing can ever be transferred <em>into</em> a bank program), so the column would be 100% redundant. FFP tables keep it, since they genuinely mix acquisitions and transfers.</li>
            <li style="margin-top:4px"><strong>Points ≠ miles.</strong> A bank program's rate is shown as ¢/pt, never ¢/mi — 3,096 DBS points at $82.91 is 2.678¢/pt, not 2.678¢/mi, since DBS converts at 2 miles per point. Bank rows show a small "≈X¢/mi equivalent" alongside the raw ¢/pt figure, and that converted figure — not the raw one — is what's used for the green/red target-valuation coloring, the "cheapest program" ranking, and the chart above. The real, locked-in rate is only fixed once you actually run a transfer.</li>
            <li><strong>Live only</strong> hides lots that have been fully transferred elsewhere (0 remaining) — pure audit-trail noise for day-to-day use. Switch back to "All" any time to see full history, including consumed lots.</li>
          </ul>
        </div>
      </div>
    </div>
    <div id="chart-panel-wrapper" style="margin-bottom:1rem">
      <div id="chart-toggle-header" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--sq-navy-light);border-radius:6px;cursor:pointer;border:0.5px solid var(--sq-border);user-select:none" onclick="toggleChartPanel()" title="Toggle blended valuation chart">
        <span id="chart-chevron" style="display:inline-block;transition:transform 0.2s ease;font-size:12px;color:var(--sq-text-muted)">▼</span>
        <span style="font-weight:500;font-size:13px">Blended valuation by program (FFP)</span>
        <span class="text-muted text-sm" style="flex:1;text-align:right" id="chart-toggle-hint">(click to expand)</span>
      </div>
      <div id="chart-panel-content" style="max-height:0;overflow:hidden;transition:max-height 0.25s ease,padding 0.25s ease">
        <div class="card mb-16" style="margin-top:10px">
          <div style="position:relative;height:220px"><canvas id="costbasis-chart-canvas"></canvas></div>
          <div class="help-note" style="margin-top:10px">Each bar is one FFP, colored to match its airline branding elsewhere in the app. The dashed gold line is your target valuation — bars taller than the line are costing you more per mile than you're aiming for; bars below it are within target.</div>
        </div>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="sec-hd" style="margin:0">Cost entries<div class="sec-hd-line" style="min-width:40px;margin-left:8px"></div></div>
        <div style="display:flex;gap:2px;background:var(--sq-navy-light);border-radius:6px;padding:2px;flex-shrink:0" title="Live only hides lots that have been fully transferred elsewhere (0 remaining) — pure audit-trail noise for day-to-day use.">
          <button class="btn btn-sm" style="${!costBasisShowLiveOnly?'background:var(--sq-navy);color:#fff;':'background:transparent;border-color:transparent;'}" onclick="setCostBasisFilter(false)">All</button>
          <button class="btn btn-sm" style="${costBasisShowLiveOnly?'background:var(--sq-navy);color:#fff;':'background:transparent;border-color:transparent;'}" onclick="setCostBasisFilter(true)">Live only</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">
        <button class="btn" onclick="addBankPointsEntry()">+ Log bank points</button>
        <button class="btn" onclick="addMilesEntry()">+ Log miles</button>
        <button class="btn btn-gold" onclick="addCostTransfer()">+ Log transfer</button>
      </div>
    </div>
    ${listHtml}`;
  
  // Initialize help panel and chart panel collapsed/expanded state
  setTimeout(() => { initHelpPanel(); initChartPanel(); }, 0);
}

function initHelpPanel() {
  const wrapper = document.getElementById('help-panel-wrapper');
  const content = document.getElementById('help-panel-content');
  const chevron = document.getElementById('help-chevron');
  const hint = document.getElementById('help-toggle-hint');
  if (!wrapper || !content) return;
  
  const collapsed = localStorage.getItem('costbasis-help-collapsed') !== '0';
  if (collapsed) {
    content.style.maxHeight = '0px';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    if (hint) hint.textContent = '(click to expand)';
  } else {
    content.style.maxHeight = content.scrollHeight + 'px';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    if (hint) hint.textContent = '(click to collapse)';
  }
}

function toggleHelpPanel() {
  const content = document.getElementById('help-panel-content');
  const chevron = document.getElementById('help-chevron');
  const hint = document.getElementById('help-toggle-hint');
  if (!content) return;
  
  const currentMax = content.style.maxHeight;
  if (currentMax === '0px' || !currentMax || currentMax === '0px') {
    // Expanding
    content.style.maxHeight = content.scrollHeight + 'px';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    if (hint) hint.textContent = '(click to collapse)';
    localStorage.setItem('costbasis-help-collapsed', '0');
  } else {
    // Collapsing
    content.style.maxHeight = '0px';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    if (hint) hint.textContent = '(click to expand)';
    localStorage.setItem('costbasis-help-collapsed', '1');
  }
}

function setCostBasisFilter(liveOnly) {
  costBasisShowLiveOnly = liveOnly;
  renderCostBasis();
}

/* ── Blended valuation chart (FFP only, hidden by default) ─────────────────
 * Hidden by default per design: this is a supplementary view, not something
 * needed for day-to-day logging, so it starts collapsed and is only rendered
 * (lazily) the first time it's actually expanded — a Chart.js canvas sized
 * inside a max-height:0 container would otherwise compute to 0x0.
 */
function initChartPanel() {
  const content = document.getElementById('chart-panel-content');
  const chevron = document.getElementById('chart-chevron');
  const hint = document.getElementById('chart-toggle-hint');
  if (!content) return;

  const collapsed = localStorage.getItem('costbasis-chart-collapsed') !== '0'; // default: hidden
  if (collapsed) {
    content.style.maxHeight = '0px';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    if (hint) hint.textContent = '(click to expand)';
  } else {
    renderCostBasisChart(lastBasisMap);
    content.style.maxHeight = content.scrollHeight + 'px';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    if (hint) hint.textContent = '(click to collapse)';
  }
}

function toggleChartPanel() {
  const content = document.getElementById('chart-panel-content');
  const chevron = document.getElementById('chart-chevron');
  const hint = document.getElementById('chart-toggle-hint');
  if (!content) return;

  const currentMax = content.style.maxHeight;
  if (currentMax === '0px' || !currentMax) {
    renderCostBasisChart(lastBasisMap);
    content.style.maxHeight = content.scrollHeight + 'px';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    if (hint) hint.textContent = '(click to collapse)';
    localStorage.setItem('costbasis-chart-collapsed', '0');
  } else {
    content.style.maxHeight = '0px';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    if (hint) hint.textContent = '(click to expand)';
    localStorage.setItem('costbasis-chart-collapsed', '1');
  }
}

function renderCostBasisChart(basisMap) {
  const canvas = document.getElementById('costbasis-chart-canvas');
  if (!canvas) return;
  const idealCpm = Number(ST.settings?.ideal_cpm) || 0;

  // FFP only — a bank program's own rate is ¢/pt, and while it CAN be
  // converted to a miles-equivalent (like everywhere else in this tab), the
  // conversion is an estimate until actually transferred. The chart is meant
  // as "what am I really paying per mile right now", so it sticks to
  // programs holding real, locked-in miles.
  const progIds = Object.keys(basisMap)
    .filter(id => !isBankProgram(id) && (basisMap[id].remaining_miles||0) > 0)
    .sort((a,b) => (basisMap[a].cost_per_mile||0) - (basisMap[b].cost_per_mile||0));

  if (costBasisChart) { costBasisChart.destroy(); costBasisChart = null; }

  if (progIds.length === 0) {
    canvas.parentElement.innerHTML = '<div class="text-muted text-sm" style="padding:2rem 0;text-align:center">No live FFP miles to chart yet — log some miles or run a transfer first.</div>';
    return;
  }

  const values = progIds.map(id => (basisMap[id].cost_per_mile||0) * 100);
  // Match the dashboard's own bar chart: color by program/airline brand
  // identity (falls back to alliance color), not by value — the target-line
  // benchmark below is what signals good/bad value, so bar color stays
  // consistent with how this program is colored everywhere else in the app.
  const progColor = id => {
    const p = progLookup(id);
    return p?.color || AC[p?.alliance]?.bg || '#8895b8';
  };
  const colors = progIds.map(progColor);

  // Force the y-axis to always include the target line, padded above
  // whichever is larger (tallest bar or the target itself) — otherwise
  // Chart.js's auto-scaled max can end up below idealCpm whenever every
  // program is already cheaper than target, silently clipping the dashed
  // line out of the visible area entirely.
  const axisMax = Math.max(...values, idealCpm || 0) * 1.18;

  costBasisChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: progIds.map(id => progLookup(id)?.code || progLabel(id)),
      datasets: [{
        label: 'Blended ¢/mile',
        data: values,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1.5, borderRadius: 5,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {display:false},
        tooltip: {callbacks:{label: c => ' ' + c.raw.toFixed(3) + '¢/mile'}},
      },
      scales: {
        y: {beginAtZero:true, suggestedMax: axisMax, grid:{color:'rgba(13,31,92,.06)'}, ticks:{font:{size:10}, callback:v=>v.toFixed(2)+'¢'}},
        x: {grid:{display:false}, ticks:{font:{size:10}, maxRotation:28, autoSkip:false}}
      }
    },
    plugins: [{
      id: 'targetValuationLine',
      afterDraw(chart) {
        if (!idealCpm) return;
        const {ctx, chartArea, scales:{y}} = chart;
        const yPix = y.getPixelForValue(idealCpm);
        if (yPix < chartArea.top - 1 || yPix > chartArea.bottom + 1) return; // truly off-chart, nothing sane to draw
        ctx.save();
        ctx.strokeStyle = '#c8a46a';
        ctx.setLineDash([5,4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(chartArea.left, yPix);
        ctx.lineTo(chartArea.right, yPix);
        ctx.stroke();
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#8a6d1a';
        ctx.textAlign = 'right';
        ctx.fillText(`target ${idealCpm.toFixed(2)}¢`, chartArea.right - 4, yPix - 4);
        ctx.restore();
      }
    }]
  });
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

function costEntryModal(data, kind) {
  const d = data || {};
  // Editing always derives kind from the entry's actual program — never trust
  // a passed-in kind for edits, so the modal can't show the wrong program list.
  const isBank = d.id ? isBankProgram(d.program_id) : (kind === 'bank');
  const unitWord = isBank ? 'points' : 'miles';
  const kindLabel = isBank ? 'Bank Points' : 'Miles';
  const kindNote = isBank
    ? 'Points not yet in an FFP — bank card points or a purchased currency like HeyMax Max Miles. You\'ll convert this to an FFP later via Log Transfer.'
    : 'FFP miles, credited here directly — organic flying ($0 cost), a buy-miles promo, or a co-branded card. Not bank points/Max Miles you plan to transfer in.';
  const sourcePlaceholder = isBank
    ? 'e.g. DBS Altitude annual fee, min. spend bonus, or a cash purchase of Max Miles'
    : 'e.g. Organic flying, KrisFlyer buy-miles promo, co-branded card credit';

  document.getElementById('modal-hd').innerHTML = d.id ? `Edit ${kindLabel} Entry` : `Log ${kindLabel}`;
  document.getElementById('modal-body').innerHTML = `
    <div class="help-note" style="font-size:11.5px;margin-bottom:12px">${kindNote}</div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">${isBank ? 'Bank program' : 'Frequent flyer program'}</label>
        <select class="select-input" id="e-progc"><option value="">Select…</option>${isBank ? bankOptions(d.program_id||'') : ffpOptions(d.program_id||'')}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input class="form-input" type="date" id="e-datec" value="${d.entry_date||''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Source</label>
      <input class="form-input" type="text" id="e-source" value="${d.source||''}" placeholder="${sourcePlaceholder}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">${isBank ? 'Points' : 'Miles'} acquired</label>
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
      <label class="form-label" style="color:var(--sq-text-muted)">Cost per ${isBank?'point':'mile'} preview</label>
      <div class="ref-box" id="cost-preview">Pick a program, then enter ${unitWord} and cost.</div>
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <input class="form-input" type="text" id="e-notesc" value="${d.notes||''}" placeholder="e.g. Est. 40,000 mi/yr from $192.60 annual fee">
    </div>`;

  function updateCostPreview() {
    const progId = document.getElementById('e-progc').value;
    const miles = Math.max(0, Math.round(parseNum(document.getElementById('e-miles-acq').value)));
    const cost  = Math.max(0, parseNum(document.getElementById('e-cost').value));
    const box   = document.getElementById('cost-preview');
    if (miles <= 0) { box.innerHTML = `Pick a program, then enter ${unitWord} and cost.`; return; }
    const cpm = cost / miles * 100;
    if (!progId) {
      box.innerHTML = `$${cost.toFixed(2)} ÷ ${miles.toLocaleString()} ${unitWord} = <strong>${cpm.toFixed(3)}¢</strong> — pick a program above.`;
      return;
    }
    const unit = costUnitLabel(progId);
    let html = `$${cost.toFixed(2)} ÷ ${miles.toLocaleString()} ${isBank?'pts':'mi'} = <strong>${cpm.toFixed(3)}${unit}</strong>`;
    if (isBank && isVariableRateProgram(progId)) {
      html += ` <span class="text-muted">(¢/mi equivalent varies by destination FFP — you'll see the real figure once you log the transfer)</span>`;
    } else if (isBank) {
      const equiv = milesEquivCpm(progId, cpm);
      html += ` <span class="text-muted">(≈${equiv.toFixed(3)}¢/mi equivalent once converted to an FFP at today's rate)</span>`;
    }
    box.innerHTML = html;
  }
  setTimeout(() => {
    ['e-progc','e-miles-acq','e-cost'].forEach(id => {
      document.getElementById(id).addEventListener('input', updateCostPreview);
      document.getElementById(id).addEventListener('change', updateCostPreview);
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
        showToast(`${kindLabel} entry logged ✓`);
      }
      closeModal();
      renderCostBasis();
    } catch(e) { showToast('Save failed: '+e.message, 3500); }
    finally { btn.disabled = false; btn.textContent = 'Save changes'; }
  };
  openModal();
}

function addBankPointsEntry() { costEntryModal(null, 'bank'); }
function addMilesEntry() { costEntryModal(null, 'ffp'); }

async function editCostEntry(id) {
  try {
    const rows = await apiFetch('/api/cost-entries');
    const row = rows.find(r => r.id === id);
    if (row) costEntryModal(row, isBankProgram(row.program_id) ? 'bank' : 'ffp');
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
        <div class="text-muted">${e.source||'—'} · ${fmt(e.remaining_miles)} pts available · ${ownCpm.toFixed(3)}¢/pt own cost</div>
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
        <input class="form-input" type="date" id="xf-date" value="${todayISO()}">
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
      // A generic "Transfer in" tells you nothing when scanning the FFP
      // table — build something that actually names where the miles came
      // from, e.g. "Transfer from DBS Points" or "Transfer from DBS Points +
      // Citi Miles" when a batch pools multiple bank programs together.
      const srcProgNames = [...new Set(checked.map(e => progLookup(e.program_id)?.name || progLabel(e.program_id)))];
      const sourceLabel = 'Transfer from ' + srcProgNames.join(' + ');

      await apiFetch('/api/cost-transfers', {method:'POST', body: JSON.stringify({
        dest_program_id: destProg,
        entry_date: document.getElementById('xf-date').value,
        transfer_fee: Math.max(0, parseNum(document.getElementById('xf-fee').value)),
        notes: document.getElementById('xf-notes').value,
        source: sourceLabel,
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
    const srcDt = l.source_date ? new Date(l.source_date+'T00:00:00').toLocaleDateString('en-SG',{day:'numeric',month:'short',year:'numeric'}) : '';
    const srcName = progLabel(l.source_program_id) || `Lot #${l.source_entry_id}`;
    return `<tr>
      <td class="text-sm">
        <div style="font-weight:500">${srcName}</div>
        <div class="text-muted" style="font-size:10.5px">${l.source_label||'—'}${srcDt ? ' · '+srcDt : ''}</div>
      </td>
      <td style="text-align:right" class="mono">${fmt(l.miles_consumed)}</td>
      <td style="text-align:right" class="mono">${fmt(l.dest_miles)}mi</td>
      <td style="text-align:right" class="mono">${l.conversion_rate.toFixed(4)}</td>
      <td style="text-align:right" class="mono">$${l.inherited_cost.toFixed(2)}</td>
      <td style="text-align:right" class="mono">$${l.fee_share.toFixed(2)}</td>
    </tr>`;
  }).join('');
  document.getElementById('modal-body').innerHTML = `
    <div class="ref-box mb-16">${fmt(data.entry.miles_acquired)}mi produced for $${data.entry.cost_sgd.toFixed(2)} in ${progLabel(data.entry.program_id)} on ${data.entry.entry_date}</div>
    <div class="table-scroll"><table class="tbl">
      <thead><tr><th>Source</th><th style="text-align:right">Consumed</th><th style="text-align:right">Dest mi</th><th style="text-align:right">Rate</th><th style="text-align:right">Inherited $</th><th style="text-align:right">Fee $</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
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
