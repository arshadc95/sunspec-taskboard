import { readFileSync } from 'node:fs';
import { backlogChart, heatMap, ring, scatterChart, sparkline, stackedArea, throughputChart } from './charts.js';
import { COLOR_NAMES, PALETTE, colorClass, colorForUser } from './colors.js';
import { PRIORITIES, ROLES, STATUSES, labelOf } from './constants.js';
import { entrySeconds, formatDateTime, formatDue, formatDuration, isOverdue, shiftDate } from './time.js';

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

function swatch(color, userId, name) {
  const label = name ? ` title="${esc(name)}"` : ' aria-hidden="true"';
  return `<span class="swatch ${colorClass(color, userId)}"${label}></span>`;
}

function nameLine(name, color, userId) {
  return `<span class="name-line">${swatch(color, userId, name)}${esc(name)}</span>`;
}

function highlightMentions(body, users) {
  const slots = [];
  const marked = String(body || '').replace(/@\[([^\]]*)\]\((\d+)\)/g, (all, name, id) => {
    const user = (users || []).find((item) => String(item.id) === String(id));
    const label = esc(user?.name || name || 'someone');
    const index = slots.push(`<span class="mention" data-user="${esc(id)}">${swatch(user?.color, id, user?.name || name || 'someone')}@${label}</span>`) - 1;
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
      const index = slots.push(`<span class="mention">${swatch(user.color, user.id, user.name)}@${label}</span>`) - 1;
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
<script type="module" src="/app.js"></script>
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

function sheet(title, inner, flush = false) {
  return `<section class="sheet"><header class="sheet-title"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"/></svg><span>${esc(title)}</span></header><div class="sheet-body${flush ? ' flush' : ''}">${inner}</div></section>`;
}

function peopleScript(users) {
  const data = (users || []).filter((user) => user.active !== 0).map((user) => ({
    id: user.id,
    name: user.name,
    swatch: colorClass(user.color, user.id),
  }));
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
        <button type="button" data-grok-chats aria-label="Chats" title="Chats">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <input class="grok-title" data-grok-title maxlength="80" placeholder="New chat" aria-label="Chat title" autocomplete="off">
        <button type="button" data-grok-new aria-label="New chat" title="New chat">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <button type="button" data-grok-sound aria-pressed="true" aria-label="Sound" title="Sound">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3l5-4v14l-5-4H4z" fill="none" stroke="currentColor" stroke-width="2"/><path class="sound-wave" d="M16 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <button type="button" data-grok-full aria-pressed="false" aria-label="Full screen" title="Full screen">
          <svg class="icon-full" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          <svg class="icon-exit" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <button type="button" data-grok-close aria-label="Close" title="Close">×</button>
      </header>
      <div class="grok-body">
        <div class="grok-chats" data-grok-list hidden>
          <div class="grok-side-brand">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4 L8 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"/></svg>
            <strong>Grok</strong>
          </div>
          <div class="grok-chat-tools">
            <input class="grok-chat-search" data-grok-search placeholder="Search chats" aria-label="Search chats">
            <button type="button" data-grok-new-side>+ New chat</button>
          </div>
          <div data-grok-threads></div>
        </div>
        <div class="grok-stage">
          <div class="grok-log" data-grok-log></div>
          <form class="grok-form" data-grok-form>
            <div class="grok-queue" data-grok-queue></div>
            <div class="grok-picked" data-grok-picked></div>
            <p class="grok-file-error" data-grok-file-error></p>
            <p class="grok-pdf-note" data-grok-pdf-note hidden>Grok can read attached PDFs (max 5 × 15 MB, deleted after 24 h).</p>
            <div class="grok-compose">
              <button type="button" class="grok-attach" data-grok-attach aria-label="Attach PDF">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5V7a4 4 0 0 1 8 0v9a3 3 0 0 1-6 0V8.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                <span class="plus">+</span>
              </button>
              <textarea name="text" maxlength="4000" rows="1" placeholder="Message Grok"></textarea>
              <input type="file" accept="application/pdf,.pdf" multiple hidden>
              <button type="submit">Send</button>
            </div>
          </form>
        </div>
      </div>
      <div class="grok-backdrop" data-grok-backdrop></div>
      <div class="grok-drop" data-grok-drop>Drop PDF for Grok</div>
      <div class="grok-viewer" data-grok-viewer hidden>
        <header>
          <strong data-grok-viewer-name>PDF</strong>
          <a data-grok-viewer-download href="/files/0">Download</a>
          <button type="button" data-grok-viewer-close aria-label="Close">×</button>
        </header>
        <iframe data-grok-viewer-frame title="PDF"></iframe>
      </div>
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
    ${swatch(user.color, user.id, user.name)}
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

function taskForm({ task, users, projects, csrf, canEdit, currentUser, today, from, autofocus = true, split = false, metaHtml = '' }) {
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
          <div class="assignee-chips" data-assignee-chips>${(value.assignees || []).map((person) => `<span class="assignee-chip" data-id="${person.id}">${swatch(person.color, person.id, person.name)}${esc(person.name)}<button type="button" data-remove-assignee aria-label="Remove ${esc(person.name)}">×</button></span>`).join('')}</div>
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
    ${canEdit && !split ? `<div class="form-footer">${value.id ? '' : '<button class="btn btn-line" type="submit" name="again" value="1">Save & add another</button>'}<button class="btn btn-primary" type="submit">Save</button></div>` : ''}
  `;
  if (split) {
    const action = task?.id ? `/tasks/${value.id}` : '/tasks';
    const body = `
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      ${from ? `<input type="hidden" name="from" value="${esc(from)}">` : ''}
      <section class="form-card task-details">
        <h2>Details</h2>
        <label class="field"><span>Title</span>
          <input class="title-input" name="title" required maxlength="200" value="${esc(value.title || '')}" placeholder="What needs doing?" ${off} ${!value.id && canEdit && autofocus ? 'autofocus' : ''}>
        </label>
        <label class="field"><span>Description</span>
          <textarea name="description" data-mentions rows="4" maxlength="20000" placeholder="Add detail. Type @ to mention someone." ${off}>${esc(value.description || '')}</textarea>
        </label>
      </section>
      <aside class="task-side">
        <section class="form-card">
          <h2>Task</h2>
          <div class="pair">
            <label class="field"><span>Project</span>
              <span class="combo">
                <input name="project_name" value="${esc(projectName)}" placeholder="Search or create project" autocomplete="off" data-project-input ${off}>
                <input type="hidden" name="project_id" value="${esc(value.project_id || '')}" data-project-id>
              </span>
            </label>
            <div class="field" data-assignee-field>
              <div class="label-row"><span>Assignees</span>${canEdit && currentUser ? `<button class="assign-link" type="button" data-assign-me="${currentUser.id}">Assign to me</button>` : ''}</div>
              <div class="assignee-chips" data-assignee-chips>${(value.assignees || []).map((person) => `<span class="assignee-chip" data-id="${person.id}">${swatch(person.color, person.id, person.name)}${esc(person.name)}<button type="button" data-remove-assignee aria-label="Remove ${esc(person.name)}">×</button></span>`).join('')}</div>
              <input type="hidden" name="assignee_ids" value="${esc((value.assignee_ids || []).join(','))}" data-assignee-ids>
              <input class="assignee-search" placeholder="Search people" autocomplete="off" data-assignee-search ${off}>
            </div>
          </div>
          <div class="field">
            <span>Status</span>
            <input type="hidden" name="status" value="${esc(status)}" data-status-input>
            <div class="segments">${segments(STATUSES, status, 'data-status')}</div>
          </div>
          <div class="field">
            <span>Priority</span>
            <input type="hidden" name="priority" value="${esc(value.priority || '')}" data-priority-input>
            <div class="segments">${segments([['', 'None'], ...PRIORITIES], value.priority || '', 'data-priority')}</div>
          </div>
          <div class="field">
            <span>Due</span>
            <div class="due-row">
              <div class="chips">${chips.map(([, label, date]) => `<button type="button" class="chip${due === date ? ' on' : ''}" data-due="${esc(date)}" ${off}>${label}</button>`).join('')}</div>
              <input name="due_date" type="date" value="${esc(due)}" data-due-input ${off}>
            </div>
          </div>
          ${metaHtml}
        </section>
      </aside>`;
    if (!canEdit) return `<div class="task-form is-readonly">${body}</div>`;
    return `<form id="task-edit" class="task-form task-edit" method="post" action="${action}">${body}</form>`;
  }
  if (!canEdit) return `<div class="task-form is-readonly">${fields}</div>`;
  const action = task?.id ? `/tasks/${value.id}` : '/tasks';
  return `<form class="task-form" method="post" action="${action}">${fields}</form>`;
}

function projectScript(projects) {
  const data = (projects || []).map((project) => ({ id: project.id, name: project.name }));
  return `<script type="application/json" id="project-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function canRunTimer(task, user) {
  if (!user || !task) return false;
  if (Array.isArray(task.assignee_ids) && task.assignee_ids.includes(user.id)) return true;
  return task.assignee_id === user.id;
}

function timerMark(task, user) {
  const running = task.running || [];
  if (!running.length) return '';
  const names = running.map((row) => row.user_name).join(', ');
  const mine = running.some((row) => row.user_id === user.id);
  return `<span class="dot${mine ? ' mine' : ''}" title="Timer running: ${esc(names)}">●</span> `;
}

function rowTimer(task, user, csrf, back) {
  if (!canRunTimer(task, user)) return '';
  const mine = (task.running || []).find((row) => row.user_id === user.id);
  const action = mine ? 'stop' : 'start';
  const label = mine ? 'Stop' : 'Start';
  return `<form class="row-timer" method="post" action="/tasks/${task.id}/timer/${action}">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <input type="hidden" name="return" value="board">
    <input type="hidden" name="back" value="${esc(back)}">
    <button class="btn btn-tiny" type="submit">${label}</button>
  </form>`;
}

function timeBits(task, user) {
  const mine = (task.running || []).find((row) => row.user_id === user.id);
  const shown = mine
    ? `<span class="timer-live" data-started="${esc(mine.started_at)}"><strong class="timer-elapsed">${esc(formatDuration(entrySeconds(mine.started_at, null)))}</strong></span>`
    : esc(formatDuration(task.time_seconds || 0));
  return `${timerMark(task, user)}${shown}`;
}

function assigneeMarks(task) {
  return (task.assignees || []).map((person) => swatch(person.color, person.id, person.name)).join('');
}

function assigneeCell(task) {
  const people = task.assignees || [];
  if (!people.length) return '—';
  const names = people.map((person) => person.name);
  const label = names.length === 1
    ? esc(names[0])
    : `<span title="${esc(names.join(', '))}">${esc(names[0])} +${names.length - 1}</span>`;
  return `<span class="name-line">${assigneeMarks(task)}${label}</span>`;
}

function removeControl(task, user, csrf, back, prominent = false) {
  if (!(user.role === 'superuser' || user.role === 'admin' || task.created_by === user.id)) return '';
  return `<form class="row-remove" method="post" action="/tasks/${task.id}/delete" data-confirm="Remove this task from the board?">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <input type="hidden" name="back" value="${esc(back)}">
    <button class="btn ${prominent ? '' : 'btn-tiny'} icon-btn-trash" type="submit" title="Remove" aria-label="Remove"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M8 7l1 13h6l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
  </form>`;
}

function canQuickStatus(user, task) {
  if (!user || !task) return false;
  if (user.role === 'superuser' || user.role === 'admin') return true;
  if (task.created_by === user.id || task.assignee_id === user.id) return true;
  return Array.isArray(task.assignee_ids) && task.assignee_ids.includes(user.id);
}

function reviewerMark(task) {
  if (task.status !== 'review' || !task.reviewer_name) return '';
  return `<span class="reviewer">Reviewer: ${esc(task.reviewer_name)}</span>`;
}

function reviewControl(task, user, back) {
  if (task.status === 'review' || task.status === 'done' || !canQuickStatus(user, task)) return '';
  return `<button type="button" class="btn btn-tiny review" data-send-review data-task="${task.id}" data-back="${esc(back)}" title="Send to review" aria-label="Send to review">R</button>`;
}

function reviewDialog(csrf) {
  return `<dialog id="review-dialog" class="drawer">
    <div class="drawer-bar"><h2>Send to review</h2><button type="button" class="drawer-close" data-close-review aria-label="Close">×</button></div>
    <form class="task-form" method="post" action="/tasks/0/review" data-review-form>
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <input type="hidden" name="back" value="/" data-review-back>
      <div class="form-sections">
        <div class="form-card">
          <label class="field">Reviewer
            <input data-reviewer-search placeholder="Search people" autocomplete="off">
            <input type="hidden" name="reviewer_id" value="" data-reviewer-id>
          </label>
          <label class="field">Note
            <input name="note" maxlength="280" placeholder="Optional">
          </label>
        </div>
      </div>
      <div class="form-footer"><button class="btn btn-primary" type="submit">Send to review</button></div>
    </form>
  </dialog>`;
}

function completeControl(task, user, csrf, back, prominent = false) {
  if (task.status === 'done' || !canQuickStatus(user, task)) return '';
  return `<form class="row-complete" method="post" action="/tasks/${task.id}/complete">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <input type="hidden" name="back" value="${esc(back)}">
    <button class="btn ${prominent ? 'btn-primary' : 'btn-tiny complete'}" type="submit" title="Mark done">${prominent ? '✓ Complete' : '✓'}</button>
  </form>`;
}

function rowStatusActions(task, user, csrf, back, prominent = false) {
  return `${reviewControl(task, user, back)}${completeControl(task, user, csrf, back, prominent)}`;
}

function taskCard(task, today, user, csrf, back) {
  const overdue = isOverdue(task.due_date, task.status, today);
  return `<article class="task-card${overdue ? ' overdue' : ''}${task.justAdded ? ' just-added' : ''}" data-href="/tasks/${task.id}">
    <div class="card-top"><a class="title-link" href="/tasks/${task.id}">${esc(task.title)}</a>${reviewerMark(task)}</div>
    <div class="card-meta">${esc(task.project_name || 'No project')} · ${task.assignees?.length ? assigneeCell(task) : 'Unassigned'}</div>
    <div class="card-row">
      <span class="status status-${esc(task.status)}">${esc(labelOf(STATUSES, task.status))}</span>
      <span class="pri pri-${esc(task.priority || 'none')}">${esc(labelOf(PRIORITIES, task.priority) || '—')}</span>
      <span class="due">${esc(formatDue(task.due_date))}</span>
      <span class="time">${timeBits(task, user)}${rowTimer(task, user, csrf, back)}</span>
    </div>
    <div class="card-meta">${task.comment_count} comments · ${esc(formatDateTime(task.updated_at))}</div>
    <div class="card-actions">${rowStatusActions(task, user, csrf, back)}</div>
  </article>`;
}

function taskRow(task, today, user, csrf, back, highlight) {
  const overdue = isOverdue(task.due_date, task.status, today);
  const added = String(highlight || '') === String(task.id);
  return `<tr class="task-row${overdue ? ' overdue' : ''}${added ? ' just-added' : ''}" data-href="/tasks/${task.id}">
    <td><a class="title-link" href="/tasks/${task.id}">${esc(task.title)}</a>${reviewerMark(task)}</td>
    <td>${esc(task.project_name || '—')}</td>
    <td>${assigneeCell(task)}</td>
    <td class="status status-${esc(task.status)}">${esc(labelOf(STATUSES, task.status))}</td>
    <td class="pri pri-${esc(task.priority || 'none')}">${esc(labelOf(PRIORITIES, task.priority) || '—')}</td>
    <td class="due">${esc(formatDue(task.due_date))}</td>
    <td class="time">${timeBits(task, user)}${rowTimer(task, user, csrf, back)}</td>
    <td class="num">${task.comment_count}</td>
    <td class="when">${esc(formatDateTime(task.updated_at))}</td>
    <td class="row-actions">${rowStatusActions(task, user, csrf, back)}</td>
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
        ${mineDay.timer ? `<a href="/tasks/${mineDay.timer.task_id}">Timer · ${esc(mineDay.timer.title)}</a>` : '<span>No timer running</span>'}
      </div>
      <div class="std" data-standard>
        <div class="std-row">
          <strong class="std-title" data-std-title>${esc(first.title)}</strong>
          <span class="std-code" data-std-code>${esc(first.code)}</span>
          <button type="button" class="std-nav" data-std-prev aria-label="Previous standard">‹</button>
          <button type="button" class="std-nav" data-std-next aria-label="Next standard">›</button>
        </div>
        <p class="std-why" data-std-why>${esc(first.why)}</p>
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
    ${sheet('Tasks', tasksBody, true)}
      <dialog id="task-drawer" class="drawer"${openForm ? ' data-open="1"' : ''}>
      <div class="drawer-bar"><h2>New task</h2><button type="button" class="drawer-close" data-close-drawer aria-label="Close">×</button></div>
      ${taskForm({ task: null, users, projects, csrf, canEdit: true, currentUser: user, today, from: 'board', autofocus: false })}
    </dialog>
    <a class="fab" href="/tasks/new" data-open-drawer aria-label="New task">+</a>
    ${projectScript(projects)}
    ${reviewDialog(csrf)}`;

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

function renderTimer(task, csrf, timer) {
  if (!task?.id || !timer) return '';
  const mine = timer.mine;
  const summary = timer.summary || { total: 0, perUser: [] };
  const entries = timer.entries || [];
  const controls = !timer.canControl
    ? '<p class="hint">Only the assignee can start or stop the timer.</p>'
    : mine
    ? `<p class="timer-live" data-started="${esc(mine.started_at)}">Running since ${esc(formatDateTime(mine.started_at))} · <strong class="timer-elapsed">${esc(formatDuration(entrySeconds(mine.started_at, null)))}</strong></p>
      <form method="post" action="/tasks/${task.id}/timer/stop"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="btn btn-danger" type="submit">Stop</button></form>`
    : `<form method="post" action="/tasks/${task.id}/timer/start"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="btn btn-primary" type="submit">Start</button></form>
      ${timer.other ? `<p class="hint">Starting stops your timer on <a href="/tasks/${timer.other.task_id}">${esc(timer.other.task_title)}</a>.</p>` : ''}`;
  return `<section class="panel pad">
    <h2>Time</h2>
    ${controls}
    <p>Total ${esc(formatDuration(summary.total))}</p>
    ${summary.perUser.length ? `<table class="grid compact"><thead><tr><th>Person</th><th>Time</th></tr></thead><tbody>
      ${summary.perUser.map((person) => `<tr><td>${nameLine(person.user_name, person.color, person.user_id)}</td><td>${esc(formatDuration(person.seconds))}</td></tr>`).join('')}
    </tbody></table>` : '<p class="hint">No time logged yet.</p>'}
    ${entries.length ? `<h2>Entries</h2><ul class="plain">${entries.map((entry) => `<li>${nameLine(entry.user_name, entry.color, entry.user_id)} · ${esc(formatDateTime(entry.started_at))} – ${entry.ended_at ? esc(formatDateTime(entry.ended_at)) : 'running'} · ${esc(formatDuration(entrySeconds(entry.started_at, entry.ended_at)))}</li>`).join('')}</ul>` : ''}
  </section>`;
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
  const editable = isNew || canEdit;
  const meta = !isNew
    ? `<p class="meta">Created by ${nameLine(task.creator_name || 'Unknown', task.creator_color, task.created_by)} · ${esc(formatDateTime(task.created_at))} · Updated ${esc(formatDateTime(task.updated_at))}</p>${task.status === 'review' && task.reviewer_name ? `<p class="meta">Reviewer: ${nameLine(task.reviewer_name, task.reviewer_color, task.reviewer_id)}</p>` : ''}`
    : '';
  const saveButtons = editable
    ? `${isNew ? '<button class="btn btn-line" type="submit" form="task-edit" name="again" value="1">Save & add another</button>' : ''}<button class="btn btn-primary" type="submit" form="task-edit">Save</button>`
    : '';
  const pageActions = `<div class="title-actions">${!isNew ? `${removeControl(task, user, csrf, `/tasks/${task.id}`, true)}${canComplete ? rowStatusActions(task, user, csrf, `/tasks/${task.id}`, true) : ''}${task.status === 'done' ? kudosButton({ csrf, type: 'task', id: task.id, count: taskKudos?.counts.get(task.id) || 0, mine: taskKudos?.mine.has(task.id), back: `/tasks/${task.id}` }) : ''}` : ''}${saveButtons}</div>`;
  const commentBlock = isNew
    ? ''
    : `<section class="panel pad">
        <h2>Comments <span class="group-count">${comments.length}</span></h2>
        ${comments.length ? comments.map((comment) => `
          <article class="comment">
            <header><strong>${nameLine(comment.author_name, comment.author_color, comment.author_id)}</strong> <time>${esc(formatDateTime(comment.created_at))}</time></header>
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
      <div class="task-layout">
      ${taskForm({ task, users, projects, csrf, canEdit: editable, currentUser: user, today, split: true, metaHtml: meta })}
      <div class="task-rest">
      ${renderTimer(task, csrf, timer)}
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
      </div>
      </div>
      ${projectScript(projects)}
      ${isNew ? '' : reviewDialog(csrf)}`,
  });
}

export function renderUsers({ user, csrf, msg, users, removed = null }) {
  const superuser = user.role === 'superuser';
  const rows = users.map((person) => {
    const self = person.id === user.id;
    const roleEditor = superuser && !self
      ? `<select form="user-${person.id}" name="role">${options(ROLES, person.role)}</select>`
      : '';
    const shown = colorForUser(person.id, person.color);
    return `<tr class="${person.active ? '' : 'inactive'}">
      <td>
        <div class="user-name">
          ${swatch(person.color, person.id, person.name)}
          <span class="color-pick">${PALETTE.map((color, index) => `<label title="${esc(COLOR_NAMES[index])}"><input form="user-${person.id}" type="radio" name="color" value="${color}"${shown === color ? ' checked' : ''}><i class="swatch c-${index}" title="${esc(COLOR_NAMES[index])}"></i></label>`).join('')}</span>
          <input class="user-name-input" form="user-${person.id}" name="name" required maxlength="120" value="${esc(person.name)}">
        </div>
      </td>
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

function manageHref(board, extra = {}) {
  const params = new URLSearchParams();
  const month = extra.month !== undefined ? extra.month : board.month;
  if (month) params.set('month', month);
  if (board.projectId) params.set('project', String(board.projectId));
  return `/manage?${params}`;
}

function delta(now, prev, tone, label) {
  if (now == null || prev == null) return '';
  if (!prev) return now ? '<span class="delta flat">new</span>' : '';
  const diff = Math.round((now - prev) * 10) / 10;
  if (!diff) return '';
  let klass = 'flat';
  if (tone === 'upGood') klass = diff > 0 ? 'good' : 'bad';
  if (tone === 'upBad') klass = diff > 0 ? 'bad' : 'good';
  return `<span class="delta ${klass}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}</span> <span class="delta flat">${esc(label)}</span>`;
}

function manageCard(title, sub, inner) {
  return `<section class="sheet manage-block"><h2>${esc(title)}</h2><p class="card-sub">${esc(sub)}</p>${inner}</section>`;
}

function kpiSpark(series, color, zeroCounts = false) {
  const present = (series || []).filter((value) => value != null);
  const signal = zeroCounts ? present.length > 0 : present.some((value) => value > 0);
  if (!signal) return '<span class="kpi-empty">Not enough data yet</span>';
  return sparkline(present.map((value) => value || 0), color);
}

function flowSubtitle(cfd) {
  const names = [
    ['todo', 'To do'],
    ['in_progress', 'In progress'],
    ['review', 'Review'],
    ['done', 'Done'],
  ].filter(([key]) => (cfd?.[key] || []).some((value) => value > 0)).map(([, label]) => label);
  if (!names.length) return 'Each bar is one day in the selected month, up to today.';
  const list = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  return `Each bar is one day, up to today. ${list}.`;
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
          <input type="hidden" name="month" value="${esc(board.month)}">
          <nav class="month-step" aria-label="Month">
            ${board.canPrev ? `<a class="month-step-btn" href="${manageHref(board, { month: board.prevMonth })}" aria-label="Previous month">‹</a>` : '<span class="month-step-btn is-off" aria-disabled="true">‹</span>'}
            <span class="month-step-label">${esc(board.monthTitle)}</span>
            ${board.canNext ? `<a class="month-step-btn" href="${manageHref(board, { month: board.nextMonth })}" aria-label="Next month">›</a>` : '<span class="month-step-btn is-off" aria-disabled="true">›</span>'}
          </nav>
          <a class="bar-clear" href="/manage">Clear</a>
        </form>
      </header>
      <div class="sheet-body">
        <section class="coach">
          <h2 class="light-h">Tips</h2>
          ${board.tips.length ? `<ul class="coach-list">${board.tips.map((item) => `<li><a href="${esc(item.href)}">${esc(item.text)}</a></li>`).join('')}</ul>` : '<p class="hint">All good this month.</p>'}
        </section>
        <div class="kpi-row">
          <div class="kpi"><div class="kpi-top"><span>Open</span>${kpiSpark(k.sparkOpen, '#111')}</div><strong>${k.open}</strong>${delta(k.open, k.openPrev, 'neutral', board.compare)}</div>
          <div class="kpi${k.overdue ? ' hot' : ''}"><div class="kpi-top"><span>Overdue</span>${kpiSpark(k.sparkOver, '#f97316')}</div><strong>${k.overdue}</strong>${delta(k.overdue, k.overduePrev, 'upBad', board.compare)}</div>
          <div class="kpi"><div class="kpi-top"><span>Done</span>${kpiSpark(k.sparkDone, '#111')}</div><strong>${k.done}</strong>${delta(k.done, k.donePrev, 'upGood', board.compare)}</div>
          <div class="kpi"><div class="kpi-top"><span>Avg days to finish</span>${k.avg == null ? '' : kpiSpark(k.sparkCycle, '#f97316', true)}</div>${k.avg == null ? '<p class="kpi-empty">Not enough data yet</p>' : `<strong>${avgText}</strong>${delta(k.avg, k.avgPrev, 'upBad', board.compare)}`}</div>
        </div>
      </div>
    </section>
    <section class="sheet manage-block">
      <h2>People</h2>
      <p class="card-sub">Assigned work, what was finished, and how long it took.</p>
      <div class="table-wrap"><table class="grid">
        <thead><tr>
          <th>Name</th>
          <th class="num">Assigned</th>
          <th class="num">Done</th>
          <th class="num">On time</th>
          <th class="num">Avg days</th>
          <th class="num">Overdue</th>
        </tr></thead>
        <tbody>
          ${board.people.map((person) => `<tr>
            <td><a href="/?assignee=${person.id}">${nameLine(person.name, person.color, person.id)}</a></td>
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
      ${manageCard('Created vs done', 'If created stays above done, work is piling up.', `<div class="chart-pad">${throughputChart(board.throughput) || '<p class="hint">Nothing in the last 12 weeks.</p>'}</div>`)}
      ${manageCard('Status over time', flowSubtitle(board.cfd), `<div class="chart-pad">${stackedArea(board.cfd) || '<p class="hint">No status history in this period.</p>'}</div>`)}
      ${manageCard('Days per task', 'Each dot is a finished task. Higher means it took longer.', `<div class="chart-pad">${scatterChart(board.cycle.points, board.cycle.p85) || '<p class="hint">No finished tasks in this period.</p>'}</div>`)}
      ${manageCard('Open over time', 'A flat or falling line means open work is not growing.', `<div class="chart-pad">${backlogChart(board.backlog) || '<p class="hint">No open tasks in this period.</p>'}</div>`)}
    </div>
    ${manageCard('Workload', 'Darker = more open tasks that day. Orange = finished a task.', `<div class="chart-pad chart-scroll">${heatMap(board.heatmap) || '<p class="hint">No open work in this period.</p>'}</div>`)}
    ${manageCard('Month by month', 'Created, finished, and still late at the end of each month.', `<div class="table-wrap"><table class="grid">
      <thead><tr><th>Month</th><th class="num">Created</th><th class="num">Done</th><th class="num">Overdue</th><th class="num">Avg days to finish</th></tr></thead>
      <tbody>${(board.monthRows || []).map((row) => `<tr><td>${esc(row.label)}</td><td class="num">${row.created}</td><td class="num">${row.done}</td><td class="num${row.overdue ? ' late' : ''}">${row.overdue}</td><td class="num">${row.avg == null ? '—' : row.avg}</td></tr>`).join('')}</tbody>
    </table></div>`)}
    <div class="manage-grid">
      ${manageCard('Needs attention', board.hasReview ? 'Late tasks, tasks stuck in review, and tasks with nobody assigned.' : 'Late tasks and tasks with nobody assigned.', board.attention.length ? `<ul class="plain">${board.attention.map((item) => `<li><a href="/tasks/${item.id}">${esc(item.title)}</a> <span class="hint">${item.owners?.length ? item.owners.map((person) => nameLine(person.name, person.color, person.id)).join(' ') : 'Unassigned'} · ${esc(item.note)}</span></li>`).join('')}</ul>` : `<p class="hint">${board.hasReview ? 'Nothing overdue, stuck in review, or unassigned.' : 'Nothing overdue or unassigned.'}</p>`)}
      ${manageCard('By project', 'Open, overdue, and finished tasks in this period.', `<div class="table-wrap"><table class="grid">
          <thead><tr><th>Project</th><th class="num">Open</th><th class="num">Overdue</th><th class="num">Done</th></tr></thead>
          <tbody>${board.projects.map((row) => `<tr><td>${esc(row.name)}</td><td class="num">${row.open}</td><td class="num${row.overdue ? ' late' : ''}">${row.overdue}</td><td class="num">${row.done}</td></tr>`).join('') || '<tr><td colspan="4">No project work in this period.</td></tr>'}</tbody>
        </table></div>`)}
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
  return `<a class="chip pri-${esc(task.priority || 'none')}${overdue ? ' late' : ''}${done ? ' done' : ''}" href="/tasks/${task.id}">${assigneeMarks(task)}${esc(task.title)}</a>`;
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
      ${undated.length ? `<ul class="plain">${undated.map((task) => `<li><a href="/tasks/${task.id}">${esc(task.title)}</a> <span class="hint">${task.assignees?.length ? assigneeCell(task) : 'Unassigned'}</span></li>`).join('')}</ul>` : '<p class="hint">Every listed task has a due date.</p>'}
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

function hoursLabel(value) {
  if (!value) return 'No hours';
  return `${value}h`;
}

function onTimeLabel(value) {
  if (value == null) return '—';
  return `${value}%`;
}

function streakLabel(value) {
  if (!value) return 'No streak';
  return value === 1 ? '1 day' : `${value} days`;
}

function teamTasks(row) {
  const tasks = row.upcoming || [];
  const more = row.more || 0;
  const body = !row.open
    ? '<p class="person-empty">No open tasks</p>'
    : (tasks.length
      ? `<ul class="person-due">${tasks.map((task) => `<li><a href="/tasks/${task.id}">${esc(task.title)}</a> <time class="${task.late ? 'late' : ''}">${esc(formatDue(task.due))}</time></li>`).join('')}</ul>`
      : '<p class="person-empty">No due dates</p>');
  const extra = more > 0 ? `<a href="/?assignee=${row.id}">+${more} more</a>` : '';
  return `<div class="person-tasks">${body}<p class="person-more">${extra}</p></div>`;
}

function teamCard(row) {
  return `<article class="person-card">
    <h2>${nameLine(row.name, row.color, row.id)}${roleBadge(row.role)}</h2>
    <div class="person-nums">
      <div><span>Open</span><strong>${row.open}</strong></div>
      <div class="${row.overdue ? 'hot' : ''}"><span>Overdue</span><strong>${row.overdue}</strong></div>
      <div><span>Done this month</span><strong>${row.monthCount}</strong></div>
    </div>
    <p class="person-small"><span>${hoursLabel(row.monthHours)} this month</span><span>On time ${onTimeLabel(row.onTimePercent)}</span><span>${streakLabel(row.streak)}</span></p>
    <div class="load-track" title="${row.open} open"><span class="w-${Math.max(0, Math.min(100, Math.round(row.load || 0)))}"></span></div>
    ${teamTasks(row)}
  </article>`;
}

export function renderTeam({ user, csrf, rows }) {
  const body = `
    ${sheet('Team', rows.length ? `<div class="team-grid">${rows.map((row) => teamCard(row)).join('')}</div>` : '<p class="hint">No active people yet.</p>')}`;
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
