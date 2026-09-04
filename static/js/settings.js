/* ── Settings tab ────────────────────────────────────────────── */
let importData = null;

function renderSettings() {
  document.getElementById('pane-settings').innerHTML = `
    ${apiBanner()}
    <div class="sec-hd">Backup & Restore<div class="sec-hd-line"></div></div>
    <div class="card mb-16">
      <div style="font-size:13px;color:var(--sq-text-mid);margin-bottom:1rem;line-height:1.7">
        Export your data as a JSON file for backup. You can restore it later — either as a <strong>merge</strong> (adds/updates records, keeps existing data) or a <strong>full reset</strong> (wipes the database and replaces it entirely with the imported file).
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:1.5rem">
        <a href="/api/export" class="btn btn-gold" style="display:inline-flex;align-items:center;gap:5px">↓ Export JSON backup</a>
      </div>

      <div style="font-size:12px;font-weight:600;color:var(--sq-navy);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Restore from JSON</div>
      <div class="import-zone" id="import-zone" onclick="document.getElementById('import-file').click()">
        <input type="file" id="import-file" accept=".json" onchange="handleImportFile(this)">
        <div style="font-size:22px;margin-bottom:6px;color:var(--sq-text-muted)">⬆</div>
        <div style="font-size:13px;font-weight:500;color:var(--sq-text-mid)">Click to choose a JSON export file</div>
        <div style="font-size:11px;color:var(--sq-text-muted);margin-top:4px">or drag and drop here</div>
      </div>
      <div id="import-preview" style="display:none;margin-top:1rem">
        <div class="ref-box" id="import-preview-box"></div>
        <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="doImport(false)">Merge into database</button>
          <button class="btn btn-danger" onclick="confirmReset()">⚠ Reset & restore</button>
        </div>
      </div>
      <div id="import-result" style="display:none;margin-top:1rem"></div>
    </div>

    <div class="sec-hd">Data<div class="sec-hd-line"></div></div>
    <div class="card">
      <div style="font-size:13px;color:var(--sq-text-mid);margin-bottom:1rem">Permanently delete all data from the database. This cannot be undone.</div>
      <button class="btn btn-danger" onclick="confirmClearAll()">⚠ Clear all data</button>
    </div>`;

  // Drag-and-drop
  const zone = document.getElementById('import-zone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--sq-gold)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file) loadImportFile(file);
  });
}

function handleImportFile(input) {
  if (input.files[0]) loadImportFile(input.files[0]);
}

function loadImportFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      importData = JSON.parse(e.target.result);
      const ffpCnt  = importData.ffp?.length  || 0;
      const bankCnt = importData.bank?.length || 0;
      const expDate = importData.exported_at ? new Date(importData.exported_at).toLocaleString('en-SG') : 'unknown';
      document.getElementById('import-preview-box').innerHTML =
        `<strong>File loaded:</strong> ${file.name}<br>
         ${ffpCnt} FFP record${ffpCnt!==1?'s':''} · ${bankCnt} bank record${bankCnt!==1?'s':''}<br>
         Exported: ${expDate}`;
      document.getElementById('import-preview').style.display = 'block';
      document.getElementById('import-result').style.display = 'none';
    } catch(err) {
      showToast('Invalid JSON file', 3000);
    }
  };
  reader.readAsText(file);
}

async function doImport(reset) {
  if (!importData) return;
  const url = '/api/import' + (reset ? '?reset=true' : '');
  try {
    const result = await apiFetch(url, {method:'POST', body:JSON.stringify(importData)});
    await loadData();
    const msg = reset ? `Database reset and restored: ${result.imported.ffp} FFP, ${result.imported.bank} bank records.`
                    : `Merged: ${result.imported.ffp} FFP, ${result.imported.bank} bank records.`;
    document.getElementById('import-result').style.display = 'block';
    document.getElementById('import-result').innerHTML = `<div class="alert" style="background:rgba(26,107,47,.08);color:var(--sq-ok);border:0.5px solid rgba(26,107,47,.25)">✓ ${msg}</div>`;
    document.getElementById('import-preview').style.display = 'none';
    importData = null;
    showToast('Import complete ✓');
  } catch(err) { showToast('Import failed: ' + err.message, 3500); }
}

function confirmReset() {
  if (confirm('⚠ This will DELETE all current data and replace it with the imported file.\n\nAre you sure?')) {
    doImport(true);
  }
}

async function confirmClearAll() {
  if (confirm('⚠ This will permanently delete ALL your miles and points data.\n\nType "DELETE" in the next dialog to confirm.')) {
    const confirm2 = prompt('Type DELETE to confirm:');
    if (confirm2 === 'DELETE') {
      try {
        await apiFetch('/api/import?reset=true', {method:'POST', body:JSON.stringify({ffp:[], bank:[]})});
        await loadData();
        showToast('All data cleared');
        renderSettings();
      } catch(e) { showToast('Error: ' + e.message, 3500); }
    }
  }
}
