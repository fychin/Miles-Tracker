/* ── Tabs ────────────────────────────────────────────────────── */
let activePane = 'dashboard';

function gotoTab(t) {
  const TABS = ['dashboard','ffp','bank','activity','redemptions','costbasis','settings'];
  document.querySelectorAll('.tab-btn').forEach((b,i) => b.classList.toggle('active', TABS[i] === t));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('pane-' + t).classList.add('active');
  activePane = t;
  if (t === 'dashboard') renderDash();
  else if (t === 'ffp')  renderFFP();
  else if (t === 'bank') renderBank();
  else if (t === 'activity') renderActivity();
  else if (t === 'redemptions') renderRedemptions();
  else if (t === 'costbasis') renderCostBasis();
  else renderSettings();
}
