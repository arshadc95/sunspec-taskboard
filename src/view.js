import { PRIORITIES, ROLES, STATUSES, labelOf } from './constants.js';
import { daysBetween, entrySeconds, formatDateTime, formatDue, formatDuration, isOverdue, shiftDate } from './time.js';

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
    </button>
    <section class="grok-panel" hidden>
      <header class="grok-head">
        <button type="button" data-grok-chats>Chats</button>
        <strong>Grok</strong>
        <button type="button" data-grok-new>+ New chat</button>
        <button type="button" data-grok-close aria-label="Close">×</button>
      </header>
      <div class="grok-chats" data-grok-list hidden></div>
      <div class="grok-log" data-grok-log></div>
      <form class="grok-form" data-grok-form>
        <div class="grok-picked" data-grok-picked></div>
        <div class="grok-compose">
          <label class="grok-attach">PDF<input type="file" accept="application/pdf,.pdf" multiple hidden></label>
          <input name="text" maxlength="4000" placeholder="Message Grok" autocomplete="off">
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
  <div class="top-spacer"></div>
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
      ${navLink('/?mentions=1', 'at', 'Mentions', active, unread)}
      ${navLink('/calendar', 'calendar', 'Calendar', active)}
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
    <div class="subbar">
      <div class="crumb">${crumb}</div>
      <div class="subbar-actions">${actions}</div>
    </div>
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
  <a class="${active === 'at' ? 'active' : ''}" href="/?mentions=1">Mentions${unread ? ` (${unread > 9 ? '9+' : unread})` : ''}</a>
  <a class="${active === 'calendar' ? 'active' : ''}" href="/calendar">Calendar</a>
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

function taskForm({ task, users, projects, csrf, canEdit, currentUser, today, from }) {
  const value = task || {};
  const projectName = value.project_name || '';
  const due = value.due_date || '';
  const day = today || '';
  const chips = day
    ? [['today', 'Today', day], ['tomorrow', 'Tomorrow', shiftDate(day, 1)], ['week', 'Next week', shiftDate(day, 7)], ['none', 'None', '']]
    : [];
  const off = canEdit ? '' : 'disabled';
  const fields = `
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    ${from ? `<input type="hidden" name="from" value="${esc(from)}">` : ''}
    <label class="field"><span>Title</span>
      <input class="title-input" name="title" required maxlength="200" value="${esc(value.title || '')}" placeholder="What needs doing?" ${off} ${!value.id && canEdit ? 'autofocus' : ''}>
    </label>
    <label class="field"><span>Description</span>
      <textarea name="description" data-mentions rows="4" maxlength="20000" placeholder="Add detail. Type @ to mention someone." ${off}>${esc(value.description || '')}</textarea>
      ${value.description ? `<div class="desc-preview">${highlightMentions(value.description, users)}</div>` : ''}
    </label>
    <div class="form-grid">
      <label class="field"><span>Project</span>
        <span class="combo">
          <input name="project_name" value="${esc(projectName)}" placeholder="Search or create project" autocomplete="off" data-project-input ${off}>
          <input type="hidden" name="project_id" value="${esc(value.project_id || '')}" data-project-id>
        </span>
      </label>
      <label class="field"><span>Assignee</span>
        <span class="combo">
          <input value="${esc(value.assignee_name || '')}" placeholder="Search people" autocomplete="off" data-user-input ${off}>
          <input type="hidden" name="assignee_id" value="${esc(value.assignee_id || '')}" data-user-id>
          ${canEdit && currentUser ? `<button class="btn btn-tiny" type="button" data-assign-me="${currentUser.id}">Assign to me</button>` : ''}
        </span>
      </label>
      <label class="field"><span>Status</span>
        <select name="status" ${off}>${options(STATUSES, value.status || 'todo')}</select>
      </label>
      <div class="field"><span>Priority</span>
        <input type="hidden" name="priority" value="${esc(value.priority || '')}" data-priority-input>
        <div class="segments">${[['','None'], ...PRIORITIES].map(([key, label]) => `<button type="button" class="seg pri-${esc(key || 'none')}${String(value.priority || '') === key ? ' on' : ''}" data-priority="${esc(key)}" ${off}>${esc(label)}</button>`).join('')}</div>
      </div>
      <div class="field"><span>Due date</span>
        <div class="chips">${chips.map(([key, label, date]) => `<button type="button" class="chip" data-due="${esc(date)}" ${off}>${label}</button>`).join('')}</div>
        <input name="due_date" type="date" value="${esc(due)}" data-due-input ${off}>
      </div>
    </div>
    ${canEdit ? `<div class="form-actions"><button class="btn btn-primary" type="submit">Save</button>${value.id ? '' : '<button class="btn" type="submit" name="again" value="1">Save & add another</button>'}</div>` : ''}
  `;
  if (!canEdit) return `<div class="stack">${fields}</div>`;
  const action = task?.id ? `/tasks/${value.id}` : '/tasks';
  return `<form class="stack task-form" method="post" action="${action}">${fields}</form>`;
}

function projectScript(projects) {
  const data = (projects || []).map((project) => ({ id: project.id, name: project.name }));
  return `<script type="application/json" id="project-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function timerMark(task, user) {
  const running = task.running || [];
  if (!running.length) return '';
  const names = running.map((row) => row.user_name).join(', ');
  const mine = running.some((row) => row.user_id === user.id);
  return `<span class="dot${mine ? ' mine' : ''}" title="Timer running: ${esc(names)}">●</span> `;
}

function isAssignee(task, user) {
  return task.assignee_id === user.id;
}

function rowTimer(task, user, csrf, back) {
  if (!isAssignee(task, user)) return '';
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

function timeCell(task, user, csrf, back) {
  const mine = (task.running || []).find((row) => row.user_id === user.id);
  const shown = mine
    ? `<span class="timer-live" data-started="${esc(mine.started_at)}"><strong class="timer-elapsed">${esc(formatDuration(entrySeconds(mine.started_at, null)))}</strong></span>`
    : esc(formatDuration(task.time_seconds || 0));
  return `<td class="time">${timerMark(task, user)}${shown}${rowTimer(task, user, csrf, back)}</td>`;
}

function taskCard(task, today, user, csrf, back) {
  const overdue = isOverdue(task.due_date, task.status, today);
  const mine = (task.running || []).find((row) => row.user_id === user.id);
  const time = mine
    ? `<span class="timer-live" data-started="${esc(mine.started_at)}"><strong class="timer-elapsed">${esc(formatDuration(entrySeconds(mine.started_at, null)))}</strong></span>`
    : esc(formatDuration(task.time_seconds || 0));
  return `<article class="task-card${overdue ? ' overdue' : ''}${task.justAdded ? ' just-added' : ''}" data-href="/tasks/${task.id}">
    <div class="card-top"><a class="title-link" href="/tasks/${task.id}">${esc(task.title)}</a></div>
    <div class="card-meta">${esc(task.project_name || 'No project')} · ${esc(task.assignee_name || 'Unassigned')}</div>
    <div class="card-row">
      <span class="status status-${esc(task.status)}">${esc(labelOf(STATUSES, task.status))}</span>
      <span class="pri pri-${esc(task.priority || 'none')}">${esc(labelOf(PRIORITIES, task.priority) || '—')}</span>
      <span class="due">${esc(formatDue(task.due_date))}</span>
      <span class="time">${timerMark(task, user)}${time}${rowTimer(task, user, csrf, back)}</span>
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
    <td>${esc(task.assignee_name || '—')}</td>
    <td class="status status-${esc(task.status)}">${esc(labelOf(STATUSES, task.status))}</td>
    <td class="pri pri-${esc(task.priority || 'none')}">${esc(labelOf(PRIORITIES, task.priority) || '—')}</td>
    <td class="due">${esc(formatDue(task.due_date))}</td>
    ${timeCell(task, user, csrf, back)}
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
          <tr class="quick-add"><td colspan="10">
            <form class="quick-form" method="post" action="/tasks">
              <input type="hidden" name="_csrf" value="${esc(csrf)}">
              <input type="hidden" name="quick" value="1">
              <input type="hidden" name="status" value="todo">
              <input name="title" maxlength="200" placeholder="Add a task…" aria-label="Add a task" required>
              <select name="assignee_id" aria-label="Assignee">${options(users.map((person) => [person.id, person.name]), '', 'Assignee')}</select>
              <select name="project_id" aria-label="Project">${options((projects || []).map((project) => [project.id, project.name]), '', 'Project')}</select>
              <input name="due_date" type="date" aria-label="Due date">
              <button class="btn btn-primary" type="submit">Add</button>
            </form>
          </td></tr>
          ${openGroups.map((group) => `
            <tr class="group"><td colspan="10">${esc(group.label)} <span class="group-count">${group.rows.length}</span></td></tr>
            ${group.rows.map((task) => taskRow(task, today, user, csrf, back, highlight)).join('')}
          `).join('')}
          ${doneRows.length ? `<tr class="group"><td colspan="10"><button type="button" class="done-toggle" data-done-toggle aria-expanded="${showDone ? 'true' : 'false'}">Done <span class="group-count">${doneRows.length}</span></button></td></tr>` : ''}
        </tbody>
        ${doneRows.length ? `<tbody class="done-rows"${showDone ? '' : ' hidden'}>${doneRows.map((task) => taskRow(task, today, user, csrf, back, highlight)).join('')}</tbody>` : ''}
      </table></div>
      <div class="cards">${cards || '<div class="panel empty">No open tasks. Add one above.</div>'}</div>`;

  const assigneeOptions = [
    ['', 'All assignees'],
    ['none', 'Unassigned'],
    ...users.map((person) => [String(person.id), person.name]),
  ];
  const selectedAssignee = filters.mine ? '' : (filters.assigneeId === 'none' ? 'none' : (filters.assigneeId || ''));

  const mineDay = day || { open: 0, dueToday: 0, timer: null };
  const body = `
    <section class="myday panel">
      <strong>My day</strong>
      <a href="/?mine=1">${mineDay.open} open</a>
      <a href="/?mine=1&amp;due=today">${mineDay.dueToday} due today</a>
      ${mineDay.timer ? `<a href="/tasks/${mineDay.timer.task_id}">Timer · ${esc(mineDay.timer.title)}</a>` : '<span>No timer running</span>'}
    </section>
    <div class="board-tools">
      <form class="filters" method="get" action="/" data-live>
        <button type="button" class="btn filters-toggle" data-filters-toggle>Filters</button>
        <div class="filters-body">
          <label class="field"><span>Status</span>
            <select name="status">${options(STATUSES, filters.status, 'All statuses')}</select>
          </label>
          <label class="field"><span>Assignee</span>
            <select name="assignee">${options(assigneeOptions, selectedAssignee)}</select>
          </label>
          <label class="field"><span>Project</span>
            <select name="project">${options((projects || []).map((project) => [String(project.id), project.name]), filters.projectId || '', 'All projects')}</select>
          </label>
          <label class="check"><input type="checkbox" name="mine" value="1"${filters.mine ? ' checked' : ''}> <span>My tasks</span></label>
          <label class="check"><input type="checkbox" name="overdue" value="1"${filters.overdue ? ' checked' : ''}> <span>Overdue only</span></label>
          <label class="check"><input type="checkbox" name="mentions" value="1"${filters.mentions ? ' checked' : ''}> <span>Mentions</span></label>
          <label class="field search"><span>Search</span>
            <input type="search" name="q" value="${esc(filters.search || '')}" placeholder="Search tasks">
          </label>
        </div>
        <a class="btn" data-csv href="/export.csv${exportQuery ? `?${esc(exportQuery)}` : ''}">CSV</a>
        <a class="btn" href="/">Clear</a>
      </form>
    </div>
    <form class="quick-form quick-mobile panel" method="post" action="/tasks">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <input type="hidden" name="quick" value="1">
      <input type="hidden" name="status" value="todo">
      <input name="title" maxlength="200" placeholder="Add a task…" aria-label="Add a task" required>
      <button class="btn btn-primary" type="submit">Add</button>
    </form>
    <p class="sort-note">Sorted by due date. Press N for a new task. Overdue tasks are highlighted.</p>
    ${openGroups.length || doneRows.length ? table : '<div class="panel empty">No tasks match these filters.</div>'}
    <dialog id="task-drawer" class="drawer"${openForm ? ' data-open="1"' : ''}>
      <div class="drawer-bar"><h2>New task</h2><button type="button" class="btn" data-close-drawer>Close</button></div>
      ${taskForm({ task: null, users, projects, csrf, canEdit: true, currentUser: user, today, from: 'board' })}
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
      ${summary.perUser.map((person) => `<tr><td>${esc(person.user_name)}</td><td>${esc(formatDuration(person.seconds))}</td></tr>`).join('')}
    </tbody></table>` : '<p class="hint">No time logged yet.</p>'}
    ${entries.length ? `<h2>Entries</h2><ul class="plain">${entries.map((entry) => `<li>${esc(entry.user_name)} · ${esc(formatDateTime(entry.started_at))} – ${entry.ended_at ? esc(formatDateTime(entry.ended_at)) : 'running'} · ${esc(formatDuration(entrySeconds(entry.started_at, entry.ended_at)))}</li>`).join('')}</ul>` : ''}
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

export function renderTask({ user, csrf, msg, task, comments, users, projects, activity = [], attachments = [], grokFiles = [], timer = null, canEdit, canDelete, canComplete, commentPerms, commentKudos, taskKudos, today, toast }) {
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
        <form class="stack" method="post" action="/tasks/${task.id}/comments" enctype="multipart/form-data">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <label class="field"><span>Add a comment</span>
            <textarea name="body" data-mentions rows="3" required maxlength="8000" placeholder="Add a comment. Type @ to mention someone."></textarea>
          </label>
          <label class="field"><span>PDF for Grok</span>
            <input type="file" name="files" accept="application/pdf,.pdf" multiple>
          </label>
          <p class="hint">Up to 5 PDFs, 15 MB each. They are sent only when the comment mentions Grok, and they expire after a day.</p>
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
      <section class="panel pad">
        <div class="title-row"><h1>${esc(title)}</h1>${pageActions}</div>
        ${meta}
        ${taskForm({ task, users, projects, csrf, canEdit: isNew || canEdit, currentUser: user, today })}
      </section>
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
      ${projectScript(projects)}`,
  });
}

export function renderUsers({ user, csrf, msg, users, removed = null }) {
  const superuser = user.role === 'superuser';
  const createRole = superuser
    ? `<label class="field"><span>Role</span><select name="role">${options(ROLES, 'user')}</select></label>`
    : '<p class="hint">New accounts are standard users.</p>';
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
    <section class="panel pad">
      <h1>Users</h1>
      <form class="stack" method="post" action="/users">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <div class="form-grid">
          <label class="field"><span>Name</span><input name="name" required maxlength="120"></label>
          <label class="field"><span>Email</span><input name="email" type="email" required></label>
          <label class="field"><span>Password</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
          ${createRole}
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Create user</button></div>
      </form>
    </section>
    <div class="table-wrap panel">
      <table class="grid users">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Password</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">No users to show.</td></tr>'}</tbody>
      </table>
    </div>
    ${removed ? `<section class="panel pad">
      <h2>Removed</h2>
      ${removed.length ? `<table class="grid"><thead><tr><th>Task</th><th>Created by</th><th>Removed</th><th></th></tr></thead><tbody>
        ${removed.map((task) => `<tr>
          <td>${esc(task.title)}</td>
          <td>${esc(task.creator_name || '—')}</td>
          <td>${esc(formatDateTime(task.deleted_at))}</td>
          <td><form method="post" action="/tasks/${task.id}/restore"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="btn" type="submit">Restore</button></form></td>
        </tr>`).join('')}
      </tbody></table>` : '<p class="hint">No removed tasks.</p>'}
    </section>` : ''}`;

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

export function renderManage({ user, csrf, msg, report, time, projects, users, filters, today }) {
  const rows = [...report.people];
  if (report.unassigned && ((report.unassigned.open_count || 0) + (report.unassigned.overdue_count || 0) + (report.unassigned.done_week || 0)) > 0) {
    rows.push({ name: 'Unassigned', ...report.unassigned });
  }
  const maxOpen = Math.max(1, ...rows.map((person) => person.open_count || 0));
  const bars = rows.map((person) => {
    const width = Math.round(((person.open_count || 0) / maxOpen) * 100);
    return `<div class="bar-row">
      <span class="bar-label">${esc(person.name)}</span>
      <span class="bar" aria-hidden="true"><span style="width:${width}%"></span></span>
      <span class="bar-n">${person.open_count || 0}</span>
    </div>`;
  }).join('');
  const personPairs = [['none', 'Unassigned'], ...users.map((person) => [String(person.id), person.name])];
  const doneList = (rows) => rows.length
    ? `<ul class="plain">${rows.map((task) => `<li><a href="/tasks/${task.id}">${esc(task.title)}</a> <span class="hint">${esc(task.assignee_name || 'Unassigned')} · ${esc(task.project_name || 'No project')} · ${esc(formatDateTime(task.completed_at))}</span></li>`).join('')}</ul>`
    : '<p class="hint">None.</p>';

  const body = `
    <form class="filters panel" method="get" action="/manage">
      <label class="field"><span>Project</span>
        <select name="project">${options((projects || []).map((project) => [String(project.id), project.name]), filters.projectId || '', 'All projects')}</select>
      </label>
      <label class="field"><span>Person</span>
        <select name="person">${options(personPairs, filters.personId || '', 'Everyone')}</select>
      </label>
      <button class="btn" type="submit">Apply</button>
      <a class="btn" href="/manage">Clear</a>
    </form>
    <div class="stats">
      <div class="stat"><span>Open</span><strong>${report.totals.open}</strong></div>
      <div class="stat"><span>Overdue</span><strong>${report.totals.overdue}</strong></div>
      <div class="stat"><span>Done this week</span><strong>${report.totals.doneWeek}</strong></div>
      <div class="stat"><span>Done in 7 days</span><strong>${report.totals.done7}</strong></div>
      <div class="stat"><span>Done in 30 days</span><strong>${report.totals.done30}</strong></div>
      <div class="stat"><span>Avg completed</span><strong>${esc(formatDuration(time?.averageSeconds || 0))}</strong></div>
    </div>
    <section class="panel pad">
      <h2>Time spent</h2>
      <p class="hint">Average is the mean logged time on completed tasks that have a time entry (${time?.completedWithTime || 0} of ${time?.completedCount || 0} completed). A running timer counts up to now.</p>
      <h2>By person</h2>
      ${durationRows(time?.byPerson || [], 'name')}
      <h2>By project</h2>
      ${durationRows(time?.byProject || [], 'name')}
      <h2>By task</h2>
      ${durationRows(time?.byTask || [], 'title')}
    </section>
    <section class="panel pad">
      <h2>Open tasks by person</h2>
      ${bars || '<p class="hint">No people to show.</p>'}
    </section>
    <div class="table-wrap">
      <table class="grid">
        <thead><tr><th>Person</th><th>Open</th><th>Overdue</th><th>Done this week</th></tr></thead>
        <tbody>
          ${rows.map((person) => `<tr>
            <td>${esc(person.name)}</td>
            <td class="num">${person.open_count || 0}</td>
            <td class="num">${person.overdue_count || 0}</td>
            <td class="num">${person.done_week || 0}</td>
          </tr>`).join('') || '<tr><td colspan="4">No rows.</td></tr>'}
        </tbody>
      </table>
    </div>
    <section class="panel pad">
      <h2>Overdue</h2>
      ${report.overdue.length ? `<ul class="plain">${report.overdue.map((task) => `<li><a href="/tasks/${task.id}">${esc(task.title)}</a> <span class="hint">${esc(task.assignee_name || 'Unassigned')} · ${esc(task.project_name || 'No project')} · due ${esc(formatDue(task.due_date))} · ${daysBetween(task.due_date, today)}d</span></li>`).join('')}</ul>` : '<p class="hint">Nothing overdue.</p>'}
    </section>
    <div class="split">
      <section class="panel pad"><h2>Completed in 7 days</h2>${doneList(report.done7)}</section>
      <section class="panel pad"><h2>Completed in 30 days</h2>${doneList(report.done30)}</section>
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
  const body = `
    <div class="cal-nav">
      <a class="btn" href="${view === 'week' ? withKeep({ view: 'week', day: prevWeek }) : withKeep({ month: prevMonth })}">Prev</a>
      <strong>${esc(label)}</strong>
      <a class="btn" href="${view === 'week' ? withKeep({ view: 'week', day: nextWeek }) : withKeep({ month: nextMonth })}">Next</a>
      <a class="btn" href="${withKeep(view === 'week' ? { view: 'week', day: today } : { month: today.slice(0, 7) })}">Today</a>
      <a class="btn${view === 'month' ? ' btn-primary' : ''}" href="${withKeep({ month: `${year}-${String(month).padStart(2, '0')}` })}">Month</a>
      <a class="btn${view === 'week' ? ' btn-primary' : ''}" href="${withKeep({ view: 'week', day: anchor })}">Week</a>
    </div>
    <form class="filters" method="get" action="/calendar" data-live>
      <button type="button" class="btn filters-toggle" data-filters-toggle>Filters</button>
      <div class="filters-body">
        <label class="field"><span>Status</span><select name="status">${options(STATUSES, filters.status, 'All statuses')}</select></label>
        <label class="field"><span>Assignee</span><select name="assignee">${options(assigneeOptions, selectedAssignee)}</select></label>
        <label class="field"><span>Project</span><select name="project">${options(projects.map((project) => [String(project.id), project.name]), filters.projectId || '', 'All projects')}</select></label>
        <label class="check"><input type="checkbox" name="mine" value="1"${filters.mine ? ' checked' : ''}> <span>My tasks</span></label>
        <input type="hidden" name="view" value="${esc(view)}">
        ${view === 'week' ? `<input type="hidden" name="day" value="${esc(anchor)}">` : `<input type="hidden" name="month" value="${year}-${String(month).padStart(2, '0')}">`}
      </div>
      <a class="btn" href="/calendar">Clear</a>
    </form>
    ${grid}
    ${agenda}
    <section class="panel pad"><h2>No due date</h2>
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
    <section class="panel pad">
      <h1>Team</h1>
      <p class="hint">Completed work and tracked hours. On time means the completion day in Johannesburg is on or before the due date. A streak is consecutive days with at least one completion, counting back from today.</p>
    </section>
    <div class="table-wrap">
      <table class="grid">
        <thead><tr><th>Person</th><th>Done this week</th><th>Done this month</th><th>Hours this week</th><th>Hours this month</th><th>On time</th><th>Streak</th></tr></thead>
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
    </div>`;
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
