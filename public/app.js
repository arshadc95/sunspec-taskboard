document.querySelector('[data-nav-toggle]')?.addEventListener('click', () => {
  document.body.classList.toggle('nav-open');
});

document.querySelector('[data-nav-close]')?.addEventListener('click', () => {
  document.body.classList.remove('nav-open');
});

document.addEventListener('submit', (event) => {
  const message = event.target.getAttribute('data-confirm');
  if (message && !window.confirm(message)) event.preventDefault();
});

document.addEventListener('click', (event) => {
  const row = event.target.closest('[data-href]');
  if (!row || event.target.closest('a, button, input, select, textarea, label, form')) return;
  window.location.href = row.getAttribute('data-href');
});

function formatElapsed(startedAt) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return '';
  const total = Math.max(0, Math.round((Date.now() - start) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function tickTimers() {
  document.querySelectorAll('[data-started]').forEach((node) => {
    const output = node.querySelector('.timer-elapsed');
    if (output) output.textContent = formatElapsed(node.getAttribute('data-started'));
  });
}

tickTimers();
setInterval(tickTimers, 1000);
