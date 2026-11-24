import { PRIORITIES, ROLES, STATUSES, labelOf } from './constants.js';
import { formatDateTime, formatDue, isOverdue } from './time.js';

const ICONS = {
  tasks: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

const BAD_MSGS = new Set(['badlogin', 'ratelimit', 'invalid', 'forbidden', 'email', 'lastsuper', 'short']);

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
    created: 'Task created.',
    commented: 'Comment added.',
    deleted: 'Deleted.',
    invalid: 'Check the form and try again.',
    forbidden: 'You do not have access to that.',
    email: 'That email is already in use.',
    lastsuper: 'The last active superuser cannot be demoted or deactivated.',
    short: 'Passwords must be at least 8 characters.',
  }[msg];
  if (!text) return '';
  return `<div class="banner ${BAD_MSGS.has(msg) ? 'bad' : 'ok'}">${esc(text)}</div>`;
}

function roleBadge(role) {
  const label = labelOf(ROLES, role) || role;
  return `<span class="badge role-${esc(role)}">${esc(label)}</span>`;
}

function navLink(href, icon, label, active) {
  return `<a class="nav-link${active === icon ? ' active' : ''}" href="${href}" title="${esc(label)}" aria-label="${esc(label)}">${ICONS[icon]}<span class="nav-label">${esc(label)}</span></a>`;
}

function layout({ title, user, active, crumb, actions = '', body, csrf, msg }) {
  const staff = user.role === 'superuser' || user.role === 'admin';
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
      ${body}
      <p class="tz">Times shown in Africa/Johannesburg.</p>
    </div>
  </div>
</div>`);
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

function taskForm({ task, users, csrf, canEdit }) {
  const value = task || {};
  const assigneePairs = users.map((user) => [user.id, user.active ? user.name : `${user.name} (inactive)`]);
  const fields = `
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <label class="field"><span>Title</span>
      <input name="title" required maxlength="200" value="${esc(value.title || '')}" ${canEdit ? '' : 'disabled'}>
    </label>
    <label class="field"><span>Description</span>
      <textarea name="description" rows="5" maxlength="20000" ${canEdit ? '' : 'disabled'}>${esc(value.description || '')}</textarea>
    </label>
    <div class="form-grid">
      <label class="field"><span>Assignee</span>
        <select name="assignee_id" ${canEdit ? '' : 'disabled'}>
          ${options(assigneePairs, value.assignee_id ?? '', 'Unassigned')}
        </select>
      </label>
      <label class="field"><span>Status</span>
        <select name="status" ${canEdit ? '' : 'disabled'}>
          ${options(STATUSES, value.status || 'todo')}
        </select>
      </label>
      <label class="field"><span>Priority</span>
        <select name="priority" ${canEdit ? '' : 'disabled'}>
          ${options(PRIORITIES, value.priority || '', 'None')}
        </select>
      </label>
      <label class="field"><span>Due date</span>
        <input name="due_date" type="date" value="${esc(value.due_date || '')}" ${canEdit ? '' : 'disabled'}>
      </label>
    </div>
    ${canEdit ? '<div class="form-actions"><button class="btn btn-primary" type="submit">Save</button></div>' : ''}
  `;
  if (!canEdit) return `<div class="stack">${fields}</div>`;
  const action = task?.id ? `/tasks/${task.id}` : '/tasks';
  return `<form class="stack" method="post" action="${action}">${fields}</form>`;
}

export function renderBoard({ user, csrf, msg, tasks, filters, users, counts, today }) {
  const groups = STATUSES.map(([status, label]) => ({
    status,
    label,
    rows: tasks.filter((task) => task.status === status),
  })).filter((group) => group.rows.length);
  const table = groups.length
    ? `<div class="table-wrap"><table class="grid">
        <thead><tr>
          <th>Task</th><th>Assignee</th><th>Status</th><th>Priority</th><th>Due</th><th>Comments</th><th>Updated</th>
        </tr></thead>
        <tbody>
          ${groups.map((group) => `
            <tr class="group"><td colspan="7">${esc(group.label)} <span class="group-count">${group.rows.length}</span></td></tr>
            ${group.rows.map((task) => {
              const overdue = isOverdue(task.due_date, task.status, today);
              return `<tr class="${overdue ? 'overdue' : ''}">
                <td><a class="title-link" href="/tasks/${task.id}">${esc(task.title)}</a></td>
                <td>${esc(task.assignee_name || '—')}</td>
                <td class="status status-${esc(task.status)}">${esc(labelOf(STATUSES, task.status))}</td>
                <td class="pri pri-${esc(task.priority || 'none')}">${esc(labelOf(PRIORITIES, task.priority) || '—')}</td>
                <td class="due">${esc(formatDue(task.due_date))}</td>
                <td class="num">${task.comment_count}</td>
                <td class="when">${esc(formatDateTime(task.updated_at))}</td>
              </tr>`;
            }).join('')}
          `).join('')}
        </tbody>
      </table></div>`
    : '<div class="panel empty">No tasks match these filters.</div>';

  const assigneeOptions = [
    ['', 'All assignees'],
    ['none', 'Unassigned'],
    ...users.map((person) => [String(person.id), person.name]),
  ];
  const selectedAssignee = filters.mine ? '' : (filters.assigneeId === 'none' ? 'none' : (filters.assigneeId || ''));

  const body = `
    <form class="filters panel" method="get" action="/">
      <label class="field"><span>Status</span>
        <select name="status">${options(STATUSES, filters.status, 'All statuses')}</select>
      </label>
      <label class="field"><span>Assignee</span>
        <select name="assignee">${options(assigneeOptions, selectedAssignee)}</select>
      </label>
      <label class="check"><input type="checkbox" name="mine" value="1"${filters.mine ? ' checked' : ''}> My tasks</label>
      <label class="check"><input type="checkbox" name="overdue" value="1"${filters.overdue ? ' checked' : ''}> Overdue only</label>
      <label class="field search"><span>Search</span>
        <input type="search" name="q" value="${esc(filters.search || '')}" placeholder="Search tasks…">
      </label>
      <button class="btn" type="submit">Apply</button>
      <a class="btn" href="/">Clear</a>
    </form>
    <p class="sort-note">Sorted by due date. Overdue tasks (due before today and not Done) are highlighted.</p>
    ${table}`;

  return layout({
    title: 'Tasks · Sunspec',
    user,
    csrf,
    msg,
    active: 'tasks',
    crumb: `<span>Tasks</span> <span class="count-pill">${counts.open}</span> <span class="crumb-meta">${counts.overdue} overdue</span>`,
    actions: '<a class="btn-on-orange" href="/tasks/new">New task</a>',
    body,
  });
}

export function renderTask({ user, csrf, msg, task, comments, users, canEdit, canDelete, commentPerms }) {
  const isNew = !task?.id;
  const title = isNew ? 'New task' : task.title;
  const meta = !isNew
    ? `<p class="meta">Created by ${esc(task.creator_name || 'Unknown')} · ${esc(formatDateTime(task.created_at))} · Updated ${esc(formatDateTime(task.updated_at))}</p>`
    : '';
  const deleteForm = !isNew && canDelete
    ? `<form method="post" action="/tasks/${task.id}/delete" data-confirm="Delete this task and its comments?">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <button class="btn btn-danger" type="submit">Delete task</button>
      </form>`
    : '';
  const commentBlock = isNew
    ? ''
    : `<section class="panel pad">
        <h2>Comments <span class="group-count">${comments.length}</span></h2>
        ${comments.length ? comments.map((comment) => `
          <article class="comment">
            <header><strong>${esc(comment.author_name)}</strong> <time>${esc(formatDateTime(comment.created_at))}</time></header>
            <div class="comment-body">${textBlock(comment.body)}</div>
            ${commentPerms.get(comment.id) ? `<form method="post" action="/comments/${comment.id}/delete">
              <input type="hidden" name="_csrf" value="${esc(csrf)}">
              <button class="btn btn-tiny" type="submit">Delete</button>
            </form>` : ''}
          </article>
        `).join('') : '<p class="hint">No comments yet.</p>'}
        <form class="stack" method="post" action="/tasks/${task.id}/comments">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <label class="field"><span>Add a comment</span>
            <textarea name="body" rows="3" required maxlength="8000"></textarea>
          </label>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Comment</button></div>
        </form>
      </section>`;

  return layout({
    title: `${title} · Sunspec`,
    user,
    csrf,
    msg,
    active: 'tasks',
    crumb: `<a href="/">Tasks</a> <span class="sep">›</span> <span class="crumb-current">${esc(title)}</span>`,
    body: `
      <section class="panel pad">
        <h1>${esc(title)}</h1>
        ${meta}
        ${taskForm({ task, users, csrf, canEdit: isNew || canEdit })}
        ${deleteForm}
      </section>
      ${commentBlock}`,
  });
}

export function renderUsers({ user, csrf, msg, users }) {
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
    </div>`;

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
