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
