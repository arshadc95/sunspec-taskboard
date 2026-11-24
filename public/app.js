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
  const summary = standardRoot.querySelector('[data-std-summary]');
  const tag = standardRoot.querySelector('[data-std-tag]');
  const tip = standardRoot.querySelector('[data-std-tip]');
  const more = standardRoot.querySelector('[data-std-more]');
  let index = 0;
  const show = (next, remember) => {
    index = (next + standardList.length) % standardList.length;
    const item = standardList[index];
    if (code) code.textContent = item.code;
    if (summary) summary.textContent = item.summary;
    if (tag) tag.textContent = item.category;
    if (tip) {
      tip.textContent = item.tip;
      tip.hidden = true;
    }
    more?.setAttribute('aria-expanded', 'false');
    if (remember) {
      try { localStorage.setItem('std-last', item.id); } catch { /* private mode */ }
    }
  };
  let last = '';
  try { last = localStorage.getItem('std-last') || ''; } catch { /* private mode */ }
  let start = Math.floor(Math.random() * standardList.length);
  if (standardList.length > 1 && standardList[start].id === last) {
    start = (start + 1 + Math.floor(Math.random() * (standardList.length - 1))) % standardList.length;
  }
  show(start, true);
  standardRoot.querySelector('[data-std-prev]')?.addEventListener('click', () => show(index - 1, true));
  standardRoot.querySelector('[data-std-next]')?.addEventListener('click', () => show(index + 1, true));
  more?.addEventListener('click', () => {
    const open = tip.hasAttribute('hidden');
    tip.toggleAttribute('hidden', !open);
    more.setAttribute('aria-expanded', open ? 'true' : 'false');
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
function addAssignee(field, id, name) {
  const chips = field.querySelector('[data-assignee-chips]');
  if (!chips || chips.querySelector(`[data-id="${id}"]`)) return;
  const chip = document.createElement('span');
  chip.className = 'assignee-chip';
  chip.dataset.id = String(id);
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
    if (field && person) addAssignee(field, person.id, person.name);
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
        addAssignee(field, item.id, item.name);
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
  const list = grokRoot.querySelector('[data-grok-list]');
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
  let chosen = [];
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

  function fileNode(file) {
    const line = document.createElement('p');
    line.className = 'grok-file';
    if (file.expired) {
      line.textContent = `${file.filename} · expired`;
      return line;
    }
    const link = document.createElement('a');
    link.href = `/files/${file.id}`;
    link.textContent = file.filename;
    line.append(link, document.createTextNode(` · ${file.expires_label}`));
    return line;
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
    list.innerHTML = '';
    (state.threads || []).forEach((thread) => {
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
      openChat.addEventListener('click', () => { switchThread(thread.id); toggleList(false); });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => deleteThread(thread.id));
      row.append(title, openChat, remove);
      list.append(row);
    });
    if (!(state.threads || []).length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No chats yet.';
      list.append(empty);
    }
    noteArrivals(state.waiting || []);
    waitingCount = (state.waiting || []).length;
  }

  const pdfNote = grokRoot.querySelector('[data-grok-pdf-note]');
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

  function toggleList(force) {
    listOpen = typeof force === 'boolean' ? force : !listOpen;
    list.hidden = false;
    list.classList.toggle('is-open', listOpen);
    if (!listOpen) list.hidden = true;
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

  bubble.addEventListener('click', () => {
    open = true;
    panel.hidden = false;
    clearUnread();
    load().then(() => { seeThread(threadId); watch(); }).catch(() => {});
  });
  grokRoot.querySelector('[data-grok-close]').addEventListener('click', () => {
    open = false;
    panel.hidden = true;
    toggleList(false);
    watch();
  });
  grokRoot.querySelector('[data-grok-chats]').addEventListener('click', () => toggleList());
  grokRoot.querySelector('[data-grok-new]').addEventListener('click', async () => {
    const response = await fetch('/api/grok/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ _csrf: csrf }),
    });
    if (!response.ok) return;
    paint(await response.json());
    toggleList(false);
    watch();
  });
  grokRoot.querySelector('[data-grok-attach]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    chosen = chosen.concat([...fileInput.files]).slice(0, 5);
    fileInput.value = '';
    showPicked();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = form.querySelector('input[name="text"]');
    const text = input.value.trim();
    if (!text && !chosen.length) return;
    input.value = '';
    const sending = chosen;
    chosen = [];
    showPicked();
    if (text) {
      const mine = document.createElement('p');
      mine.className = 'grok-mine';
      mine.textContent = text;
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
    body.set('text', text);
    if (threadId) body.set('thread_id', String(threadId));
    sending.forEach((file) => body.append('files', file));
    const response = await fetch('/api/grok', { method: 'POST', headers: { accept: 'application/json' }, body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      wait.className = 'grok-note';
      wait.textContent = payload.error || 'Grok could not take that message.';
      return;
    }
    paint(payload);
    watch();
  });
  soundButton.addEventListener('click', () => {
    const on = soundButton.getAttribute('aria-pressed') === 'false';
    soundButton.setAttribute('aria-pressed', on ? 'true' : 'false');
    localStorage.setItem('grok-sound', on ? '1' : '0');
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) seeThread(threadId); });
  load().then(watch).catch(() => {});
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
