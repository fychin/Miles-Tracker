/* ── Activity tab ────────────────────────────────────────────── */
async function renderActivity() {
  document.getElementById('pane-activity').innerHTML = '<div style="color:var(--sq-text-muted);font-size:13px;padding:2rem 0">Loading…</div>';
  try {
    const rows = await apiFetch('/api/activity');
    const ffpMap  = Object.fromEntries(FFP.map(p  => [p.id, p]));
    const bankMap = Object.fromEntries(BANK.map(p => [p.id, p]));
    document.getElementById('pane-activity').innerHTML = `
    ${apiBanner()}
    <div class="sec-hd">Recent changes<div class="sec-hd-line"></div></div>
    <div class="card">
      <table class="tbl">
        <thead><tr><th>When</th><th>Program</th><th style="text-align:right">Before</th><th style="text-align:right">After</th><th>Change</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map(r => {
            if (r.kind === 'system') return `<tr><td colspan="5" style="color:var(--sq-text-muted);font-size:12px;font-style:italic;padding:9px 10px">${r.note}</td></tr>`;
            const prog = r.kind === 'ffp' ? ffpMap[r.record_id] : bankMap[r.record_id];
            const unit = r.kind === 'ffp' ? 'mi' : 'pts';
            const delta = (r.new_val||0) - (r.old_val||0);
            const sign  = delta >= 0 ? '+' : '';
            const dcol  = delta < 0 ? 'color:var(--sq-danger)' : delta > 0 ? 'color:var(--sq-ok)' : 'color:var(--sq-text-muted)';
            const name  = prog?.name || r.record_id;
            const ts    = new Date(r.ts + 'Z').toLocaleString('en-SG', {dateStyle:'medium', timeStyle:'short'});
            return `<tr>
              <td class="text-muted text-sm">${ts}</td>
              <td style="font-weight:600;color:var(--sq-navy)">${name}</td>
              <td style="text-align:right" class="mono">${r.old_val !== null ? fmt(r.old_val) + ' ' + unit : '—'}</td>
              <td style="text-align:right" class="mono">${fmt(r.new_val)} ${unit}</td>
              <td class="mono" style="${dcol}">${r.old_val !== null ? sign + fmt(delta) + ' ' + unit : 'new'}</td>
            </tr>`;
          }).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--sq-text-muted);padding:2rem">No activity yet.</td></tr>`}
        </tbody>
      </table>
    </div>`;
  } catch(e) {
    document.getElementById('pane-activity').innerHTML = `<div class="api-banner"><span class="api-dot err"></span>Could not load activity log.</div>`;
  }
}
