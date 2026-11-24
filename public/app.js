import { acceptGrokFiles, applyGrokClick, grokFileView, grokQueuedLabel, grokShouldQueue } from './grok-panel.js';
import { cardAt, moveStandardsDeck, openStandardsDeck } from './standards-deck.js';

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

const standardRoot = document.querySelector('[data-standard]');
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
drawer?.addEventListener('cancel', (event) => {
  event.preventDefault();
  drawer.close();
});
drawer?.addEventListener('click', (event) => {
  if (event.target === drawer) drawer.close();
});
drawer?.querySelector('.task-form')?.addEventListener('submit', () => drawer.close());

const reviewDialog = document.getElementById('review-dialog');
const reviewForm = reviewDialog?.querySelector('[data-review-form]');
const reviewerSearch = reviewForm?.querySelector('[data-reviewer-search]');
const reviewerId = reviewForm?.querySelector('[data-reviewer-id]');
if (reviewDialog && reviewForm && reviewerSearch && reviewerId) {
  const menu = document.createElement('div');
  menu.className = 'combo-menu';
  menu.hidden = true;
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
  document.querySelectorAll('[data-send-review]').forEach((button) => {
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
  reviewDialog.addEventListener('click', (event) => {
    if (event.target === reviewDialog) closeReview();
  });
  reviewForm.addEventListener('submit', (event) => {
    if (!reviewerId.value) {
      event.preventDefault();
      reviewerSearch.focus();
    }
  });
}
document.querySelectorAll('.task-form input[name="title"]').forEach((input) => {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.form?.requestSubmit();
    }
  });
});
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

document.querySelectorAll('[data-priority], [data-status]').forEach((button) => {
  button.addEventListener('click', () => {
    const wrap = button.parentElement;
    const attr = button.hasAttribute('data-status') ? 'data-status' : 'data-priority';
    const inputName = attr === 'data-status' ? '[data-status-input]' : '[data-priority-input]';
    wrap.querySelectorAll(`[${attr}]`).forEach((item) => item.classList.remove('on'));
    button.classList.add('on');
    const input = button.closest('.field')?.querySelector(inputName);
    if (input) input.value = button.getAttribute(attr) || '';
  });
});

document.querySelectorAll('[data-due]').forEach((button) => {
  button.addEventListener('click', () => {
    const field = button.closest('.field');
    const input = field?.querySelector('[data-due-input]');
    if (input) input.value = button.getAttribute('data-due') || '';
    field?.querySelectorAll('[data-due]').forEach((item) => item.classList.remove('on'));
    button.classList.add('on');
  });
});

function syncAssignees(field) {
  const hidden = field.querySelector('[data-assignee-ids]');
  if (hidden) hidden.value = [...field.querySelectorAll('.assignee-chip')].map((chip) => chip.dataset.id).join(',');
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
document.querySelectorAll('[data-remove-assignee]').forEach((button) => {
  button.addEventListener('click', () => {
    const field = button.closest('[data-assignee-field]');
    button.closest('.assignee-chip')?.remove();
    if (field) syncAssignees(field);
  });
});
document.querySelectorAll('[data-assign-me]').forEach((button) => {
  button.addEventListener('click', () => {
    const field = button.closest('[data-assignee-field]');
    const id = button.getAttribute('data-assign-me');
    const person = readJson('people-data').find((item) => String(item.id) === String(id));
    if (field && person) addAssignee(field, person.id, person.name, person.swatch);
  });
});
function hideOtherMenus(menu) {
  document.querySelectorAll('.combo-menu').forEach((other) => {
    if (other !== menu) other.hidden = true;
  });
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
  input.closest('.form-sections')?.addEventListener('scroll', place);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
}
document.querySelectorAll('[data-assignee-search]').forEach((input) => {
  const field = input.closest('[data-assignee-field]');
  const menu = document.createElement('div');
  menu.className = 'combo-menu';
  menu.hidden = true;
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
        input.value = item.name;
        hidden.value = item.id;
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

document.querySelectorAll('[data-project-input]').forEach((input) => {
  attachCombo(input, input.parentElement.querySelector('[data-project-id]'), readJson('project-data'));
});
document.querySelectorAll('[data-user-input]').forEach((input) => {
  attachCombo(input, input.parentElement.querySelector('[data-user-id]'), readJson('people-data'));
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
    const title = document.createElement('strong');
    title.textContent = view.name;
    const detail = document.createElement('p');
    detail.textContent = [view.sizeLabel, view.expiry].filter(Boolean).join(' · ');
    meta.append(title, detail);
    const actions = document.createElement('div');
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
    (state.messages || []).forEach((message) => {
      if (message.status === 'pending' && !message.body) {
        log.append(ackNode(message.live));
        (message.files || []).forEach((file) => log.append(fileNode(file)));
        return;
      }
      if (message.body || (message.files || []).length) {
        if (message.body) {
          const line = document.createElement('p');
          line.className = message.role === 'user' ? 'grok-mine' : 'grok-theirs';
          line.textContent = message.body;
          log.append(line);
        }
        (message.files || []).forEach((file) => log.append(fileNode(file)));
      }
    });
    (state.files || []).forEach((file) => log.append(fileNode(file)));
    log.scrollTop = log.scrollHeight;
    threads = state.threads || [];
    renderThreads();
    noteArrivals(state.waiting || []);
    waitingCount = (state.waiting || []).length;
    renderQueued();
    if (!sending && !pending) flushQueue();
  }

  function renderThreads() {
    if (!list) return;
    const query = (searchChats?.value || '').trim().toLowerCase();
    list.innerHTML = '';
    const shown = threads.filter((thread) => !query || String(thread.title || 'New chat').toLowerCase().includes(query));
    shown.forEach((thread) => {
      const row = document.createElement('div');
      row.className = `grok-chat${thread.id === threadId ? ' is-current' : ''}`;
      const title = document.createElement('input');
      title.value = thread.title || '';
      title.placeholder = 'New chat';
      title.setAttribute('aria-label', 'Chat title');
      title.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); title.blur(); }
      });
      title.addEventListener('change', () => renameThread(thread.id, title.value));
      const openChat = document.createElement('button');
      openChat.type = 'button';
      openChat.textContent = 'Open';
      openChat.addEventListener('click', () => { switchThread(thread.id); if (!full) toggleList(false); });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => deleteThread(thread.id));
      row.append(title, openChat, remove);
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
    log.querySelectorAll('[data-queued]').forEach((node) => node.remove());
    queue.forEach((item) => {
      const line = document.createElement('p');
      line.className = 'grok-mine grok-queued';
      line.dataset.queued = '1';
      line.textContent = grokQueuedLabel(item);
      log.append(line);
    });
    if (queue.length) log.scrollTop = log.scrollHeight;
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
    if (!waitingCount) return;
    timer = window.setInterval(() => { load().catch(() => {}); }, 3000);
  }

  function syncLayout(collapseList) {
    grokRoot.classList.toggle('is-full', full && open);
    const button = grokRoot.querySelector('[data-grok-full]');
    if (button) {
      button.setAttribute('aria-pressed', full ? 'true' : 'false');
      button.textContent = full ? 'Panel' : 'Full';
    }
    if (full && open && sidebar) {
      listOpen = true;
      sidebar.hidden = false;
      sidebar.classList.add('is-open');
    } else if (collapseList && sidebar) {
      listOpen = false;
      sidebar.classList.remove('is-open');
      sidebar.hidden = true;
    }
  }

  function toggleList(force) {
    if (full && open) {
      listOpen = true;
      if (sidebar) {
        sidebar.hidden = false;
        sidebar.classList.add('is-open');
      }
      return;
    }
    listOpen = typeof force === 'boolean' ? force : !listOpen;
    if (!sidebar) return;
    sidebar.hidden = false;
    sidebar.classList.toggle('is-open', listOpen);
    if (!listOpen) sidebar.hidden = true;
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
    if (!full) toggleList(false);
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
    if (item.text) {
      const mine = document.createElement('p');
      mine.className = 'grok-mine';
      mine.textContent = item.text;
      log.append(mine);
    }
    const wait = connected ? ackNode('') : document.createElement('p');
    if (!connected) {
      wait.className = 'grok-note';
      wait.textContent = "Grok isn't connected yet";
    }
    log.append(wait);
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
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = form.querySelector('input[name="text"]');
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
  if (full) setOpen(true);
  else load().then(watch).catch(() => {});
}

const taskWait = document.querySelector('[data-grok-task]');
if (taskWait) {
  const taskId = taskWait.dataset.grokTask;
  const live = taskWait.querySelector('[data-grok-live]');
  let wasWaiting = true;
  window.setInterval(async () => {
    const response = await fetch(`/api/grok/tasks/${taskId}`, { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const state = await response.json();
    if (live) live.textContent = state.live || '';
    if (wasWaiting && !state.waiting) window.location.reload();
    wasWaiting = Boolean(state.waiting);
  }, 3000);
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
