/* ── Tabs ────────────────────────────────────────────────────── */
let activePane = 'dashboard';

function gotoTab(t) {
  // Match by each button's own data-tab attribute, not by array position.
  // The previous version toggled `.active` via `TABS[i] === t` — a hardcoded
  // array that has to be kept in the exact same order as the <button> tags
  // in index.html. The moment those two orderings drift apart (e.g. moving
  // a tab button without also reordering this array), clicks start
  // highlighting the wrong tab. Reading each button's own data-tab removes
  // that fragile coupling entirely — button order in the HTML can change
  // freely with zero risk of this class of bug recurring.
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
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
