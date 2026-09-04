/* ── Boot ────────────────────────────────────────────────────── */
(async () => { await loadData(); renderDash(); })();
loadAirports(); // fire-and-forget in background; awaited explicitly before map render
