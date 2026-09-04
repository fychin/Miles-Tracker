/* ── Dashboard ───────────────────────────────────────────────── */
let barChart = null;

function renderDash() {
  const topFFP = FFP.map(p => ({p, m: ST.ffp[p.id]?.miles||0})).sort((a,b) => b.m - a.m)[0];
  const bankMi = BANK.reduce((s, p) => s + transferableMiles(p, ST.bank[p.id]?.points), 0);
  let milesAtRisk = 0;
  let bankPtsAtRiskMi = 0;
  const alerts = [];
  FFP.forEach(p => {
    const d = ST.ffp[p.id];
    if (d && d.expiry && d.miles > 0) {
      const days = daysTo(d.expiry);
      if (days !== null && days <= 90) { milesAtRisk += d.miles; alerts.push({name:p.name, val:fmt(d.miles), unit:'miles', days, logo:p.logo, fb:p.code}); }
    }
  });
  BANK.forEach(p => {
    const d = ST.bank[p.id];
    if (d && d.expiry && d.points > 0) {
      const days = daysTo(d.expiry);
      if (days !== null && days <= 90) {
        // Bank points expire too — count their transferable-miles equivalent
        // toward the same "at risk" total so it isn't silently excluded.
        const miEquiv = transferableMiles(p, d.points);
        bankPtsAtRiskMi += miEquiv;
        milesAtRisk += miEquiv;
        alerts.push({name:p.name, val:fmt(d.points), unit:'pts', days, logo:p.logo, fb:p.bank[0]});
      }
    }
  });
  alerts.sort((a,b) => a.days - b.days);
  const ffpActive  = FFP.filter(p  => ST.ffp[p.id]?.miles  > 0).length;
  const bankActive = BANK.filter(p => ST.bank[p.id]?.points > 0).length;

  let alertHtml = '';
  if (alerts.length) {
    alertHtml = '<div class="sec-hd">Action needed<div class="sec-hd-line"></div></div>';
    alerts.forEach(a => {
      const cls = a.days <= 30 ? 'alert-danger' : 'alert-warn';
      const when = a.days <= 0 ? '<strong>already expired</strong>' : 'expiring in <strong>' + a.days + 'd</strong>';
      alertHtml += `<div class="alert ${cls}">
        <div style="width:24px;height:24px;border-radius:5px;overflow:hidden;background:rgba(0,0,0,.07);flex-shrink:0;display:flex;align-items:center;justify-content:center">${logoImg(a.logo, a.fb, 24)}</div>
        <div>${a.name} — <strong>${a.val} ${a.unit}</strong> ${when}</div>
      </div>`;
    });
  }

  // Chart: only programmes with miles > 0
  const chartProgs = FFP.filter(p => (ST.ffp[p.id]?.miles||0) > 0);

  document.getElementById('pane-dashboard').innerHTML = `
    ${apiBanner()}
    <div class="grid4">
      <div class="metric-card">
        <div class="metric-label">Top FFP balance</div>
        <div class="metric-value gold">${fmt(topFFP.m)}</div>
        <div class="metric-sub">${topFFP.m > 0 ? topFFP.p.name + ' (' + topFFP.p.code + ')' : 'No balances yet'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Bank pts → miles</div>
        <div class="metric-value gold">~${fmt(bankMi)}</div>
        <div class="metric-sub">After block rounding</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Miles at risk</div>
        <div class="metric-value ${milesAtRisk > 0 ? 'risk' : ''}">${fmt(milesAtRisk)}</div>
        <div class="metric-sub" title="${bankPtsAtRiskMi > 0 ? 'Includes '+fmt(bankPtsAtRiskMi)+' mi worth of bank points expiring within 90 days, converted at each bank transfer rate.' : ''}">Expiring within 90 days${bankPtsAtRiskMi > 0 ? ' · incl. bank pts as mi' : ''}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Portfolio</div>
        <div class="metric-value">${ffpActive} <span style="font-size:13px;font-weight:400;color:rgba(255,255,255,.45)">FFP</span></div>
        <div class="metric-sub">${bankActive} bank program${bankActive !== 1 ? 's' : ''} tracked</div>
      </div>
    </div>
    ${alertHtml}
    ${chartProgs.length > 0 ? `
    <div class="sec-hd" style="margin-top:${alertHtml ? '1.25rem' : '0'}">FFP miles by program<div class="sec-hd-line"></div></div>
    <div class="card mb-16">
      <div style="position:relative;height:${chartProgs.length <= 2 ? 140 : 195}px"><canvas id="bar-canvas"></canvas></div>
    </div>` : ''}
    <div class="sec-hd">Bank points — miles potential<div class="sec-hd-line"></div></div>
    <div class="card">
      ${bankActive === 0 ? `<div style="text-align:center;padding:1.5rem;color:var(--sq-text-muted);font-size:13px">No bank points entered yet. Go to <strong>Bank Points</strong> to add your balances.</div>` : `
      <table class="tbl">
        <thead><tr><th>Program</th><th style="text-align:right">Points</th><th style="text-align:right">Transferable (pts)</th><th style="text-align:right">Miles</th><th>Rate</th><th>Expiry</th></tr></thead>
        <tbody>
          ${BANK.filter(p => (ST.bank[p.id]?.points||0) > 0).map(p => {
            const d = ST.bank[p.id];
            const pts = d?.points||0;
            const mi = transferableMiles(p, pts);
            const rem = remainderPts(p, pts);
            const transferable = pts - rem;
            const days = daysTo(d?.expiry);
            return `<tr>
              <td><div class="bank-cell"><div class="bank-logo">${logoImg(p.logo, p.bank[0], 28)}</div><span style="font-size:12px;font-weight:600;color:var(--sq-navy)">${p.name}</span></div></td>
              <td style="text-align:right" class="mono">${fmt(pts)} pts</td>
              <td style="text-align:right" class="mono">${fmt(transferable)} pts${rem > 0 ? `<div style="font-size:10px;color:var(--sq-text-muted)" title="Points below the ${fmt(p.fp)}-pt transfer block — can't move to an FFP until you earn enough more to complete another block">${fmt(rem)} pts leftover, below min. block</div>` : ''}</td>
              <td style="text-align:right" class="mono" style="font-weight:600">${fmt(mi)} mi</td>
              <td><span class="rate-pill">${rateStr(p)}</span></td>
              <td class="${expCls(days)} text-sm">${d?.expiry ? expTxt(d.expiry) : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="help-note" style="margin-top:10px">"Transferable (pts)" is your balance rounded down to the nearest complete transfer block for that bank; "leftover" points sit below the minimum block size (shown as pts) and can't convert until you earn more. "Miles" is what those transferable points become at the bank's best available FFP rate.</div>`}
    </div>`;

  if (chartProgs.length > 0) {
    setTimeout(() => {
      const ctx = document.getElementById('bar-canvas');
      if (!ctx) return;
      if (barChart) barChart.destroy();
      barChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: chartProgs.map(p => p.name),
          datasets: [{
            data: chartProgs.map(p => ST.ffp[p.id]?.miles||0),
            backgroundColor: chartProgs.map(p => p.color || AC[p.alliance]?.bg || '#eee'),
            borderColor: chartProgs.map(p => p.color || AC[p.alliance]?.fg || '#bbb'),
            borderWidth: 1.5, borderRadius: 5,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {legend:{display:false}, tooltip:{callbacks:{label:c => ' ' + fmt(c.raw) + ' miles'}}},
          scales: {
            y: {beginAtZero:true, grid:{color:'rgba(13,31,92,.06)'}, ticks:{font:{size:10}, callback:v => v>=1000?(v/1000)+'k':v}},
            x: {grid:{display:false}, ticks:{font:{size:10}, maxRotation:28, autoSkip:false}}
          }
        }
      });
    }, 60);
  }
}

/* ── Alliance label ───────────────────────────────────────────────────────── */
function allianceLogo(al) {
  return `<span class="al-text">${al}</span>`;
}
