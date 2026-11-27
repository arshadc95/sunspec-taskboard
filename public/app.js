import { backdropCloses } from './dialog-close.js';
import { acceptGrokFiles, applyGrokClick, grokFileView, grokMessageBlocks, grokQueuedLabel, grokShouldQueue, grokThreadVisible } from './grok-panel.js';
import { cardAt, moveStandardsDeck, openStandardsDeck } from './standards-deck.js';

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

let openDrawer = () => {};
let taskDirty = false;
let contentAbort = null;
let contentSignal = null;

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

function bindContent(root) {
  if (!root) return;
  contentAbort?.abort();
  contentAbort = new AbortController();
  contentSignal = contentAbort.signal;
const standardRoot = root.querySelector('[data-standard]');
const standardList = readJson('standards-data');
if (standardRoot && standardList.length) {
  const code = standardRoot.querySelector('[data-std-code]');
  const title = standardRoot.querySelector('[data-std-title]');
  const why = standardRoot.querySelector('[data-std-why]');
  const deckKey = 'std-deck';
  const readDeck = () => {
    try { return JSON.parse(localStorage.getItem(deckKey) || 'null'); } catch { return null; }
  };
  const writeDeck = (deck) => {
    try { localStorage.setItem(deckKey, JSON.stringify({ order: deck.order, pos: deck.pos })); } catch { /* private mode */ }
  };
  let deck = openStandardsDeck(standardList, readDeck());
  const show = () => {
    const item = cardAt(standardList, deck);
    if (!item) return;
    if (title) title.textContent = item.title;
    if (code) code.textContent = item.code;
    if (why) why.textContent = item.why;
    writeDeck(deck);
  };
  show();
  standardRoot.querySelector('[data-std-prev]')?.addEventListener('click', () => {
    deck = moveStandardsDeck(standardList, deck, -1);
    show();
  });
  standardRoot.querySelector('[data-std-next]')?.addEventListener('click', () => {
    deck = moveStandardsDeck(standardList, deck, 1);
    show();
  });
}

function taskEditDirty(root) {
  const form = root.querySelector('#task-edit');
  const saves = [...root.querySelectorAll('[data-task-save]')];
  if (!form || !saves.length) return;
  const serial = () => [...new FormData(form).entries()]
    .filter(([key]) => key !== '_csrf')
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const initial = serial();
  taskDirty = false;
  const refresh = () => {
    taskDirty = serial() !== initial;
    saves.forEach((button) => { button.disabled = !taskDirty; });
  };
  const signal = contentSignal;
  form.addEventListener('input', refresh, { signal });
  form.addEventListener('change', refresh, { signal });
  form.addEventListener('click', refresh, { signal });
  const side = root.querySelector('.task-side');
  side?.addEventListener('input', refresh, { signal });
  side?.addEventListener('change', refresh, { signal });
  side?.addEventListener('click', refresh, { signal });
  form.addEventListener('submit', () => { taskDirty = false; }, { signal });
  refresh();
}

root.querySelectorAll('form[data-live]').forEach((form) => {
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

root.querySelectorAll('[data-filters-toggle]').forEach((button) => {
  button.addEventListener('click', () => button.closest('form')?.classList.toggle('is-open'));
});

root.querySelectorAll('[data-done-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const rows = button.closest('table')?.querySelector('.done-rows');
    if (!rows) return;
    const open = rows.hasAttribute('hidden');
    rows.toggleAttribute('hidden', !open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
});

const drawer = root.querySelector('#task-drawer');
openDrawer = () => {
  if (!drawer?.showModal) {
    window.location.href = '/tasks/new';
    return;
  }
  if (!drawer.open) drawer.showModal();
  drawer.querySelector('input[name="title"]')?.focus();
};
root.querySelectorAll('[data-open-drawer]').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (!drawer) return;
    event.preventDefault();
    openDrawer();
  });
});
root.querySelectorAll('[data-close-drawer]').forEach((button) => {
  button.addEventListener('click', () => drawer?.close());
});
if (drawer?.hasAttribute('data-open')) openDrawer();
drawer?.addEventListener('cancel', (event) => {
  event.preventDefault();
  drawer.close();
});
wireBackdrop(drawer, () => drawer.close());
drawer?.querySelector('.task-form')?.addEventListener('submit', () => drawer.close());

const reviewDialog = root.querySelector('#review-dialog');
const reviewForm = reviewDialog?.querySelector('[data-review-form]');
const reviewerSearch = reviewForm?.querySelector('[data-reviewer-search]');
const reviewerId = reviewForm?.querySelector('[data-reviewer-id]');
if (reviewDialog && reviewForm && reviewerSearch && reviewerId) {
  const menu = document.createElement('div');
  menu.className = 'combo-menu';
  menu.hidden = true;
  armCombo(menu);
  watchMenu(menu, reviewerSearch);
  let menuIndex = 0;
  let chosenName = '';
  const renderReviewers = () => {
    const query = reviewerSearch.value.trim().toLowerCase();
    const matches = readJson('people-data').filter((item) => item.name.toLowerCase().includes(query)).slice(0, 8);
    menu.innerHTML = '';
    matches.forEach((item, itemIndex) => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.textContent = item.name;
      if (itemIndex === menuIndex) choice.classList.add('active');
      choice.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        reviewerId.value = String(item.id);
        chosenName = item.name;
        reviewerSearch.value = item.name;
        menu.hidden = true;
      });
      menu.append(choice);
    });
    menu.hidden = matches.length === 0;
    if (!menu.hidden) {
      hideOtherMenus(menu);
      placeCombo(menu, reviewerSearch);
    }
  };
  reviewerSearch.addEventListener('input', () => {
    if (reviewerSearch.value !== chosenName) reviewerId.value = '';
    menuIndex = 0;
    renderReviewers();
  });
  reviewerSearch.addEventListener('focus', renderReviewers);
  reviewerSearch.addEventListener('keydown', (event) => {
    const buttons = [...menu.querySelectorAll('button')];
    if (event.key === 'ArrowDown') { event.preventDefault(); menuIndex = Math.min(buttons.length - 1, menuIndex + 1); renderReviewers(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); menuIndex = Math.max(0, menuIndex - 1); renderReviewers(); }
    if (event.key === 'Enter' && !menu.hidden && buttons[menuIndex]) {
      event.preventDefault();
      buttons[menuIndex].dispatchEvent(new MouseEvent('mousedown'));
    }
  });
  const closeReview = () => { menu.hidden = true; reviewDialog.close(); };
  root.querySelectorAll('[data-send-review]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      reviewForm.action = `/tasks/${button.dataset.task}/review`;
      reviewForm.querySelector('[data-review-back]').value = button.dataset.back || '/';
      reviewerId.value = '';
      chosenName = '';
      reviewerSearch.value = '';
      const note = reviewForm.querySelector('[name="note"]');
      if (note) note.value = '';
      if (!reviewDialog.open) reviewDialog.showModal();
      reviewerSearch.focus();
    });
  });
  reviewDialog.querySelector('[data-close-review]')?.addEventListener('click', closeReview);
  reviewDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeReview();
  });
  wireBackdrop(reviewDialog, closeReview);
  root.querySelectorAll('[data-fill-duration]').forEach((button) => {
    button.addEventListener('click', () => {
      const form = button.closest('form');
      const input = form?.querySelector('[name="duration"]');
      if (!input) return;
      input.value = button.getAttribute('data-fill-duration') || '';
      form.querySelectorAll('[data-fill-duration]').forEach((item) => item.classList.toggle('on', item === button));
    });
  });
  root.querySelectorAll('[data-set-date]').forEach((button) => {
    button.addEventListener('click', () => {
      const form = button.closest('form');
      const input = form?.querySelector('[name="due_date"]');
      if (input) input.value = button.getAttribute('data-set-date') || '';
      form?.querySelectorAll('[data-set-date]').forEach((item) => item.classList.toggle('on', item === button));
    });
  });
  function openQuick(dialog, setup) {
    if (!dialog) return;
    setup();
    if (!dialog.open) dialog.showModal();
  }
  const logDialog = root.querySelector('#log-time-dialog');
  const logForm = logDialog?.querySelector('[data-log-form]');
  root.querySelectorAll('[data-log-time]').forEach((button) => {
    button.addEventListener('click', () => {
      openQuick(logDialog, () => {
        logForm.action = `/tasks/${button.dataset.task}/time`;
        logForm.querySelector('[data-log-back]').value = button.dataset.back || '/';
        logForm.querySelector('[data-log-title]').textContent = button.dataset.title || '';
        const duration = logForm.querySelector('[name="duration"]');
        if (duration) duration.value = '';
        logForm.querySelector('[name="note"]').value = '';
        logForm.querySelectorAll('[data-fill-duration]').forEach((item) => item.classList.remove('on'));
      });
      logForm.querySelector('[name="duration"]')?.focus();
    });
  });
  const completeDialog = root.querySelector('#complete-dialog');
  const completeForm = completeDialog?.querySelector('[data-complete-form]');
  root.querySelectorAll('[data-complete]').forEach((button) => {
    button.addEventListener('click', () => {
      openQuick(completeDialog, () => {
        completeForm.action = `/tasks/${button.dataset.task}/complete`;
        completeForm.querySelector('[data-complete-back]').value = button.dataset.back || '/';
        completeForm.querySelector('[data-complete-title]').textContent = button.dataset.title || '';
        completeForm.querySelector('[data-complete-logged]').textContent = `${button.dataset.logged || '0m'} logged so far`;
        const duration = completeForm.querySelector('[name="duration"]');
        if (duration) duration.value = '';
        completeForm.querySelector('[name="completion_note"]').value = '';
        completeForm.querySelectorAll('[data-fill-duration]').forEach((item) => item.classList.remove('on'));
      });
    });
  });
  const pushDialog = root.querySelector('#reschedule-dialog');
  const pushForm = pushDialog?.querySelector('[data-reschedule-form]');
  root.querySelectorAll('[data-reschedule]').forEach((button) => {
    button.addEventListener('click', () => {
      openQuick(pushDialog, () => {
        pushForm.action = `/tasks/${button.dataset.task}/reschedule`;
        pushForm.querySelector('[data-reschedule-back]').value = button.dataset.back || '/';
        pushForm.querySelector('[data-reschedule-title]').textContent = button.dataset.title || '';
        const waiting = button.dataset.waiting || '';
        const reason = pushForm.querySelector('[name="reason"]');
        const box = pushForm.querySelector('[name="waiting"]');
        if (reason) reason.value = waiting;
        if (box) box.checked = Boolean(waiting);
      });
    });
  });
  [logDialog, completeDialog, pushDialog].forEach((dialog) => {
    if (!dialog) return;
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      dialog.close();
    });
    dialog.querySelector('[data-close-quick]')?.addEventListener('click', () => dialog.close());
    wireBackdrop(dialog, () => dialog.close());
  });
  reviewForm.addEventListener('submit', (event) => {
    if (!reviewerId.value) {
      event.preventDefault();
      reviewerSearch.focus();
    }
  });
}
taskEditDirty(root);
root.querySelectorAll('.task-form input[name="title"]').forEach((input) => {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const save = root.querySelector('#task-edit [data-task-save], [form="task-edit"][data-task-save]');
      if (input.form?.id === 'task-edit' && save?.disabled) return;
      input.form?.requestSubmit();
    }
  });
});
root.querySelectorAll('[data-priority], [data-status]').forEach((button) => {
  button.addEventListener('click', () => {
    const wrap = button.parentElement;
    const attr = button.hasAttribute('data-status') ? 'data-status' : 'data-priority';
    const inputName = attr === 'data-status' ? '[data-status-input]' : '[data-priority-input]';
    wrap.querySelectorAll(`[${attr}]`).forEach((item) => item.classList.remove('on'));
    button.classList.add('on');
    const input = button.closest('.field')?.querySelector(inputName);
    if (input) {
      input.value = button.getAttribute(attr) || '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
});

root.querySelectorAll('[data-due]').forEach((button) => {
  button.addEventListener('click', () => {
    const field = button.closest('.field');
    const input = field?.querySelector('[data-due-input]');
    if (input) {
      input.value = button.getAttribute('data-due') || '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    field?.querySelectorAll('[data-due]').forEach((item) => item.classList.remove('on'));
    button.classList.add('on');
  });
});

function syncAssignees(field) {
  const hidden = field.querySelector('[data-assignee-ids]');
  if (hidden) {
    hidden.value = [...field.querySelectorAll('.assignee-chip')].map((chip) => chip.dataset.id).join(',');
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
function addAssignee(field, id, name, swatchClass) {
  const chips = field.querySelector('[data-assignee-chips]');
  if (!chips || chips.querySelector(`[data-id="${id}"]`)) return;
  const chip = document.createElement('span');
  chip.className = 'assignee-chip';
  chip.dataset.id = String(id);
  if (swatchClass) {
    const dot = document.createElement('span');
    dot.className = `swatch ${swatchClass}`;
    dot.title = name;
    chip.append(dot);
  }
  chip.append(document.createTextNode(name));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.removeAssignee = '';
  remove.setAttribute('aria-label', `Remove ${name}`);
  remove.textContent = '×';
  remove.addEventListener('click', () => { chip.remove(); syncAssignees(field); });
  chip.append(remove);
  chips.append(chip);
  syncAssignees(field);
}
root.querySelectorAll('[data-remove-assignee]').forEach((button) => {
  button.addEventListener('click', () => {
    const field = button.closest('[data-assignee-field]');
    button.closest('.assignee-chip')?.remove();
    if (field) syncAssignees(field);
  });
});
root.querySelectorAll('[data-assign-me]').forEach((button) => {
  button.addEventListener('click', () => {
    const field = button.closest('[data-assignee-field]');
    const id = button.getAttribute('data-assign-me');
    const person = readJson('people-data').find((item) => String(item.id) === String(id));
    if (field && person) addAssignee(field, person.id, person.name, person.swatch);
  });
});
function hideOtherMenus(menu) {
  root.querySelectorAll('.combo-menu').forEach((other) => {
    if (other !== menu) other.hidden = true;
  });
}
function armCombo(menu) {
  menu.addEventListener('mousedown', (event) => event.stopPropagation());
  menu.addEventListener('click', (event) => event.stopPropagation());
}
function placeCombo(menu, input) {
  const box = input.getBoundingClientRect();
  const host = input.closest('dialog') || document.body;
  if (menu.parentElement !== host) host.append(menu);
  if (host.tagName === 'DIALOG') {
    const origin = host.getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.top = `${Math.round(box.bottom - origin.top)}px`;
    menu.style.left = `${Math.round(box.left - origin.left)}px`;
  } else {
    menu.style.position = 'fixed';
    menu.style.top = `${Math.round(box.bottom)}px`;
    menu.style.left = `${Math.round(box.left)}px`;
  }
  menu.style.width = `${Math.round(box.width)}px`;
  menu.style.zIndex = '40';
}
function watchMenu(menu, input) {
  const place = () => { if (!menu.hidden) placeCombo(menu, input); };
  const signal = contentSignal;
  input.closest('.form-sections')?.addEventListener('scroll', place, { signal });
  window.addEventListener('resize', place, { signal });
  window.addEventListener('scroll', place, { signal, capture: true });
}
root.querySelectorAll('[data-assignee-search]').forEach((input) => {
  const field = input.closest('[data-assignee-field]');
  const menu = document.createElement('div');
  menu.className = 'combo-menu';
  menu.hidden = true;
  armCombo(menu);
  watchMenu(menu, input);
  let index = 0;
  const render = () => {
    const query = input.value.trim().toLowerCase();
    const taken = new Set([...field.querySelectorAll('.assignee-chip')].map((chip) => chip.dataset.id));
    const matches = readJson('people-data').filter((item) => !taken.has(String(item.id)) && item.name.toLowerCase().includes(query)).slice(0, 8);
    menu.innerHTML = '';
    matches.forEach((item, itemIndex) => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.textContent = item.name;
      if (itemIndex === index) choice.classList.add('active');
      choice.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        addAssignee(field, item.id, item.name, item.swatch);
        input.value = '';
        menu.hidden = true;
      });
      menu.append(choice);
    });
    menu.hidden = matches.length === 0;
    if (!menu.hidden) {
      hideOtherMenus(menu);
      placeCombo(menu, input);
    }
  };
  input.addEventListener('input', () => { index = 0; render(); });
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (event) => {
    const buttons = [...menu.querySelectorAll('button')];
    if (event.key === 'ArrowDown') { event.preventDefault(); index = Math.min(buttons.length - 1, index + 1); render(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); index = Math.max(0, index - 1); render(); }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!menu.hidden && buttons[index]) buttons[index].dispatchEvent(new MouseEvent('mousedown'));
    }
  });
  input.addEventListener('blur', () => { window.setTimeout(() => { menu.hidden = true; }, 150); });
});

function attachCombo(input, hidden, items) {
  if (!input || !hidden) return;
  const menu = document.createElement('div');
  menu.className = 'combo-menu';
  menu.hidden = true;
  armCombo(menu);
  watchMenu(menu, input);
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
        event.stopPropagation();
        input.value = item.name;
        hidden.value = item.id;
        hidden.dispatchEvent(new Event('input', { bubbles: true }));
        menu.hidden = true;
      });
      menu.append(choice);
    });
    menu.hidden = matches.length === 0;
    if (!menu.hidden) {
      hideOtherMenus(menu);
      placeCombo(menu, input);
    }
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

root.querySelectorAll('[data-project-input]').forEach((input) => {
  attachCombo(input, input.parentElement.querySelector('[data-project-id]'), readJson('project-data'));
});
root.querySelectorAll('[data-user-input]').forEach((input) => {
  attachCombo(input, input.parentElement.querySelector('[data-user-id]'), readJson('people-data'));
});
}

function bindShell() {
  document.querySelector('[data-nav-toggle]')?.addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  });
  document.querySelector('[data-nav-close]')?.addEventListener('click', () => {
    document.body.classList.remove('nav-open');
  });
  window.addEventListener('beforeunload', (event) => {
    if (!taskDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  document.addEventListener('keydown', (event) => {
    const typing = event.target.closest('input, textarea, select');
    if (event.key === 'n' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openDrawer();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      const form = event.target.form || event.target.closest?.('.task-form');
      if (form?.id === 'task-edit' && document.querySelector('[data-task-save]')?.disabled) return;
      if (form) form.requestSubmit();
    }
  });
  window.addEventListener('pagehide', () => {
    window.clearTimeout(sseTimer);
    sse?.close();
    sse = null;
  });
}
bindShell();
bindContent(document.querySelector('.content'));

function wireBackdrop(dialog, close) {
  if (!dialog) return;
  let down = null;
  dialog.addEventListener('mousedown', (event) => { down = event.target; });
  dialog.addEventListener('click', (event) => {
    if (backdropCloses(down, event.target, dialog)) close();
    down = null;
  });
}

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
  const people = readJson('people-data').concat(readJson('mention-extra')).filter((person) => person.name && person.name.toLowerCase().includes(query.text.toLowerCase())).slice(0, 8);
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

const grokRoot = document.querySelector('[data-grok]');
if (grokRoot) {
  const bubble = grokRoot.querySelector('.grok-bubble');
  const panel = grokRoot.querySelector('.grok-panel');
  const log = grokRoot.querySelector('[data-grok-log]');
  const sidebar = grokRoot.querySelector('[data-grok-list]');
  const list = grokRoot.querySelector('[data-grok-threads]');
  const searchChats = grokRoot.querySelector('[data-grok-search]');
  const titleInput = grokRoot.querySelector('[data-grok-title]');
  const queueHost = grokRoot.querySelector('[data-grok-queue]');
  const backdrop = grokRoot.querySelector('[data-grok-backdrop]');
  const form = grokRoot.querySelector('[data-grok-form]');
  const picked = grokRoot.querySelector('[data-grok-picked]');
  const fileInput = form.querySelector('input[type="file"]');
  const csrf = grokRoot.dataset.csrf || '';
  let timer = 0;
  let pending = false;
  let open = false;
  let listOpen = false;
  let connected = true;
  let threadId = null;
  let threads = [];
  let full = false;
  try { full = localStorage.getItem('grok-layout') === 'full'; } catch { /* private mode */ }
  let chosen = [];
  let queue = [];
  let sending = false;
  let waitingCount = 0;
  let knownWaiting = null;
  const unread = new Map();
  const baseTitle = document.title;
  const badge = grokRoot.querySelector('[data-grok-badge]');
  const soundButton = grokRoot.querySelector('[data-grok-sound]');
  if (localStorage.getItem('grok-sound') === '0') soundButton.setAttribute('aria-pressed', 'false');

  function renderBadge() {
    const count = unread.size;
    badge.hidden = count === 0;
    badge.textContent = count > 9 ? '9+' : String(count);
    document.title = count ? `(${count}) ${baseTitle}` : baseTitle;
  }

  function soundOn() {
    return soundButton.getAttribute('aria-pressed') !== 'false';
  }

  function blip() {
    if (!soundOn()) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 740;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.stop(ctx.currentTime + 0.13);
    window.setTimeout(() => ctx.close(), 400);
  }

  function lookingAt(id) {
    return open && !document.hidden && threadId === id;
  }

  function seeThread(id) {
    if (!open || document.hidden || Number(threadId) !== Number(id)) return;
    for (const [messageId, owner] of [...unread]) {
      if (Number(owner) === Number(id)) unread.delete(messageId);
    }
    renderBadge();
  }

  function clearUnread() {
    unread.clear();
    renderBadge();
  }

  function noteArrivals(waiting) {
    const next = new Map((waiting || []).map((item) => [item.id, item.thread_id]));
    if (knownWaiting) {
      for (const [id, owner] of knownWaiting) {
        if (!next.has(id) && !(open && !document.hidden && Number(threadId) === Number(owner))) {
          unread.set(id, owner);
          blip();
        }
      }
      renderBadge();
    }
    knownWaiting = next;
    seeThread(threadId);
  }

  function mark() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M15 4 L8 20');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2.6');
    path.setAttribute('stroke-linecap', 'square');
    svg.append(path);
    return svg;
  }

  function turn(role, nodes) {
    const row = document.createElement('div');
    row.className = `grok-row ${role === 'user' ? 'is-user' : 'is-grok'}`;
    const avatar = document.createElement('span');
    avatar.className = 'grok-avatar';
    avatar.append(mark());
    const stack = document.createElement('div');
    stack.className = 'grok-stack';
    nodes.forEach((node) => stack.append(node));
    row.append(avatar, stack);
    return row;
  }

  function renderInlines(parts) {
    const fragment = document.createDocumentFragment();
    parts.forEach((part) => {
      if (part.type === 'bold') {
        const strong = document.createElement('strong');
        strong.textContent = part.text;
        fragment.append(strong);
      } else fragment.append(document.createTextNode(part.text));
    });
    return fragment;
  }

  function messageBubble(role, text) {
    const box = document.createElement('div');
    box.className = role === 'user' ? 'grok-mine' : 'grok-theirs';
    grokMessageBlocks(text).forEach((block) => {
      if (block.type === 'p') {
        const paragraph = document.createElement('p');
        block.lines.forEach((line, index) => {
          if (index) paragraph.append(document.createElement('br'));
          paragraph.append(renderInlines(line));
        });
        box.append(paragraph);
      } else {
        const list = document.createElement(block.type);
        block.items.forEach((item) => {
          const li = document.createElement('li');
          li.append(renderInlines(item));
          list.append(li);
        });
        box.append(list);
      }
    });
    return box;
  }

  function ackNode(live) {
    const box = document.createElement('div');
    box.className = 'grok-ack';
    const line = document.createElement('p');
    line.className = 'grok-ack-line';
    line.append('Got it, working on it');
    const dots = document.createElement('span');
    dots.className = 'grok-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    line.append(dots);
    box.append(line);
    if (live) {
      const status = document.createElement('p');
      status.className = 'grok-live';
      status.textContent = live;
      box.append(status);
    }
    return box;
  }

  const viewer = grokRoot.querySelector('[data-grok-viewer]');
  const viewerName = grokRoot.querySelector('[data-grok-viewer-name]');
  const viewerFrame = grokRoot.querySelector('[data-grok-viewer-frame]');
  const viewerDownload = grokRoot.querySelector('[data-grok-viewer-download]');
  function openViewer(file) {
    const view = grokFileView(file);
    if (!view.openUrl || !viewer) return;
    viewer.hidden = false;
    if (viewerName) viewerName.textContent = view.name;
    if (viewerFrame) viewerFrame.src = view.openUrl;
    if (viewerDownload) {
      viewerDownload.href = view.downloadUrl;
      viewerDownload.setAttribute('download', view.name);
    }
  }
  function closeViewer() {
    if (!viewer) return;
    viewer.hidden = true;
    if (viewerFrame) viewerFrame.removeAttribute('src');
  }
  function fileNode(file) {
    const view = grokFileView(file);
    const card = document.createElement('article');
    card.className = 'grok-file-card';
    const icon = document.createElement('span');
    icon.className = 'grok-file-icon';
    icon.textContent = 'PDF';
    const meta = document.createElement('div');
    meta.className = 'grok-file-meta';
    const title = document.createElement('strong');
    title.textContent = view.name;
    const detail = document.createElement('p');
    detail.textContent = [view.sizeLabel, view.expiry].filter(Boolean).join(' · ');
    meta.append(title, detail);
    const actions = document.createElement('div');
    actions.className = 'grok-file-actions';
    const openFile = document.createElement('button');
    openFile.type = 'button';
    openFile.textContent = 'Open';
    openFile.addEventListener('click', () => openViewer(file));
    const download = document.createElement('a');
    download.href = view.downloadUrl;
    download.setAttribute('download', view.name);
    download.textContent = 'Download';
    actions.append(openFile, download);
    card.append(icon, meta, actions);
    return card;
  }

  function paint(state) {
    pending = Boolean(state.pending);
    connected = state.connected !== false;
    threadId = state.thread_id || null;
    log.innerHTML = '';
    if (!state.connected) {
      const note = document.createElement('p');
      note.className = 'grok-note';
      note.textContent = "Grok isn't connected yet";
      log.append(note);
    }
    const visible = (state.messages || []).filter((message) => message.body || (message.files || []).length || (message.status === 'pending' && !message.body));
    if (!visible.length && state.connected !== false) {
      const empty = document.createElement('p');
      empty.className = 'grok-empty';
      empty.textContent = 'Ask Grok about the board.';
      log.append(empty);
    }
    (state.messages || []).forEach((message) => {
      const role = message.role === 'user' ? 'user' : 'grok';
      if (message.status === 'pending' && !message.body) {
        const nodes = [ackNode(message.live)];
        (message.files || []).forEach((file) => nodes.push(fileNode(file)));
        log.append(turn('grok', nodes));
        return;
      }
      if (message.body || (message.files || []).length) {
        const nodes = [];
        if (message.body) nodes.push(messageBubble(role, message.body));
        (message.files || []).forEach((file) => nodes.push(fileNode(file)));
        log.append(turn(role, nodes));
      }
    });
    (state.files || []).forEach((file) => log.append(turn(file.kind === 'in' ? 'user' : 'grok', [fileNode(file)])));
    log.scrollTop = log.scrollHeight;
    threads = state.threads || [];
    if (titleInput && document.activeElement !== titleInput) titleInput.value = state.title || '';
    renderThreads();
    noteArrivals(state.waiting || []);
    waitingCount = (state.waiting || []).length;
    renderQueued();
    if (!sending && !pending) flushQueue();
  }

  function renderThreads() {
    if (!list) return;
    const query = searchChats?.value || '';
    list.innerHTML = '';
    const shown = threads.filter((thread) => grokThreadVisible(thread, query));
    shown.forEach((thread) => {
      const row = document.createElement('div');
      row.className = `grok-chat${Number(thread.id) === Number(threadId) ? ' is-current' : ''}`;
      const openChat = document.createElement('button');
      openChat.type = 'button';
      openChat.className = 'grok-chat-main';
      const title = document.createElement('strong');
      title.textContent = thread.title || 'New chat';
      const preview = document.createElement('span');
      preview.textContent = thread.preview || 'No messages yet';
      openChat.append(title, preview);
      openChat.addEventListener('click', () => {
        switchThread(thread.id);
        if (!full || drawerMode()) toggleList(false);
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'grok-chat-x';
      remove.setAttribute('aria-label', 'Delete chat');
      remove.textContent = '×';
      remove.addEventListener('click', () => deleteThread(thread.id));
      row.append(openChat, remove);
      list.append(row);
    });
    if (!shown.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = threads.length ? 'No matching chats.' : 'No chats yet.';
      list.append(empty);
    }
  }

  const pdfNote = grokRoot.querySelector('[data-grok-pdf-note]');
  const fileError = grokRoot.querySelector('[data-grok-file-error]');
  const dropOverlay = grokRoot.querySelector('[data-grok-drop]');
  let dragDepth = 0;
  let errorTimer = 0;
  function showFileError(message) {
    if (!fileError) return;
    fileError.textContent = message || '';
    window.clearTimeout(errorTimer);
    if (message) errorTimer = window.setTimeout(() => { fileError.textContent = ''; }, 4000);
  }
  function addFiles(list) {
    const result = acceptGrokFiles(chosen, list);
    chosen = result.files;
    showPicked();
    showFileError(result.error);
  }
  function renderQueued() {
    if (!queueHost) return;
    queueHost.innerHTML = '';
    queue.forEach((item) => {
      const chip = document.createElement('span');
      chip.className = 'grok-queue-chip';
      chip.dataset.queued = '1';
      chip.textContent = grokQueuedLabel(item);
      queueHost.append(chip);
    });
  }
  function showPicked() {
    picked.innerHTML = '';
    chosen.forEach((file, index) => {
      const chip = document.createElement('span');
      chip.textContent = file.name;
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.setAttribute('aria-label', 'Remove file');
      drop.textContent = '×';
      drop.addEventListener('click', () => { chosen.splice(index, 1); showPicked(); });
      chip.append(drop);
      picked.append(chip);
    });
    if (pdfNote) pdfNote.hidden = chosen.length === 0;
  }

  async function load(id = threadId) {
    const query = id ? `?thread=${id}` : '';
    const response = await fetch(`/api/grok${query}`, { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    paint(await response.json());
  }

  function watch() {
    window.clearInterval(timer);
    timer = 0;
    if (!waitingCount || sseLive) return;
    timer = window.setInterval(() => { load().catch(() => {}); }, 15000);
  }

  function drawerMode() {
    return full && open && window.matchMedia('(max-width: 800px)').matches;
  }

  function syncDrawer() {
    backdrop?.classList.toggle('is-on', drawerMode() && listOpen);
  }

  let sawDrawer = false;
  function syncLayout(collapseList) {
    grokRoot.classList.toggle('is-full', full && open);
    const button = grokRoot.querySelector('[data-grok-full]');
    if (button) {
      button.setAttribute('aria-pressed', full ? 'true' : 'false');
      button.setAttribute('aria-label', full ? 'Exit full screen' : 'Full screen');
      button.title = full ? 'Exit full screen' : 'Full screen';
    }
    const drawer = drawerMode();
    if (collapseList || (drawer && !sawDrawer)) listOpen = false;
    if (!drawer && sawDrawer && full && open) listOpen = true;
    sawDrawer = drawer;
    if (full && open && sidebar) {
      sidebar.hidden = false;
      if (drawer) sidebar.classList.toggle('is-open', listOpen);
      else {
        listOpen = true;
        sidebar.classList.add('is-open');
      }
    } else if (collapseList && sidebar) {
      sidebar.classList.remove('is-open');
      sidebar.hidden = true;
    }
    syncDrawer();
    renderThreads();
  }

  function toggleList(force) {
    if (full && open && !drawerMode()) {
      listOpen = true;
      if (sidebar) {
        sidebar.hidden = false;
        sidebar.classList.add('is-open');
      }
      syncDrawer();
      return;
    }
    listOpen = typeof force === 'boolean' ? force : !listOpen;
    if (!sidebar) return;
    sidebar.hidden = false;
    sidebar.classList.toggle('is-open', listOpen);
    if (!listOpen && !(full && open)) sidebar.hidden = true;
    syncDrawer();
  }

  async function switchThread(id) {
    threadId = id;
    await load(id);
    watch();
  }

  async function renameThread(id, title) {
    const response = await fetch(`/api/grok/threads/${id}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ _csrf: csrf, title }),
    });
    if (response.ok) paint(await response.json());
  }

  async function deleteThread(id) {
    if (!window.confirm('Delete this chat?')) return;
    const response = await fetch(`/api/grok/threads/${id}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ _csrf: csrf }),
    });
    if (!response.ok) return;
    const state = await response.json();
    threadId = state.thread_id;
    paint(state);
    watch();
  }

  function setOpen(next) {
    open = next;
    panel.hidden = !open;
    syncLayout();
    if (!open) {
      toggleList(false);
      watch();
      return;
    }
    clearUnread();
    load().then(() => { seeThread(threadId); watch(); }).catch(() => {});
  }
  bubble.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(applyGrokClick(open, 'bubble', true));
  });
  grokRoot.querySelector('[data-grok-close]').addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(applyGrokClick(open, 'close', true));
  });
  document.addEventListener('click', (event) => {
    if (!open) return;
    const next = applyGrokClick(open, 'outside', grokRoot.contains(event.target));
    if (next !== open) setOpen(next);
  });
  grokRoot.querySelector('[data-grok-chats]').addEventListener('click', () => toggleList());
  async function createChat() {
    const response = await fetch('/api/grok/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ _csrf: csrf }),
    });
    if (!response.ok) return;
    paint(await response.json());
    toggleList(false);
    watch();
  }
  grokRoot.querySelector('[data-grok-new]').addEventListener('click', createChat);
  grokRoot.querySelector('[data-grok-new-side]')?.addEventListener('click', createChat);
  grokRoot.querySelector('[data-grok-full]')?.addEventListener('click', () => {
    full = !full;
    try { localStorage.setItem('grok-layout', full ? 'full' : 'panel'); } catch { /* private mode */ }
    if (full && !open) setOpen(true);
    else syncLayout(!full);
  });
  searchChats?.addEventListener('input', () => renderThreads());
  titleInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); titleInput.blur(); }
  });
  titleInput?.addEventListener('change', () => {
    if (threadId) renameThread(threadId, titleInput.value);
  });
  backdrop?.addEventListener('click', () => toggleList(false));
  window.addEventListener('resize', () => { if (full && open) syncLayout(); });
  grokRoot.querySelector('[data-grok-viewer-close]')?.addEventListener('click', closeViewer);
  grokRoot.querySelector('[data-grok-attach]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    addFiles([...fileInput.files]);
    fileInput.value = '';
  });
  panel.addEventListener('dragenter', (event) => {
    if (!open) return;
    event.preventDefault();
    dragDepth += 1;
    dropOverlay?.classList.add('is-on');
  });
  panel.addEventListener('dragover', (event) => {
    if (!open) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  panel.addEventListener('dragleave', () => {
    if (!open) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOverlay?.classList.remove('is-on');
  });
  panel.addEventListener('drop', (event) => {
    if (!open) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    dropOverlay?.classList.remove('is-on');
    addFiles([...(event.dataTransfer?.files || [])]);
  });
  window.addEventListener('dragover', (event) => {
    if (open) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (!open) return;
    event.preventDefault();
    dragDepth = 0;
    dropOverlay?.classList.remove('is-on');
  });
  window.addEventListener('paste', (event) => {
    if (!open) return;
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  });
  async function sendItem(item) {
    sending = true;
    if (item.text) log.append(turn('user', [messageBubble('user', item.text)]));
    const wait = connected ? ackNode('') : document.createElement('p');
    if (!connected) {
      wait.className = 'grok-note';
      wait.textContent = "Grok isn't connected yet";
    }
    log.append(connected ? turn('grok', [wait]) : wait);
    log.scrollTop = log.scrollHeight;
    const body = new FormData();
    body.set('_csrf', csrf);
    body.set('text', item.text);
    if (threadId) body.set('thread_id', String(threadId));
    item.files.forEach((file) => body.append('files', file));
    let failed = false;
    try {
      const response = await fetch('/api/grok', { method: 'POST', headers: { accept: 'application/json' }, body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        failed = true;
        wait.className = 'grok-note';
        wait.textContent = payload.error || 'Grok could not take that message.';
        return;
      }
      paint(payload);
      watch();
    } finally {
      sending = false;
    }
    if (failed || !pending) flushQueue();
  }
  function flushQueue() {
    if (sending || pending || !queue.length) return;
    const item = queue.shift();
    renderQueued();
    sendItem(item);
  }
  const composer = form.querySelector('[name="text"]');
  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = form.querySelector('[name="text"]');
    const text = input.value.trim();
    if (!text && !chosen.length) return;
    const item = { text, files: chosen };
    input.value = '';
    chosen = [];
    showPicked();
    if (grokShouldQueue({ sending, pending, queued: queue.length })) {
      queue.push(item);
      renderQueued();
      return;
    }
    sendItem(item);
  });
  soundButton.addEventListener('click', () => {
    const on = soundButton.getAttribute('aria-pressed') === 'false';
    soundButton.setAttribute('aria-pressed', on ? 'true' : 'false');
    localStorage.setItem('grok-sound', on ? '1' : '0');
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) seeThread(threadId); });
  document.addEventListener('sse-state', (event) => {
    sseLive = Boolean(event.detail?.ok);
    watch();
  });
  document.addEventListener('grok-refresh', () => { load().catch(() => {}); });
  if (full) setOpen(true);
  else load().then(watch).catch(() => {});
}

let sseLive = false;
let sse;
let sseTimer = 0;

function setMentionCount(count) {
  const n = Number(count) || 0;
  document.querySelectorAll('a.nav-link[href="/?mentions=1"]').forEach((link) => {
    let badge = link.querySelector('.nav-badge');
    if (!n) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      link.querySelector('svg')?.after(badge);
    }
    badge.textContent = n > 9 ? '9+' : String(n);
  });
  const mobile = document.querySelector('.bottom-nav a[href="/?mentions=1"]');
  if (mobile) mobile.textContent = n ? `Mentions (${n > 9 ? '9+' : n})` : 'Mentions';
}

function showPing(text, href) {
  document.querySelector('.ping')?.remove();
  const box = document.createElement('div');
  box.className = 'ping';
  box.setAttribute('role', 'status');
  const link = document.createElement('a');
  link.href = href || '/';
  link.textContent = text || 'Update';
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => box.remove());
  box.append(link, close);
  document.body.append(box);
  window.setTimeout(() => box.remove(), 8000);
}

let refreshTimer = 0;
let refreshBusy = false;
let refreshQueued = false;

function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(runRefresh, 400);
}

async function runRefresh() {
  if (refreshBusy) {
    refreshQueued = true;
    return;
  }
  const path = location.pathname;
  const live = path === '/' || path === '/team' || path === '/calendar' || path === '/manage' || /^\/tasks\/\d+$/.test(path);
  if (!live) return;
  if (document.querySelector('dialog[open]')) return;
  if (/^\/tasks\/\d+$/.test(path) && taskDirty) return;
  const active = document.activeElement;
  if (active && active.matches?.('input, textarea, select') && active.closest('.content')) return;
  const scrollY = window.scrollY;
  const doneOpen = Boolean(document.querySelector('.done-rows') && !document.querySelector('.done-rows').hasAttribute('hidden'));
  refreshBusy = true;
  try {
    const response = await fetch(location.href, { headers: { accept: 'text/html' } });
    if (!response.ok) return;
    if (/^\/tasks\/\d+$/.test(location.pathname) && taskDirty) return;
    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const next = parsed.querySelector('.content');
    const current = document.querySelector('.content');
    if (!next || !current) return;
    current.replaceWith(document.importNode(next, true));
    const rows = document.querySelector('.content .done-rows');
    if (rows && doneOpen) {
      rows.removeAttribute('hidden');
      document.querySelector('.content [data-done-toggle]')?.setAttribute('aria-expanded', 'true');
    }
    bindContent(document.querySelector('.content'));
    window.scrollTo(0, scrollY);
  } finally {
    refreshBusy = false;
    if (refreshQueued) {
      refreshQueued = false;
      runRefresh();
    }
  }
}

function refreshContent() {
  scheduleRefresh();
}

function connectSse() {
  if (!document.body.classList.contains('app')) return;
  if (sse) sse.close();
  sse = new EventSource('/events');
  sse.onopen = () => {
    sseLive = true;
    document.dispatchEvent(new CustomEvent('sse-state', { detail: { ok: true } }));
  };
  sse.addEventListener('grok:message', () => {
    document.dispatchEvent(new CustomEvent('grok-refresh'));
  });
  sse.addEventListener('board:changed', (event) => {
    let data = {};
    try { data = JSON.parse(event.data || '{}'); } catch { data = {}; }
    showPing(data.summary || 'Board updated', data.taskId ? `/tasks/${data.taskId}` : location.pathname);
    scheduleRefresh();
  });
  sse.addEventListener('notify', (event) => {
    let data = {};
    try { data = JSON.parse(event.data || '{}'); } catch { data = {}; }
    if (data.count != null) setMentionCount(data.count);
    showPing(data.text || 'Update', data.href || '/');
  });
  sse.onerror = () => {
    sseLive = false;
    sse.close();
    document.dispatchEvent(new CustomEvent('sse-state', { detail: { ok: false } }));
    window.clearTimeout(sseTimer);
    sseTimer = window.setTimeout(connectSse, 5000);
  };
}
connectSse();

const taskWait = document.querySelector('[data-grok-task]');
if (taskWait) {
  const taskId = taskWait.dataset.grokTask;
  const live = taskWait.querySelector('[data-grok-live]');
  let wasWaiting = true;
  window.setInterval(async () => {
    if (sseLive) return;
    const response = await fetch(`/api/grok/tasks/${taskId}`, { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const state = await response.json();
    if (live && live.isConnected) live.textContent = state.live || '';
    if (wasWaiting && !state.waiting) scheduleRefresh();
    wasWaiting = Boolean(state.waiting);
  }, 15000);
}

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
