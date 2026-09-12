/* ── Bank tab ────────────────────────────────────────────────── */
let showZeroPoints = false;

function renderBank() {
  // Same toggle language/pattern as the FFP tab's "show 0 miles" control.
  let html = `<div class="toggle-row" style="margin-bottom:8px;display:flex;gap:8px;align-items:center">
             <label class="toggle" title="Toggle to show 0-point programs">
               <input type="checkbox" id="show-zero-points-toggle" ${showZeroPoints ? 'checked' : ''} onchange="toggleShowZeroPoints()">
               <span class="toggle-slider"></span>
             </label>
             <span class="text-muted" style="font-size:12px;line-height:1.2;margin-left:6px;">Show programs with 0 points</span>
           </div>`;

  // Rank banks by their combined points balance (highest first) rather than
  // config order, so a bank you're not currently earning with sinks to the
  // bottom instead of always appearing where you first typed it into config.js.
  const bankTotals = {};
  BANK.forEach(p => { bankTotals[p.bank] = (bankTotals[p.bank]||0) + (ST.bank[p.id]?.points||0); });
  const banks = [...new Set(BANK.map(p => p.bank))]
    .sort((a, b) => (bankTotals[b]||0) - (bankTotals[a]||0));

  banks.forEach(bank => {
    // Within a bank, same idea: the program you're actually holding points in
    // floats to the top of that bank's own table.
    const allProgs = BANK.filter(p => p.bank === bank)
      .slice()
      .sort((a, b) => (ST.bank[b.id]?.points||0) - (ST.bank[a.id]?.points||0));
    const progs = showZeroPoints ? allProgs : allProgs.filter(p => (ST.bank[p.id]?.points||0) > 0);
    if (progs.length === 0) return; // whole bank has nothing to show under this filter — skip the section entirely
    html += `
    <div class="sec-hd">
      <div style="width:20px;height:20px;border-radius:4px;overflow:hidden;background:var(--sq-navy-light);display:flex;align-items:center;justify-content:center;border:0.5px solid var(--sq-border)">${logoImg(allProgs[0].logo, bank[0], 20)}</div>
      ${bank}<div class="sec-hd-line"></div>
    </div>
    <div class="card mb-16"><table class="tbl">
      <thead><tr><th>Program</th><th style="text-align:right">Points</th><th style="text-align:right">Transferable pts</th><th style="text-align:right">Miles</th><th>Rate</th><th>Min. block</th><th>Expiry</th><th></th></tr></thead>
      <tbody>
        ${progs.map(p => {
          const d = ST.bank[p.id];
          const pts = d?.points||0;
          const mi = transferableMiles(p, pts);
          const rem = remainderPts(p, pts);
          const transferable = pts - rem;
          const days = daysTo(d?.expiry);
          return `<tr>
            <td><div class="bank-cell"><div class="bank-logo">${logoImg(p.logo, p.bank[0], 28)}</div><span style="font-weight:600;color:var(--sq-navy)">${p.name}</span></div></td>
            <td style="text-align:right" class="mono">${fmt(pts)}</td>
            <td style="text-align:right" class="mono">${fmt(transferable)}${rem > 0 ? `<div style="font-size:10px;color:var(--sq-text-muted)">${fmt(rem)} leftover</div>` : ''}</td>
            <td style="text-align:right;font-weight:600;color:var(--sq-navy)" class="mono">${p.variableRate ? '<span class="text-muted">—</span>' : fmt(mi)}</td>
            <td><span class="rate-pill">${rateStr(p)}</span></td>
            <td class="text-muted text-sm">${fmt(p.fp)} pts</td>
            <td class="${expCls(days)} text-sm">${d?.expiry ? expTxt(d.expiry) : '—'}</td>
            <td><button class="btn btn-sm" onclick="editBank('${p.id}')">Edit</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  });
  html += `<div class="help-note">Transferable pts = points rounded down to the nearest complete block. Leftover points cannot be transferred until you accumulate another full block. Rates shown use the best available FFP transfer partner — verify with your bank before converting.</div>`;
  document.getElementById('pane-bank').innerHTML = html;
}

function toggleShowZeroPoints() {
  showZeroPoints = !showZeroPoints;
  renderBank();
}

// Shared by editBank()'s initial render and its live-update listener.
// variableRate programs (HeyMax) have no fixed block ratio to preview against —
// the real number only exists once you log an actual transfer — so this shows
// the points side plainly instead of fabricating a "→ X miles" figure.
function convPreviewHtml(p, pts) {
  if (p.variableRate) {
    return pts > 0
      ? `${fmt(pts)} pts on hand · rate varies by destination FFP — see Log Transfer`
      : `Min. transfer block: ${fmt(p.fp)} pts · rate varies by destination FFP`;
  }
  const mi = transferableMiles(p, pts);
  const rem = remainderPts(p, pts);
  return pts > 0
    ? `${fmt(pts - rem)} pts transferable → <strong>${fmt(mi)} miles</strong>${rem > 0 ? ` · ${fmt(rem)} pts leftover` : ''}`
    : `${fmt(p.fp)} pts = ${fmt(Math.round(p.tm))} miles · rate: ${rateStr(p)}`;
}

function editBank(id) {
  const p = BANK.find(x => x.id === id);
  const d = ST.bank[id];
  const pts = d?.points||0;
  document.getElementById('modal-hd').innerHTML = `<div class="modal-logo">${logoImg(p.logo, p.bank[0], 34)}</div>${p.name}`;
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label class="form-label">Points balance</label>
      <input class="form-input num-input" type="text" inputmode="numeric" id="e-pts" value="${fmt(pts)}"
        onfocus="if(parseNum(this.value)===0)this.value=''"
        onblur="if(this.value==='')this.value='0'">
    </div>
    <div class="form-group">
      <label class="form-label">Expiry date</label>
      <input class="form-input" type="date" id="e-expiry" value="${d?.expiry||''}">
    </div>
    <div class="form-group">
      <label class="form-label" style="color:var(--sq-text-muted)">Conversion preview</label>
      <div class="ref-box" id="conv-preview">${convPreviewHtml(p, pts)}</div>
    </div>`;

  // Live preview update
  document.getElementById('e-pts').addEventListener('input', e => {
    const v = Math.max(0, Math.round(parseNum(e.target.value)));
    document.getElementById('conv-preview').innerHTML = convPreviewHtml(p, v);
  });

  onSave = async () => {
    const btn = document.getElementById('save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const points = Math.max(0, Math.round(parseNum(document.getElementById('e-pts').value)));
      const expiry = document.getElementById('e-expiry').value;
      const row = await apiFetch('/api/bank/' + id, {method:'PUT', body:JSON.stringify({points, expiry})});
      ST.bank[id] = row;
      closeModal(); renderBank();
      if (activePane === 'dashboard') renderDash();
      showToast(p.name + ' updated ✓');
    } catch(e) { showToast('Save failed: ' + e.message, 3500); }
    finally { btn.disabled = false; btn.textContent = 'Save changes'; }
  };
  openModal();
}
