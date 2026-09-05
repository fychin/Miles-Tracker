/* ── FFP tab ─────────────────────────────────────────────────── */
let showZeroMiles = false;

function renderFFP() {
  let html = '';
  // Toggle to show/hide 0-mile programs
  html += `<div class="toggle-row" style="margin-bottom:8px;display:flex;gap:8px;align-items:center">
             <label class="toggle" title="Toggle to show 0-mile programs">
               <input type="checkbox" id="show-zero-miles-toggle" ${showZeroMiles ? 'checked' : ''} onchange="toggleShowZeroMiles()">
               <span class="toggle-slider"></span>
             </label>
             <span class="text-muted" style="font-size:12px;line-height:1.2;margin-left:6px;">Show programs with 0 miles</span>
           </div>`;

  ALLIANCES.forEach(al => {
    const progs = FFP.filter(p => p.alliance === al);
    const a = AC[al];
    html += `<div class="al-row">${allianceLogo(al)}<div class="al-sep"></div></div>`;
    progs.forEach(p => {
      const d = ST.ffp[p.id];
      const mi = d?.miles||0;
      const days = daysTo(d?.expiry);
      if (!showZeroMiles && (mi||0) <= 0) return;
      html += `<div class="prog-card">
        <div class="prog-logo-wrap">${logoImg(p.logo, p.code, 44)}</div>
        <div class="prog-info">
          <div class="prog-name">${p.name}</div>
          <div class="prog-airline">${p.airline}</div>
          <div class="prog-meta">
            <a class="award-link" href="${p.award}" target="_blank" rel="noopener">Award chart ↗</a>
            ${(() => { const b = ST.costBasis[p.id]; return b && b.cost_per_mile > 0
              ? `<span class="basis-pill">${(b.cost_per_mile*100).toFixed(3)}¢/mi cost</span>`
              : `<span class="basis-pill none">No cost data</span>`; })()}
            ${d?.updated_at ? `<span class="prog-updated">· Updated ${d.updated_at}</span>` : ''}
          </div>
        </div>
        <div class="prog-right">
          <div class="miles-val">${fmt(mi)}</div>
          <div class="miles-unit">miles</div>
          <div class="exp-txt ${expCls(days)}">${expTxt(d?.expiry)}</div>
        </div>
        <button class="btn btn-sm" onclick="editFFP('${p.id}')">Edit</button>
      </div>`;
    });
  });
  document.getElementById('pane-ffp').innerHTML = html;
}

function toggleShowZeroMiles() {
  showZeroMiles = !showZeroMiles;
  renderFFP();
}

function editFFP(id) {
  const p = FFP.find(x => x.id === id);
  const d = ST.ffp[id];
  document.getElementById('modal-hd').innerHTML = `<div class="modal-logo">${logoImg(p.logo, p.code, 34)}</div>${p.name}`;
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label class="form-label">Miles balance</label>
      <input class="form-input num-input" type="text" inputmode="numeric" id="e-miles" value="${fmt(d?.miles||0)}"
        onfocus="if(parseNum(this.value)===0)this.value=''"
        onblur="if(this.value==='')this.value='0'">
    </div>
    <div class="form-group">
      <label class="form-label">Expiry date</label>
      <input class="form-input" type="date" id="e-expiry" value="${d?.expiry||''}">
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <input class="form-input" type="text" id="e-notes" value="${d?.notes||''}" placeholder="e.g. from credit card accrual">
    </div>
    <div style="margin-top:10px"><a href="${p.award}" target="_blank" rel="noopener" style="font-size:12px;color:var(--sq-gold-dark);font-weight:500">View ${p.name} award chart ↗</a></div>`;
  onSave = async () => {
    const btn = document.getElementById('save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const miles  = Math.max(0, Math.round(parseNum(document.getElementById('e-miles').value)));
      const expiry = document.getElementById('e-expiry').value;
      const notes  = document.getElementById('e-notes').value;
      const row = await apiFetch('/api/ffp/' + id, {method:'PUT', body:JSON.stringify({miles, expiry, notes})});
      ST.ffp[id] = row;
      closeModal(); renderFFP();
      if (activePane === 'dashboard') renderDash();
      showToast(p.name + ' updated ✓');
    } catch(e) { showToast('Save failed: ' + e.message, 3500); }
    finally { btn.disabled = false; btn.textContent = 'Save changes'; }
  };
  openModal();
}
