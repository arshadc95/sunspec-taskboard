document.querySelector('[data-nav-toggle]')?.addEventListener('click', () => {
  document.body.classList.toggle('nav-open');
});

document.querySelector('[data-nav-close]')?.addEventListener('click', () => {
  document.body.classList.remove('nav-open');
});

document.addEventListener('submit', (event) => {
  const message = event.target.getAttribute?.('data-confirm');
  if (message && !window.confirm(message)) event.preventDefault();
});

document.addEventListener('click', (event) => {
  const row = event.target.closest?.('[data-href]');
  if (!row || event.target.closest('a, button, input, select, textarea, label, form')) return;
  window.location.href = row.getAttribute('data-href');
});

function readJson(id) {
  const node = document.getElementById(id);
  if (!node) return [];
  try { return JSON.parse(node.textContent || '[]'); } catch { return []; }
}

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

document.querySelectorAll('form[data-live]').forEach((form) => {
  const go = () => {
    const params = new URLSearchParams();
    new FormData(form).forEach((value, key) => {
      if (String(value).trim() !== '') params.append(key, value);
    });
    const next = `${form.getAttribute('action') || location.pathname}${params.toString() ? `?${params}` : ''}`;
    const current = `${location.pathname}${location.search}`;
    if (next !== current) location.assign(next);
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); go(); });
  form.querySelectorAll('select, input[type="checkbox"]').forEach((field) => field.addEventListener('change', go));
  const search = form.querySelector('input[type="search"]');
  let timer = 0;
  search?.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(go, 300);
  });
  const csv = form.querySelector('[data-csv]');
  const syncCsv = () => {
    if (!csv) return;
    const params = new URLSearchParams();
    new FormData(form).forEach((value, key) => {
      if (String(value).trim() !== '') params.append(key, value);
    });
    csv.setAttribute('href', `/export.csv${params.toString() ? `?${params}` : ''}`);
  };
  form.addEventListener('input', syncCsv);
  form.addEventListener('change', syncCsv);
});

document.querySelectorAll('[data-filters-toggle]').forEach((button) => {
  button.addEventListener('click', () => button.closest('form')?.classList.toggle('is-open'));
});

document.querySelectorAll('[data-done-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const rows = button.closest('table')?.querySelector('.done-rows');
    if (!rows) return;
    const open = rows.hasAttribute('hidden');
    rows.toggleAttribute('hidden', !open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
});

const drawer = document.getElementById('task-drawer');
function openDrawer() {
  if (!drawer?.showModal) {
    window.location.href = '/tasks/new';
    return;
  }
  if (!drawer.open) drawer.showModal();
  drawer.querySelector('input[name="title"]')?.focus();
}
document.querySelectorAll('[data-open-drawer]').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (!drawer) return;
    event.preventDefault();
    openDrawer();
  });
});
document.querySelectorAll('[data-close-drawer]').forEach((button) => {
  button.addEventListener('click', () => drawer?.close());
});
if (drawer?.hasAttribute('data-open')) openDrawer();
document.addEventListener('keydown', (event) => {
  const typing = event.target.closest('input, textarea, select');
  if (event.key === 'n' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    openDrawer();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    const form = event.target.closest?.('.task-form');
    if (form) form.requestSubmit();
  }
});

document.querySelectorAll('[data-priority]').forEach((button) => {
  button.addEventListener('click', () => {
    const wrap = button.parentElement;
    wrap.querySelectorAll('[data-priority]').forEach((item) => item.classList.remove('on'));
    button.classList.add('on');
    const input = button.closest('.field')?.querySelector('[data-priority-input]');
    if (input) input.value = button.getAttribute('data-priority') || '';
  });
});

document.querySelectorAll('[data-due]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = button.closest('.field')?.querySelector('[data-due-input]');
    if (input) input.value = button.getAttribute('data-due') || '';
  });
});

document.querySelectorAll('[data-assign-me]').forEach((button) => {
  button.addEventListener('click', () => {
    const combo = button.closest('.combo');
    const id = button.getAttribute('data-assign-me');
    const hidden = combo?.querySelector('[data-user-id]');
    const text = combo?.querySelector('[data-user-input]');
    const person = readJson('people-data').find((item) => String(item.id) === String(id));
    if (hidden) hidden.value = id;
    if (text && person) text.value = person.name;
  });
});

function attachCombo(input, hidden, items, label) {
  if (!input || !hidden) return;
  const menu = document.createElement('div');
  menu.className = 'combo-menu';
  menu.hidden = true;
  input.parentElement?.append(menu);
  let index = 0;
  const render = () => {
    const query = input.value.trim().toLowerCase();
    const matches = items.filter((item) => item.name.toLowerCase().includes(query)).slice(0, 8);
    menu.innerHTML = '';
    matches.forEach((item, itemIndex) => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.textContent = item.name;
      if (itemIndex === index) choice.classList.add('active');
      choice.addEventListener('mousedown', (event) => {
        event.preventDefault();
        input.value = item.name;
        hidden.value = item.id;
        menu.hidden = true;
      });
      menu.append(choice);
    });
    menu.hidden = matches.length === 0;
  };
  input.addEventListener('input', () => { hidden.value = ''; index = 0; render(); });
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (event) => {
    const buttons = [...menu.querySelectorAll('button')];
    if (event.key === 'ArrowDown') { event.preventDefault(); index = Math.min(buttons.length - 1, index + 1); render(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); index = Math.max(0, index - 1); render(); }
    if (event.key === 'Enter' && !menu.hidden && buttons[index]) {
      event.preventDefault();
      buttons[index].dispatchEvent(new MouseEvent('mousedown'));
    }
    if (event.key === 'Escape') menu.hidden = true;
  });
  input.addEventListener('blur', () => { window.setTimeout(() => { menu.hidden = true; }, 150); });
}

document.querySelectorAll('[data-project-input]').forEach((input) => {
  attachCombo(input, input.parentElement.querySelector('[data-project-id]'), readJson('project-data'), 'project');
});
document.querySelectorAll('[data-user-input]').forEach((input) => {
  attachCombo(input, input.parentElement.querySelector('[data-user-id]'), readJson('people-data'), 'person');
});

const mentionMenu = document.createElement('div');
mentionMenu.className = 'mention-menu';
mentionMenu.hidden = true;
document.body.append(mentionMenu);
let mentionIndex = 0;
let mentionTarget = null;

function mentionQuery(field) {
  const before = field.value.slice(0, field.selectionStart);
  const match = /(?:^|\s)@([^\n@]*)$/.exec(before);
  if (!match) return null;
  return { text: match[1], start: before.length - match[1].length - 1 };
}

function placeMenu(field) {
  const rect = field.getBoundingClientRect();
  mentionMenu.style.left = `${rect.left + window.scrollX}px`;
  mentionMenu.style.top = `${rect.bottom + window.scrollY + 4}px`;
}

function renderMentions(field) {
  const query = mentionQuery(field);
  mentionTarget = field;
  if (!query) { mentionMenu.hidden = true; return; }
  const people = readJson('people-data').filter((person) => person.name.toLowerCase().includes(query.text.toLowerCase())).slice(0, 8);
  mentionMenu.innerHTML = '';
  if (!people.length) { mentionMenu.hidden = true; return; }
  people.forEach((person, index) => {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.textContent = person.name;
    if (index === mentionIndex) choice.classList.add('active');
    choice.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const current = mentionQuery(field);
      if (!current) return;
      const token = `@[${person.name}](${person.id}) `;
      const next = field.value.slice(0, current.start) + token + field.value.slice(field.selectionStart);
      field.value = next;
      const cursor = current.start + token.length;
      field.setSelectionRange(cursor, cursor);
      mentionMenu.hidden = true;
      field.focus();
    });
    mentionMenu.append(choice);
  });
  placeMenu(field);
  mentionMenu.hidden = false;
}

document.addEventListener('input', (event) => {
  if (!event.target.matches?.('[data-mentions]')) return;
  mentionIndex = 0;
  renderMentions(event.target);
});
document.addEventListener('keydown', (event) => {
  if (mentionMenu.hidden || !event.target.matches?.('[data-mentions]')) return;
  const buttons = [...mentionMenu.querySelectorAll('button')];
  if (event.key === 'ArrowDown') { event.preventDefault(); mentionIndex = Math.min(buttons.length - 1, mentionIndex + 1); renderMentions(event.target); }
  if (event.key === 'ArrowUp') { event.preventDefault(); mentionIndex = Math.max(0, mentionIndex - 1); renderMentions(event.target); }
  if (event.key === 'Enter' && buttons[mentionIndex]) { event.preventDefault(); buttons[mentionIndex].dispatchEvent(new MouseEvent('mousedown')); }
  if (event.key === 'Escape') mentionMenu.hidden = true;
});

if (new URLSearchParams(location.search).get('toast') === 'done' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const colors = ['#f97316', '#16a34a', '#111111', '#facc15'];
  for (let i = 0; i < 28; i += 1) {
    const bit = document.createElement('i');
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = `${Math.random() * 200}ms`;
    layer.append(bit);
  }
  document.body.append(layer);
  window.setTimeout(() => layer.remove(), 1100);
}
