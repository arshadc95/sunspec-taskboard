import { readFileSync } from 'node:fs';
import { backlogChart, heatMap, ring, scatterChart, sparkline, stackedArea, throughputChart } from './charts.js';
import { PRIORITIES, ROLES, STATUSES, labelOf } from './constants.js';
import { formatDateTime, formatDue, formatDuration, isOverdue, shiftDate } from './time.js';

const standards = JSON.parse(readFileSync(new URL('./data/standards.json', import.meta.url), 'utf8'));

const ICONS = {
  tasks: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  at: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 12v1a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 16v-5M12 16V8M16 16v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  team: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6M16 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 20a5 5 0 0 1 10 0M13 20a5 5 0 0 1 8 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

const BAD_MSGS = new Set(['badlogin', 'ratelimit', 'invalid', 'forbidden', 'email', 'lastsuper', 'short', 'toobig', 'notimer', 'grokoff', 'groklimit', 'grokfile']);

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function textBlock(value) {
  return esc(value).replace(/\n/g, '<br>');
}

function highlightMentions(body, users) {
  const slots = [];
  const marked = String(body || '').replace(/@\[([^\]]*)\]\((\d+)\)/g, (all, name, id) => {
    const user = (users || []).find((item) => String(item.id) === String(id));
    const label = esc(user?.name || name || 'someone');
    const index = slots.push(`<span class="mention" data-user="${esc(id)}">@${label}</span>`) - 1;
    return `\u0000${index}\u0000`;
  });
  let text = esc(marked);
  const sorted = [...(users || [])].sort((a, b) => String(b.name || '').length - String(a.name || '').length);
  for (const user of sorted) {
    const label = esc(user.name);
    const needle = esc(user.name || '');
    if (!needle) continue;
    const pattern = new RegExp(`@${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
    text = text.replace(pattern, () => {
      const index = slots.push(`<span class="mention">@${label}</span>`) - 1;
      return `\u0000${index}\u0000`;
    });
  }
  return text.replace(/\u0000(\d+)\u0000/g, (all, index) => slots[Number(index)] || '').replace(/\n/g, '<br>');
}

function doc(title, bodyClass, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(title)}</title>
  <link rel="icon" href="/sunspec-logo.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="${bodyClass}">
${body}
<script src="/app.js"></script>
</body>
</html>`;
}

function banner(msg) {
  if (!msg) return '';
  const text = {
    badlogin: 'Invalid email or password.',
    ratelimit: 'Too many login attempts. Try again in 15 minutes.',
    saved: 'Saved.',
    started: 'Timer started.',
    stopped: 'Timer stopped.',
    running: 'A timer is already running on this task.',
    notimer: 'No timer is running on this task.',
    created: 'Task created.',
    commented: 'Comment added.',
    deleted: 'Deleted.',
    invalid: 'Check the form and try again.',
    forbidden: 'You do not have access to that.',
    email: 'That email is already in use.',
    lastsuper: 'The last active superuser cannot be demoted or deactivated.',
    short: 'Passwords must be at least 8 characters.',
    toobig: 'That file is larger than 10 MB.',
    grokoff: "Grok isn't connected yet. The comment was saved.",
    groklimit: 'Grok is catching up. You can send 20 messages an hour, and the daily limit after that. The comment was saved.',
    grokpdf: 'The comment was saved. PDFs are only sent when the comment mentions Grok.',
    grokfile: 'Each PDF must be a real PDF, 15 MB or smaller, and only five at a time.',
  }[msg];
  if (!text) return '';
  return `<div class="banner ${BAD_MSGS.has(msg) ? 'bad' : 'ok'}">${esc(text)}</div>`;
}

function roleBadge(role) {
  const label = labelOf(ROLES, role) || role;
  return `<span class="badge role-${esc(role)}">${esc(label)}</span>`;
}

function navLink(href, icon, label, active, badge = 0) {
  const count = badge > 0 ? `<span class="nav-badge">${badge > 9 ? '9+' : badge}</span>` : '';
  return `<a class="nav-link${active === icon ? ' active' : ''}" href="${href}" title="${esc(label)}" aria-label="${esc(label)}">${ICONS[icon]}${count}<span class="nav-label">${esc(label)}</span></a>`;
}

function sheet(title, inner, flush = false, hint = '') {
  const info = hint
    ? `<span class="info-tip"><button type="button" class="info-btn" aria-label="About ${esc(title)}">i</button><span class="info-pop" role="tooltip">${esc(hint)}</span></span>`
    : '';
  return `<section class="sheet"><header class="sheet-title"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"/></svg><span>${esc(title)}</span>${info}</header><div class="sheet-body${flush ? ' flush' : ''}">${inner}</div></section>`;
}

function peopleScript(users) {
  const data = (users || []).filter((user) => user.active !== 0).map((user) => ({ id: user.id, name: user.name }));
  return `<script type="application/json" id="people-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function fileLinks(files) {
  if (!files?.length) return '';
  return `<ul class="file-list">${files.map((file) => (
    file.expired
      ? `<li>${esc(file.filename)} <span class="hint">expired</span></li>`
      : `<li><a href="/files/${file.id}">${esc(file.filename)}</a> <span class="hint">${esc(file.expires_label)}</span></li>`
  )).join('')}</ul>`;
}

function grokWidget(user, csrf) {
  return `<div class="grok" data-grok data-csrf="${esc(csrf)}">
    <button type="button" class="grok-bubble" aria-label="Open Grok" title="Grok">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4 L8 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"/></svg>
      <span class="grok-badge" data-grok-badge hidden>1</span>
    </button>
    <section class="grok-panel" hidden>
      <header class="grok-head">
        <button type="button" data-grok-chats>Chats</button>
        <strong>Grok</strong>
        <button type="button" data-grok-sound aria-pressed="true">Sound</button>
        <button type="button" data-grok-new>+ New chat</button>
        <button type="button" data-grok-close aria-label="Close">×</button>
      </header>
      <div class="grok-chats" data-grok-list hidden></div>
      <div class="grok-log" data-grok-log></div>
      <form class="grok-form" data-grok-form>
        <div class="grok-picked" data-grok-picked></div>
        <p class="grok-pdf-note" data-grok-pdf-note hidden>Grok can read attached PDFs (max 5 × 15 MB, deleted after 24 h).</p>
        <div class="grok-compose">
          <input name="text" maxlength="4000" placeholder="Message Grok" autocomplete="off">
          <button type="button" class="grok-attach" data-grok-attach aria-label="Attach PDF">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5V7a4 4 0 0 1 8 0v9a3 3 0 0 1-6 0V8.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
          <input type="file" accept="application/pdf,.pdf" multiple hidden>
          <button type="submit">Send</button>
        </div>
      </form>
    </section>
  </div>
  <script type="application/json" id="mention-extra">${JSON.stringify([{ id: user.grokId, name: 'Grok' }]).replace(/</g, '\\u003c')}</script>`;
}

function toastBox(toast, csrf) {
  if (!toast) return '';
  return `<div class="toast" data-toast role="status">
    <span>Marked done.</span>
    <form method="post" action="/tasks/${toast.undo}/reopen">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <input type="hidden" name="status" value="${esc(toast.was)}">
      <input type="hidden" name="back" value="${esc(toast.back || '/')}">
      <button class="btn" type="submit">Undo</button>
    </form>
  </div>`;
}

function layout({ title, user, active, crumb, actions = '', body, csrf, msg, people = [], toast = null }) {
  const staff = user.role === 'superuser' || user.role === 'admin';
  const unread = Number(user.unreadMentions || 0);
  return doc(title, 'app', `
<header class="topbar">
  <button type="button" class="icon-btn hamburger" data-nav-toggle aria-label="Open menu">${ICONS.menu}</button>
  <a class="brand" href="/"><img src="/sunspec-logo.png" alt="Sunspec Solar"></a>
  <div class="crumb">${crumb}</div>
  <div class="top-actions">${actions}</div>
  <div class="who">
    <span class="who-name">${esc(user.name)}</span>
    ${roleBadge(user.role)}
  </div>
</header>
<div class="overlay" data-nav-close></div>
<div class="shell">
  <aside class="sidebar">
    <nav class="nav">
      ${navLink('/', 'tasks', 'Tasks', active)}
      ${navLink('/calendar', 'calendar', 'Calendar', active)}
      ${navLink('/?mentions=1', 'at', 'Mentions', active, unread)}
      ${navLink('/team', 'team', 'Team', active)}
      ${staff ? navLink('/manage', 'chart', 'Manage', active) : ''}
      ${staff ? navLink('/users', 'users', 'Users', active) : ''}
    </nav>
    <form method="post" action="/logout" class="logout-form">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <button class="nav-link" type="submit" title="Sign out" aria-label="Sign out">${ICONS.logout}<span class="nav-label">Sign out</span></button>
    </form>
  </aside>
  <div class="main">
    <div class="content">
      ${banner(msg)}
      ${toastBox(toast, csrf)}
      ${body}
      <p class="tz">Times shown in Africa/Johannesburg.</p>
    </div>
  </div>
</div>
<nav class="bottom-nav">
  <a class="${active === 'tasks' ? 'active' : ''}" href="/">Tasks</a>
  <a class="${active === 'calendar' ? 'active' : ''}" href="/calendar">Calendar</a>
  <a class="${active === 'at' ? 'active' : ''}" href="/?mentions=1">Mentions${unread ? ` (${unread > 9 ? '9+' : unread})` : ''}</a>
  <a class="${active === 'team' ? 'active' : ''}" href="/team">Team</a>
  ${staff ? `<a class="${active === 'chart' ? 'active' : ''}" href="/manage">Manage</a>` : ''}
  ${staff ? `<a class="${active === 'users' ? 'active' : ''}" href="/users">Users</a>` : ''}
</nav>
${grokWidget(user, csrf)}
${peopleScript(people)}`);
}

export function renderLogin({ msg, next, csrf }) {
  return doc('Sign in · Sunspec Task Board', 'login-page', `
<header class="topbar">
  <a class="brand" href="/login"><img src="/sunspec-logo.png" alt="Sunspec Solar"></a>
</header>
<main class="login-wrap">
  <form class="panel login-card" method="post" action="/login">
    <h1>Task board</h1>
    <p class="lede">Sunspec Solar · ControlWorx</p>
    ${banner(msg)}
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <input type="hidden" name="next" value="${esc(next || '/')}">
    <label class="field"><span>Email</span>
      <input name="email" type="email" autocomplete="username" required autofocus>
    </label>
    <label class="field"><span>Password</span>
      <input name="password" type="password" autocomplete="current-password" required>
    </label>
    <button class="btn btn-primary btn-block" type="submit">Sign in</button>
    <p class="hint">Accounts are created by an administrator. There is no self sign-up.</p>
  </form>
</main>`);
}

function options(pairs, selected, blank) {
  const html = [];
  if (blank) html.push(`<option value="">${esc(blank)}</option>`);
  for (const [value, label] of pairs) {
    const on = String(value) === String(selected ?? '') ? ' selected' : '';
    html.push(`<option value="${esc(value)}"${on}>${esc(label)}</option>`);
  }
  return html.join('');
}

function taskForm({ task, users, projects, csrf, canEdit, currentUser, today, from, autofocus = true }) {
  const value = task || {};
  const projectName = value.project_name || '';
  const due = value.due_date || '';
  const day = today || '';
  const status = value.status || 'todo';
  const chips = day
    ? [['today', 'Today', day], ['tomorrow', 'Tomorrow', shiftDate(day, 1)], ['week', 'Next week', shiftDate(day, 7)], ['none', 'None', '']]
    : [];
  const off = canEdit ? '' : 'disabled';
  const segments = (items, current, attr) => items.map(([key, label]) => {
    const on = String(current ?? '') === String(key);
    return `<button type="button" class="seg pri-${esc(key || 'none')}${on ? ' on' : ''}" ${attr}="${esc(key)}" ${off}>${esc(label)}</button>`;
  }).join('');
  const fields = `
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    ${from ? `<input type="hidden" name="from" value="${esc(from)}">` : ''}
    <div class="form-sections">
      <section class="form-card">
        <h2>Details</h2>
        <label class="field"><span>Title</span>
          <input class="title-input" name="title" required maxlength="200" value="${esc(value.title || '')}" placeholder="What needs doing?" ${off} ${!value.id && canEdit && autofocus ? 'autofocus' : ''}>
        </label>
        <label class="field"><span>Description</span>
          <textarea name="description" data-mentions rows="4" maxlength="20000" placeholder="Add detail. Type @ to mention someone." ${off}>${esc(value.description || '')}</textarea>
          ${value.description ? `<div class="desc-preview">${highlightMentions(value.description, users)}</div>` : ''}
        </label>
      </section>
      <section class="form-card">
        <h2>Assignment</h2>
        <div class="pair">
        <label class="field"><span>Project</span>
          <span class="combo">
            <input name="project_name" value="${esc(projectName)}" placeholder="Search or create project" autocomplete="off" data-project-input ${off}>
            <input type="hidden" name="project_id" value="${esc(value.project_id || '')}" data-project-id>
          </span>
        </label>
        <div class="field" data-assignee-field>
          <div class="label-row"><span>Assignees</span>${canEdit && currentUser ? `<button class="assign-link" type="button" data-assign-me="${currentUser.id}">Assign to me</button>` : ''}</div>
          <div class="assignee-chips" data-assignee-chips>${(value.assignees || []).map((person) => `<span class="assignee-chip" data-id="${person.id}">${esc(person.name)}<button type="button" data-remove-assignee aria-label="Remove ${esc(person.name)}">×</button></span>`).join('')}</div>
          <input type="hidden" name="assignee_ids" value="${esc((value.assignee_ids || []).join(','))}" data-assignee-ids>
          <input class="assignee-search" placeholder="Search people" autocomplete="off" data-assignee-search ${off}>
        </div>
        </div>
      </section>
      <section class="form-card">
        <h2>Status</h2>
        <div class="field">
          <span>Status</span>
          <input type="hidden" name="status" value="${esc(status)}" data-status-input>
          <div class="segments">${segments(STATUSES, status, 'data-status')}</div>
        </div>
        <h2>Priority</h2>
        <div class="field">
          <span>Priority</span>
          <input type="hidden" name="priority" value="${esc(value.priority || '')}" data-priority-input>
          <div class="segments">${segments([['', 'None'], ...PRIORITIES], value.priority || '', 'data-priority')}</div>
        </div>
      </section>
      <section class="form-card">
        <h2>Due date</h2>
        <div class="field">
          <span>Due</span>
          <div class="due-row">
            <div class="chips">${chips.map(([, label, date]) => `<button type="button" class="chip${due === date ? ' on' : ''}" data-due="${esc(date)}" ${off}>${label}</button>`).join('')}</div>
            <input name="due_date" type="date" value="${esc(due)}" data-due-input ${off}>
          </div>
        </div>
      </section>
    </div>
    ${canEdit ? `<div class="form-footer">${value.id ? '' : '<button class="btn btn-line" type="submit" name="again" value="1">Save & add another</button>'}<button class="btn btn-primary" type="submit">Save</button></div>` : ''}
  `;
  if (!canEdit) return `<div class="task-form is-readonly">${fields}</div>`;
  const action = task?.id ? `/tasks/${value.id}` : '/tasks';
  return `<form class="task-form" method="post" action="${action}">${fields}</form>`;
}

function projectScript(projects) {
  const data = (projects || []).map((project) => ({ id: project.id, name: project.name }));
  return `<script type="application/json" id="project-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function assigneeCell(task) {
  const names = (task.assignees || []).map((person) => person.name);
  if (!names.length) return '—';
  if (names.length === 1) return esc(names[0]);
  return `<span title="${esc(names.join(', '))}">${esc(names[0])} +${names.length - 1}</span>`;
}

function removeControl(task, user, csrf, back, prominent = false) {
  if (!(user.role === 'superuser' || user.role === 'admin' || task.created_by === user.id)) return '';
  return `<form class="row-remove" method="post" action="/tasks/${task.id}/delete" data-confirm="Remove this task from the board?">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <input type="hidden" name="back" value="${esc(back)}">
    <button class="btn ${prominent ? '' : 'btn-tiny'} icon-btn-trash" type="submit" title="Remove" aria-label="Remove"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M8 7l1 13h6l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
  </form>`;
}

function completeControl(task, user, csrf, back, prominent = false) {
  if (task.status === 'done' || !(user.role === 'superuser' || user.role === 'admin' || task.created_by === user.id || task.assignee_id === user.id)) return '';
  return `<form class="row-complete" method="post" action="/tasks/${task.id}/complete">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <input type="hidden" name="back" value="${esc(back)}">
    <button class="btn ${prominent ? 'btn-primary' : 'btn-tiny complete'}" type="submit" title="Mark done">${prominent ? '✓ Complete' : '✓'}</button>
  </form>`;
}

function timeCell(task) {
  return `<td class="time num">${esc(formatDuration(task.time_seconds || 0))}</td>`;
}

function taskCard(task, today, user, csrf, back) {
  const overdue = isOverdue(task.due_date, task.status, today);
  return `<article class="task-card${overdue ? ' overdue' : ''}${task.justAdded ? ' just-added' : ''}" data-href="/tasks/${task.id}">
    <div class="card-top"><a class="title-link" href="/tasks/${task.id}">${esc(task.title)}</a></div>
    <div class="card-meta">${esc(task.project_name || 'No project')} · ${esc(task.assignee_name || 'Unassigned')}</div>
    <div class="card-row">
      <span class="status status-${esc(task.status)}">${esc(labelOf(STATUSES, task.status))}</span>
      <span class="pri pri-${esc(task.priority || 'none')}">${esc(labelOf(PRIORITIES, task.priority) || '—')}</span>
      <span class="due">${esc(formatDue(task.due_date))}</span>
      <span class="time">${esc(formatDuration(task.time_seconds || 0))}</span>
    </div>
    <div class="card-meta">${task.comment_count} comments · ${esc(formatDateTime(task.updated_at))}</div>
    <div class="card-actions">${completeControl(task, user, csrf, back)}</div>
  </article>`;
}

function taskRow(task, today, user, csrf, back, highlight) {
  const overdue = isOverdue(task.due_date, task.status, today);
  const added = String(highlight || '') === String(task.id);
  return `<tr class="task-row${overdue ? ' overdue' : ''}${added ? ' just-added' : ''}" data-href="/tasks/${task.id}">
    <td><a class="title-link" href="/tasks/${task.id}">${esc(task.title)}</a></td>
    <td>${esc(task.project_name || '—')}</td>
    <td>${assigneeCell(task)}</td>
    <td class="status status-${esc(task.status)}">${esc(labelOf(STATUSES, task.status))}</td>
    <td class="pri pri-${esc(task.priority || 'none')}">${esc(labelOf(PRIORITIES, task.priority) || '—')}</td>
    <td class="due">${esc(formatDue(task.due_date))}</td>
    ${timeCell(task)}
    <td class="num">${task.comment_count}</td>
    <td class="when">${esc(formatDateTime(task.updated_at))}</td>
    <td class="row-actions">${completeControl(task, user, csrf, back)}</td>
  </tr>`;
}

export function renderBoard({ user, csrf, msg, tasks, filters, users, projects, counts, today, exportQuery, day, highlight, openForm, toast }) {
  const back = `/${exportQuery ? `?${exportQuery}` : ''}`;
  const openGroups = STATUSES.filter(([status]) => status !== 'done').map(([status, label]) => ({
    status,
    label,
    rows: tasks.filter((task) => task.status === status),
  })).filter((group) => group.rows.length);
  const doneRows = tasks.filter((task) => task.status === 'done');
  const showDone = filters.status === 'done' || doneRows.some((task) => String(task.id) === String(highlight || ''));
  const cards = tasks.filter((task) => task.status !== 'done' || showDone).map((task) => taskCard(task, today, user, csrf, back)).join('');
  const table = `<div class="table-wrap board-table"><table class="grid">
        <thead><tr>
          <th>Task</th><th>Project</th><th>Assignee</th><th>Status</th><th>Priority</th><th>Due</th><th>Time</th><th>Comments</th><th>Updated</th><th></th>
        </tr></thead>
        <tbody>
          ${openGroups.map((group) => `
            <tr class="group"><td colspan="10">${esc(group.label)} <span class="group-count">${group.rows.length}</span></td></tr>
            ${group.rows.map((task) => taskRow(task, today, user, csrf, back, highlight)).join('')}
          `).join('')}
          ${doneRows.length ? `<tr class="group"><td colspan="10"><button type="button" class="done-toggle" data-done-toggle aria-expanded="${showDone ? 'true' : 'false'}">Done <span class="group-count">${doneRows.length}</span></button></td></tr>` : ''}
        </tbody>
        ${doneRows.length ? `<tbody class="done-rows"${showDone ? '' : ' hidden'}>${doneRows.map((task) => taskRow(task, today, user, csrf, back, highlight)).join('')}</tbody>` : ''}
      </table></div>
      <div class="cards">${cards || '<div class="panel empty">No open tasks.</div>'}</div>`;

  const assigneeOptions = [
    ['', 'All assignees'],
    ['none', 'Unassigned'],
    ...users.map((person) => [String(person.id), person.name]),
  ];
  const selectedAssignee = filters.mine ? '' : (filters.assigneeId === 'none' ? 'none' : (filters.assigneeId || ''));

  const mineDay = day || { open: 0, dueToday: 0, timer: null };
  const first = standards[0];
  const myDayHtml = `<div class="dayline">
      <div class="dayline-stats">
        <span class="dayline-kicker">My day</span>
        <a href="/?mine=1">${mineDay.open} open</a>
        <a href="/?mine=1&amp;due=today">${mineDay.dueToday} due today</a>
      </div>
      <div class="std" data-standard>
        <span class="std-kicker">Standard</span>
        <button type="button" class="std-nav" data-std-prev aria-label="Previous standard">‹</button>
        <span class="std-tag" data-std-tag>${esc(first.category)}</span>
        <span class="std-line" data-std-line><strong data-std-code>${esc(first.code)}</strong> <span data-std-summary>${esc(first.summary)}</span></span>
        <button type="button" class="std-more" data-std-more aria-expanded="false">Why</button>
        <button type="button" class="std-nav" data-std-next aria-label="Next standard">›</button>
        <p class="std-detail" data-std-tip hidden>${esc(first.tip)}</p>
      </div>
    </div>
    <script type="application/json" id="standards-data">${JSON.stringify(standards).replace(/</g, '\\u003c')}</script>`;
  const filtersHtml = `<form class="board-bar" method="get" action="/" data-live>
        <select name="status" aria-label="Status">${options(STATUSES, filters.status, 'All statuses')}</select>
        <select name="assignee" aria-label="Assignee">${options(assigneeOptions, selectedAssignee)}</select>
        <select name="project" aria-label="Project">${options((projects || []).map((project) => [String(project.id), project.name]), filters.projectId || '', 'All projects')}</select>
        <label class="board-search"><input type="search" name="q" value="${esc(filters.search || '')}" placeholder="Search" aria-label="Search"></label>
        <label class="tog"><input type="checkbox" name="mine" value="1"${filters.mine ? ' checked' : ''}><span>My tasks</span></label>
        <label class="tog"><input type="checkbox" name="overdue" value="1"${filters.overdue ? ' checked' : ''}><span>Overdue</span></label>
        <label class="tog"><input type="checkbox" name="mentions" value="1"${filters.mentions ? ' checked' : ''}><span>Mentions</span></label>
        <a class="btn btn-tiny" data-csv href="/export.csv${exportQuery ? `?${esc(exportQuery)}` : ''}">CSV</a>
        <a class="btn btn-tiny" href="/">Clear</a>
      </form>`;
  const tasksBody = `${filtersHtml}${openGroups.length || doneRows.length ? table : '<p class="empty">No tasks match these filters.</p>'}`;
  const body = `
    ${myDayHtml}
    ${sheet('Tasks', tasksBody, true, 'Sorted by due date. Press N for a new task. Overdue tasks are highlighted.')}
      <dialog id="task-drawer" class="drawer"${openForm ? ' data-open="1"' : ''}>
      <div class="drawer-bar"><h2>New task</h2><button type="button" class="drawer-close" data-close-drawer aria-label="Close">×</button></div>
      ${taskForm({ task: null, users, projects, csrf, canEdit: true, currentUser: user, today, from: 'board', autofocus: false })}
    </dialog>
    <a class="fab" href="/tasks/new" data-open-drawer aria-label="New task">+</a>
    ${projectScript(projects)}`;

  return layout({
    title: 'Tasks · Sunspec',
    user,
    csrf,
    msg,
    toast,
    people: users,
    active: filters.mentions ? 'at' : 'tasks',
    crumb: `<span>Tasks</span> <span class="count-pill">${counts.open}</span> <span class="crumb-meta">${counts.overdue} overdue</span>`,
    actions: '<a class="subbar-new" href="/tasks/new" data-open-drawer>+ New task</a>',
    body,
  });
}

function kudosButton({ csrf, type, id, count = 0, mine = false, back }) {
  return `<form class="kudos" method="post" action="/kudos">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <input type="hidden" name="target_type" value="${esc(type)}">
    <input type="hidden" name="target_id" value="${esc(id)}">
    <input type="hidden" name="return" value="${esc(back)}">
    <button class="btn btn-tiny${mine ? ' on' : ''}" type="submit">Kudos ${count}</button>
  </form>`;
}

export function renderTask({ user, csrf, msg, task, comments, users, projects, activity = [], attachments = [], grokFiles = [], grokWait = null, timer = null, canEdit, canDelete, canComplete, commentPerms, commentKudos, taskKudos, today, toast }) {
  const isNew = !task?.id;
  const title = isNew ? 'New task' : task.title;
  const meta = !isNew
    ? `<p class="meta">Created by ${esc(task.creator_name || 'Unknown')} · ${esc(formatDateTime(task.created_at))} · Updated ${esc(formatDateTime(task.updated_at))}</p>`
    : '';
  const pageActions = !isNew
    ? `<div class="title-actions">${removeControl(task, user, csrf, `/tasks/${task.id}`, true)}${canComplete ? completeControl(task, user, csrf, `/tasks/${task.id}`, true) : ''}${task.status === 'done' ? kudosButton({ csrf, type: 'task', id: task.id, count: taskKudos?.counts.get(task.id) || 0, mine: taskKudos?.mine.has(task.id), back: `/tasks/${task.id}` }) : ''}</div>`
    : '';
  const commentBlock = isNew
    ? ''
    : `<section class="panel pad">
        <h2>Comments <span class="group-count">${comments.length}</span></h2>
        ${comments.length ? comments.map((comment) => `
          <article class="comment">
            <header><strong>${esc(comment.author_name)}</strong> <time>${esc(formatDateTime(comment.created_at))}</time></header>
            <div class="comment-body">${highlightMentions(comment.body, users)}</div>
            ${fileLinks(comment.files)}
            ${kudosButton({
              csrf,
              type: 'comment',
              id: comment.id,
              count: commentKudos?.counts.get(comment.id) || 0,
              mine: commentKudos?.mine.has(comment.id),
              back: `/tasks/${task.id}`,
            })}
            ${commentPerms.get(comment.id) ? `<form method="post" action="/comments/${comment.id}/delete">
              <input type="hidden" name="_csrf" value="${esc(csrf)}">
              <button class="btn btn-tiny" type="submit">Delete</button>
            </form>` : ''}
          </article>
        `).join('') : '<p class="hint">No comments yet.</p>'}
        ${fileLinks(grokFiles)}
        ${grokWait ? `<div class="grok-ack" data-grok-task="${task.id}">
          <p class="grok-ack-line">Got it, working on it<span class="grok-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>
          <p class="grok-live" data-grok-live>${esc(grokWait.live || '')}</p>
        </div>` : ''}
        <form class="stack" method="post" action="/tasks/${task.id}/comments">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <label class="field"><span>Add a comment</span>
            <textarea name="body" data-mentions rows="3" required maxlength="8000" placeholder="Add a comment. Type @ to mention someone."></textarea>
          </label>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Comment</button></div>
        </form>
      </section>`;

  return layout({
    title: `${title} · Sunspec`,
    user,
    csrf,
    msg,
    toast,
    people: users,
    active: 'tasks',
    crumb: `<a href="/">Tasks</a> <span class="sep">›</span> <span class="crumb-current">${esc(title)}</span>`,
    body: `
      <div class="title-row"><h1>${esc(title)}</h1>${pageActions}</div>
      ${meta}
      ${taskForm({ task, users, projects, csrf, canEdit: isNew || canEdit, currentUser: user, today })}
      ${isNew ? '' : `<section class="panel pad">
        <h2>Files</h2>
        ${attachments.length ? `<ul class="files">${attachments.map((file) => {
          const removable = user.role === 'superuser' || user.role === 'admin' || file.uploaded_by === user.id;
          return `<li>
            <a href="/attachments/${file.id}">${esc(file.original_name)}</a>
            <span class="hint">${Math.max(1, Math.round(file.size / 1024))} KB · ${esc(file.uploader_name)}</span>
            ${removable ? `<form method="post" action="/attachments/${file.id}/delete">
              <input type="hidden" name="_csrf" value="${esc(csrf)}">
              <button class="btn btn-tiny" type="submit">Delete</button>
            </form>` : ''}
          </li>`;
        }).join('')}</ul>` : '<p class="hint">No files yet. Maximum 10 MB.</p>'}
        <form class="file-form" method="post" action="/tasks/${task.id}/attachments" enctype="multipart/form-data">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <input type="file" name="file" required>
          <button class="btn" type="submit">Upload</button>
        </form>
      </section>
      <section class="panel pad">
        <h2>Activity</h2>
        ${activity.length ? activity.map((item) => `<p class="activity"><strong>${esc(item.actor_name)}</strong> ${esc(item.detail)} <time>${esc(formatDateTime(item.created_at))}</time></p>`).join('') : '<p class="hint">No history yet.</p>'}
      </section>`}
      ${commentBlock}
      ${projectScript(projects)}`,
  });
}

export function renderUsers({ user, csrf, msg, users, removed = null }) {
  const superuser = user.role === 'superuser';
  const rows = users.map((person) => {
    const self = person.id === user.id;
    const roleEditor = superuser && !self
      ? `<select form="user-${person.id}" name="role">${options(ROLES, person.role)}</select>`
      : '';
    return `<tr class="${person.active ? '' : 'inactive'}">
      <td><input form="user-${person.id}" name="name" required maxlength="120" value="${esc(person.name)}"></td>
      <td><input form="user-${person.id}" name="email" type="email" required value="${esc(person.email)}"></td>
      <td><div class="role-cell">${roleBadge(person.role)}${roleEditor}</div></td>
      <td><label class="check"><input form="user-${person.id}" type="checkbox" name="active" value="1"${person.active ? ' checked' : ''}${self ? ' disabled' : ''}> Active</label></td>
      <td><input form="user-${person.id}" name="password" type="password" autocomplete="new-password" placeholder="Reset password"></td>
      <td>
        <form id="user-${person.id}" method="post" action="/users/${person.id}"></form>
        <input form="user-${person.id}" type="hidden" name="_csrf" value="${esc(csrf)}">
        ${self ? `<input form="user-${person.id}" type="hidden" name="active" value="1">` : ''}
        <button class="btn" form="user-${person.id}" type="submit">Save</button>
      </td>
    </tr>`;
  }).join('');

  const body = `
    ${sheet('Users', `<form class="board-bar" method="post" action="/users">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <input name="name" required maxlength="120" placeholder="Name" aria-label="Name">
        <input name="email" type="email" required placeholder="Email" aria-label="Email">
        <input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="Password" aria-label="Password">
        ${superuser ? `<select name="role" aria-label="Role">${options(ROLES, 'user')}</select>` : ''}
        <button class="btn btn-primary" type="submit">Create</button>
      </form>
      <h2 class="light-h">People</h2>
      <div class="table-wrap">
        <table class="grid users">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Password</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No users to show.</td></tr>'}</tbody>
        </table>
      </div>
      ${removed ? `<h2 class="light-h">Removed</h2>
        ${removed.length ? `<table class="grid"><thead><tr><th>Task</th><th>Created by</th><th>Removed</th><th></th></tr></thead><tbody>
          ${removed.map((task) => `<tr>
            <td>${esc(task.title)}</td>
            <td>${esc(task.creator_name || '—')}</td>
            <td>${esc(formatDateTime(task.deleted_at))}</td>
            <td><form method="post" action="/tasks/${task.id}/restore"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="btn" type="submit">Restore</button></form></td>
          </tr>`).join('')}
        </tbody></table>` : '<p class="hint">No removed tasks.</p>'}` : ''}`, true)}`;

  return layout({
    title: 'Users · Sunspec',
    user,
    csrf,
    msg,
    active: 'users',
    crumb: '<a href="/">Tasks</a> <span class="sep">›</span> <span>Users</span>',
    body,
  });
}

function durationRows(items, labelKey) {
  if (!items.length) return '<p class="hint">No time logged.</p>';
  return `<table class="grid compact"><thead><tr><th>${labelKey === 'title' ? 'Task' : 'Name'}</th><th>Time</th></tr></thead><tbody>
    ${items.map((item) => `<tr><td>${item.id && labelKey === 'title' ? `<a href="/tasks/${item.id}">${esc(item[labelKey])}</a>` : esc(item[labelKey])}</td><td>${esc(formatDuration(item.seconds))}</td></tr>`).join('')}
  </tbody></table>`;
}

function manageHref(board, extra = {}) {
  const params = new URLSearchParams();
  params.set('period', String(extra.period || board.periodDays));
  if (board.projectId) params.set('project', String(board.projectId));
  if (extra.sort) params.set('sort', extra.sort);
  if (extra.dir) params.set('dir', extra.dir);
  return `/manage?${params}`;
}

function sortLink(board, key, label) {
  const next = board.sort === key ? (board.dir === 'asc' ? 'desc' : 'asc') : (key === 'name' ? 'asc' : 'desc');
  const mark = board.sort === key ? (board.dir === 'asc' ? ' ↑' : ' ↓') : '';
  return `<a href="${manageHref(board, { sort: key, dir: next })}">${esc(label)}${mark}</a>`;
}

function delta(now, prev, tone) {
  if (now == null || prev == null) return '';
  if (!prev) return now ? '<span class="delta flat">new</span>' : '';
  const diff = Math.round((now - prev) * 10) / 10;
  if (!diff) return '';
  let klass = 'flat';
  if (tone === 'upGood') klass = diff > 0 ? 'good' : 'bad';
  if (tone === 'upBad') klass = diff > 0 ? 'bad' : 'good';
  return `<span class="delta ${klass}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}</span> <span class="delta flat">vs prior</span>`;
}

export function renderManage({ user, csrf, msg, board, projects }) {
  const k = board.kpis;
  const avgText = k.avg == null ? '—' : `${k.avg}d`;
  const body = `
    <section class="sheet">
      <header class="sheet-title">
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        <span>Manage</span>
        <form class="manage-switch" method="get" action="/manage" data-live>
          <select name="project" aria-label="Project">${options((projects || []).map((project) => [String(project.id), project.name]), board.projectId || '', 'All projects')}</select>
          <input type="hidden" name="period" value="${board.periodDays}">
          <span class="seg-toggle">
            ${[7, 30, 90].map((days) => `<a class="${board.periodDays === days ? 'on' : ''}" href="${manageHref(board, { period: days })}">${days}d</a>`).join('')}
          </span>
          <a class="bar-clear" href="/manage">Clear</a>
        </form>
      </header>
      <div class="sheet-body">
        <section class="coach">
          <h2 class="light-h">Coach</h2>
          ${board.tips.length ? `<ul class="coach-list">${board.tips.map((item) => `<li class="${item.tone === 'good' ? 'good' : ''}"><a href="${esc(item.href)}">${esc(item.text)}</a></li>`).join('')}</ul>` : '<p class="hint">Nothing to flag on this sample.</p>'}
          <p class="manager-tip">${esc(board.managerTip)}</p>
        </section>
        <div class="kpi-row">
          <div class="kpi"><div class="kpi-top"><span>Open</span>${sparkline(k.sparkOpen, '#111')}</div><strong>${k.open}</strong>${delta(k.open, k.openPrev, 'neutral')}</div>
          <div class="kpi${k.overdue ? ' hot' : ''}"><div class="kpi-top"><span>Overdue</span>${sparkline(k.sparkOver, '#f97316')}</div><strong>${k.overdue}</strong>${delta(k.overdue, k.overduePrev, 'upBad')}</div>
          <div class="kpi"><div class="kpi-top"><span>Done</span>${sparkline(k.sparkDone, '#111')}</div><strong>${k.done}</strong>${delta(k.done, k.donePrev, 'upGood')}</div>
          <div class="kpi"><div class="kpi-top"><span>Avg cycle time</span>${sparkline(k.sparkCycle, '#f97316')}</div><strong>${avgText}</strong>${delta(k.avg, k.avgPrev, 'upBad')}</div>
        </div>
      </div>
    </section>
    <section class="sheet manage-block">
      <h2>People</h2>
      <div class="table-wrap"><table class="grid">
        <thead><tr>
          <th>${sortLink(board, 'name', 'Name')}</th>
          <th class="num">${sortLink(board, 'assigned', 'Assigned')}</th>
          <th class="num">${sortLink(board, 'done', 'Done')}</th>
          <th class="num">${sortLink(board, 'ontime', 'On time')}</th>
          <th class="num">${sortLink(board, 'avg', 'Avg cycle')}</th>
          <th class="num">${sortLink(board, 'overdue', 'Overdue')}</th>
        </tr></thead>
        <tbody>
          ${board.people.map((person) => `<tr>
            <td><a href="/?assignee=${person.id}">${esc(person.name)}</a></td>
            <td class="num">${person.assigned}</td>
            <td class="num">${person.done}</td>
            <td class="num">${ring(person.onTimePct)} ${person.onTimePct == null ? '—' : `${person.onTimePct}%`}</td>
            <td class="num">${person.avgDays == null ? '—' : `${person.avgDays}d`}</td>
            <td class="num${person.overdue ? ' late' : ''}">${person.overdue}</td>
          </tr>`).join('') || '<tr><td colspan="6">No active people.</td></tr>'}
        </tbody>
      </table></div>
    </section>
    <div class="manage-grid">
      <section class="sheet manage-block"><h2>Created and done</h2><div class="chart-pad">${throughputChart(board.throughput) || '<p class="hint">Nothing in the last 12 weeks.</p>'}</div></section>
      <section class="sheet manage-block"><h2>Flow by status</h2><div class="chart-pad">${stackedArea(board.cfd) || '<p class="hint">No status history in this period.</p>'}</div></section>
      <section class="sheet manage-block"><h2>Cycle time</h2><div class="chart-pad">${scatterChart(board.cycle.points, board.cycle.p85) || '<p class="hint">No finished tasks in this period.</p>'}${board.cycle.p85 == null ? '' : `<p class="hint">Orange line is the 85th percentile, ${board.cycle.p85} days.</p>`}</div></section>
      <section class="sheet manage-block"><h2>Open work</h2><div class="chart-pad">${backlogChart(board.backlog) || '<p class="hint">No open-work trend yet.</p>'}</div></section>
    </div>
    <section class="sheet manage-block"><h2>Workload</h2><div class="chart-pad chart-scroll">${heatMap(board.heatmap) || '<p class="hint">No finished work in this period.</p>'}</div></section>
    <div class="manage-grid">
      <section class="sheet manage-block"><h2>Needs attention</h2>
        ${board.attention.length ? `<ul class="plain">${board.attention.map((item) => `<li><a href="/tasks/${item.id}">${esc(item.title)}</a> <span class="hint">${esc(item.owner)} · ${esc(item.note)}</span></li>`).join('')}</ul>` : '<p class="hint">Nothing overdue, stuck in review, or unassigned.</p>'}
      </section>
      <section class="sheet manage-block"><h2>By project</h2>
        <div class="table-wrap"><table class="grid">
          <thead><tr><th>Project</th><th class="num">Open</th><th class="num">Overdue</th><th class="num">Done</th></tr></thead>
          <tbody>${board.projects.map((row) => `<tr><td>${esc(row.name)}</td><td class="num">${row.open}</td><td class="num${row.overdue ? ' late' : ''}">${row.overdue}</td><td class="num">${row.done}</td></tr>`).join('') || '<tr><td colspan="4">No project work in this period.</td></tr>'}</tbody>
        </table></div>
      </section>
    </div>`;

  return layout({
    title: 'Manage · Sunspec',
    user,
    csrf,
    msg,
    active: 'chart',
    crumb: '<a href="/">Tasks</a> <span class="sep">›</span> <span>Manage</span>',
    body,
  });
}

function monthCells(year, month) {
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const [y, m, d] = first.split('-').map(Number);
  const pad = (new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 6) % 7;
  const cells = Array.from({ length: pad }, () => null);
  for (let day = 1; day <= count; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

function weekCells(anchor) {
  const [year, month, day] = anchor.split('-').map(Number);
  const pad = (new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay() + 6) % 7;
  const monday = shiftDate(anchor, -pad);
  return Array.from({ length: 7 }, (unused, index) => shiftDate(monday, index));
}

function chip(task, today) {
  const overdue = isOverdue(task.due_date, task.status, today);
  const done = task.status === 'done';
  return `<a class="chip pri-${esc(task.priority || 'none')}${overdue ? ' late' : ''}${done ? ' done' : ''}" href="/tasks/${task.id}">${esc(task.title)}</a>`;
}

export function renderCalendar({ user, csrf, msg, tasks, filters, users, projects, today, view, year, month, anchor }) {
  const dated = tasks.filter((task) => task.due_date);
  const undated = tasks.filter((task) => !task.due_date);
  const byDay = new Map();
  for (const task of dated) {
    if (!byDay.has(task.due_date)) byDay.set(task.due_date, []);
    byDay.get(task.due_date).push(task);
  }
  const cells = view === 'week' ? weekCells(anchor) : monthCells(year, month);
  const label = view === 'week'
    ? `${formatDue(cells[0])} – ${formatDue(cells[6])}`
    : new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
  const prevMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  const prevWeek = shiftDate(anchor, -7);
  const nextWeek = shiftDate(anchor, 7);
  const keep = new URLSearchParams();
  if (filters.status) keep.set('status', filters.status);
  if (filters.mine) keep.set('mine', '1');
  else if (filters.assigneeId === 'none') keep.set('assignee', 'none');
  else if (filters.assigneeId) keep.set('assignee', String(filters.assigneeId));
  if (filters.projectId) keep.set('project', String(filters.projectId));
  const withKeep = (extra) => {
    const params = new URLSearchParams(keep);
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    return `/calendar?${params}`;
  };
  const grid = `<div class="cal-grid">
    ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name) => `<div class="cal-head">${name}</div>`).join('')}
    ${cells.map((day) => `<div class="cal-day${day === today ? ' today' : ''}${day ? '' : ' pad'}">${day ? `<span>${Number(day.slice(8))}</span>${(byDay.get(day) || []).map((task) => chip(task, today)).join('')}` : ''}</div>`).join('')}
  </div>`;
  const agendaDays = [...byDay.keys()].sort();
  const agenda = `<div class="cal-agenda">${agendaDays.map((day) => `<section><h2>${esc(formatDue(day))}</h2><ul class="plain">${byDay.get(day).map((task) => `<li>${chip(task, today)}</li>`).join('')}</ul></section>`).join('') || '<p class="hint">Nothing due in this range.</p>'}</div>`;
  const assigneeOptions = [['', 'All assignees'], ['none', 'Unassigned'], ...users.map((person) => [String(person.id), person.name])];
  const selectedAssignee = filters.mine ? '' : (filters.assigneeId === 'none' ? 'none' : (filters.assigneeId || ''));
  const monthHref = withKeep({ month: `${year}-${String(month).padStart(2, '0')}` });
  const weekHref = withKeep({ view: 'week', day: anchor });
  const body = `
    <section class="sheet">
      <form class="board-bar" method="get" action="/calendar" data-live>
        <a class="btn" href="${view === 'week' ? withKeep({ view: 'week', day: prevWeek }) : withKeep({ month: prevMonth })}">Prev</a>
        <strong class="cal-label">${esc(label)}</strong>
        <a class="btn" href="${view === 'week' ? withKeep({ view: 'week', day: nextWeek }) : withKeep({ month: nextMonth })}">Next</a>
        <a class="btn" href="${withKeep(view === 'week' ? { view: 'week', day: today } : { month: today.slice(0, 7) })}">Today</a>
        <span class="seg-toggle">
          <a class="${view === 'month' ? 'on' : ''}" href="${monthHref}">Month</a>
          <a class="${view === 'week' ? 'on' : ''}" href="${weekHref}">Week</a>
        </span>
        <select name="status" aria-label="Status">${options(STATUSES, filters.status, 'All statuses')}</select>
        <select name="assignee" aria-label="Assignee">${options(assigneeOptions, selectedAssignee)}</select>
        <select name="project" aria-label="Project">${options(projects.map((project) => [String(project.id), project.name]), filters.projectId || '', 'All projects')}</select>
        <label class="tog"><input type="checkbox" name="mine" value="1"${filters.mine ? ' checked' : ''}><span>My tasks</span></label>
        <input type="hidden" name="view" value="${esc(view)}">
        ${view === 'week' ? `<input type="hidden" name="day" value="${esc(anchor)}">` : `<input type="hidden" name="month" value="${year}-${String(month).padStart(2, '0')}">`}
        <a class="bar-clear" href="/calendar">Clear</a>
      </form>
      ${grid}${agenda}
    </section>
    <section class="plain-block">
      <h2>No due date</h2>
      ${undated.length ? `<ul class="plain">${undated.map((task) => `<li><a href="/tasks/${task.id}">${esc(task.title)}</a> <span class="hint">${esc(task.assignee_name || 'Unassigned')}</span></li>`).join('')}</ul>` : '<p class="hint">Every listed task has a due date.</p>'}
    </section>`;
  return layout({
    title: 'Calendar · Sunspec',
    user,
    csrf,
    msg,
    people: users,
    active: 'calendar',
    crumb: '<a href="/">Tasks</a> <span class="sep">›</span> <span>Calendar</span>',
    body,
  });
}

export function renderTeam({ user, csrf, rows }) {
  const body = `
    ${sheet('Team', `<div class="table-wrap">
      <table class="grid">
        <thead><tr><th>Person</th><th class="num">Done this week</th><th class="num">Done this month</th><th class="num">Hours this week</th><th class="num">Hours this month</th><th class="num">On time</th><th class="num">Streak</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((row) => `<tr>
            <td>${esc(row.name)}</td>
            <td class="num">${row.weekCount}</td>
            <td class="num">${row.monthCount}</td>
            <td class="num">${row.weekHours}</td>
            <td class="num">${row.monthHours}</td>
            <td class="num">${row.onTimePercent === null ? '—' : `${row.onTimePercent}%`}</td>
            <td class="num">${row.streak}</td>
          </tr>`).join('') : '<tr><td colspan="7">No active people yet.</td></tr>'}
        </tbody>
      </table>
    </div>`, true, 'Completed work and tracked hours. On time means the completion day in Johannesburg is on or before the due date. A streak is consecutive days with at least one completion, counting back from today.')}`;
  return layout({
    title: 'Team · Sunspec',
    user,
    csrf,
    active: 'team',
    crumb: '<a href="/">Tasks</a> <span class="sep">›</span> <span>Team</span>',
    body,
  });
}

export function renderForbidden({ user, csrf }) {
  return layout({
    title: 'Not allowed · Sunspec',
    user,
    csrf,
    active: '',
    crumb: '<span>Not allowed</span>',
    body: '<div class="panel empty">You do not have access to that.</div>',
  });
}

export function renderNotFound({ user, csrf }) {
  return layout({
    title: 'Not found · Sunspec',
    user,
    csrf,
    active: '',
    crumb: '<span>Not found</span>',
    body: '<div class="panel empty">That page does not exist.</div>',
  });
}
