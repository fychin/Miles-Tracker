/* ── Modal ───────────────────────────────────────────────────── */
let onSave = null;

function openModal() {
  document.getElementById('modal').style.display = 'flex';
  // {preventScroll:true} stops the browser's default focus-triggered
  // scrollIntoView — without it, focusing an input inside this fixed-position
  // overlay was resetting the underlying page's scroll to the top every time
  // a modal opened, since the browser tries to scroll the nearest non-fixed
  // ancestor (the body) to "reveal" a fixed-position element.
  setTimeout(() => document.querySelector('.form-input')?.focus({preventScroll:true}), 50);
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
