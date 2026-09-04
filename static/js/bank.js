/* ── Bank tab ────────────────────────────────────────────────── */
function renderBank() {
  const banks = [...new Set(BANK.map(p => p.bank))];
  let html = '';
  banks.forEach(bank => {
    const progs = BANK.filter(p => p.bank === bank);
    html += `
    <div class="sec-hd">
      <div style="width:20px;height:20px;border-radius:4px;overflow:hidden;background:var(--sq-navy-light);display:flex;align-items:center;justify-content:center;border:0.5px solid var(--sq-border)">${logoImg(progs[0].logo, bank[0], 20)}</div>
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
            <td style="text-align:right;font-weight:600;color:var(--sq-navy)" class="mono">${fmt(mi)}</td>
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

function editBank(id) {
  const p = BANK.find(x => x.id === id);
  const d = ST.bank[id];
  const pts = d?.points||0;
  const mi = transferableMiles(p, pts);
  const rem = remainderPts(p, pts);
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
      <div class="ref-box" id="conv-preview">
        ${pts > 0 ? `${fmt(pts - rem)} pts transferable → <strong>${fmt(mi)} miles</strong>${rem > 0 ? ` · ${fmt(rem)} pts leftover` : ''}` : `${fmt(p.fp)} pts = ${fmt(Math.round(p.tm))} miles · rate: ${rateStr(p)}`}
      </div>
    </div>`;

  // Live preview update
  document.getElementById('e-pts').addEventListener('input', e => {
    const v = Math.max(0, Math.round(parseNum(e.target.value)));
    const m = transferableMiles(p, v);
    const r = remainderPts(p, v);
    const t = v - r;
    document.getElementById('conv-preview').innerHTML =
      v > 0 ? `${fmt(t)} pts transferable → <strong>${fmt(m)} miles</strong>${r > 0 ? ` · ${fmt(r)} pts leftover` : ''}`
             : `${fmt(p.fp)} pts = ${fmt(Math.round(p.tm))} miles · rate: ${rateStr(p)}`;
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
