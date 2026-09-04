/* ── Modal ───────────────────────────────────────────────────── */
let onSave = null;

function openModal() {
  document.getElementById('modal').style.display = 'flex';
  setTimeout(() => document.querySelector('.form-input')?.focus(), 50);
}
function closeModal() {
  document.getElementById('modal').style.display = 'none';
  document.querySelector('#modal .modal').classList.remove('wide');
  onSave = null;
}
function doSave() { if (onSave) onSave(); }
document.getElementById('modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && document.getElementById('modal').style.display !== 'none') { e.preventDefault(); doSave(); }
});
