import { colorForUser } from './colors.js';
import { countsAsOverdue, countsForOnTime, dateInJohannesburg, shiftDate, todayDate } from './time.js';
import { coachTips } from './coach.js';

function overlapSeconds(started, ended, fromMs, toMs) {
  const start = Date.parse(started);
  const end = ended ? Date.parse(ended) : toMs;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((Math.min(end, toMs) - Math.max(start, fromMs)) / 1000));
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function round1(value) {
  return value == null ? null : Math.round(value * 10) / 10;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function addMonths(ym, count) {
  const [year, month] = ym.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(ym) {
  const month = Number(ym.slice(5, 7));
  return `${MONTHS[month - 1]} ${ym.slice(0, 4)}`;
}

export function monthTitle(ym) {
  const month = Number(ym.slice(5, 7));
  return `${MONTHS_LONG[month - 1]} ${ym.slice(0, 4)}`;
}

export function clampMonth(requested, firstYmd, todayYmd) {
  const current = todayYmd.slice(0, 7);
  const first = (firstYmd || todayYmd).slice(0, 7);
  const floor = first <= current ? first : current;
  let ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested || '') ? requested : current;
  if (ym > current) ym = current;
  if (ym < floor) ym = floor;
  return {
    ym,
    prev: addMonths(ym, -1),
    next: addMonths(ym, 1),
    canPrev: ym > floor,
    canNext: ym < current,
    title: monthTitle(ym),
  };
}

export function monthSpan(ym, now = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return null;
  const start = Date.parse(`${ym}-01T00:00:00+02:00`);
  const nextStart = Date.parse(`${addMonths(ym, 1)}-01T00:00:00+02:00`);
  const current = todayDate(now).slice(0, 7) === ym;
  return {
    ym,
    start,
    end: current ? now.getTime() + 1 : nextStart,
    prev: addMonths(ym, -1),
    label: monthLabel(ym),
    current,
  };
}

export function taskStatusAt(task, rows, endMs) {
  const created = Date.parse(task.created_at);
  if (!Number.isFinite(created) || created > endMs) return null;
  if (task.deleted_at && Date.parse(task.deleted_at) <= endMs) return null;
  const completed = task.completed_at ? Date.parse(task.completed_at) : null;
  if (completed && completed <= endMs) return 'done';
  const known = (rows || []).filter((row) => {
    const at = Date.parse(row.changed_at);
    return Number.isFinite(at) && at <= endMs;
  });
  if (!known.length) return 'todo';
  let status = known[known.length - 1].status;
  if (status === 'done') {
    const earlier = [...known].reverse().find((row) => row.status !== 'done');
    status = earlier ? earlier.status : 'todo';
  }
  return status === 'in_progress' || status === 'review' ? status : 'todo';
}

function onTimeRate(tasks) {
  const withDue = tasks.filter((task) => countsForOnTime(task));
  if (!withDue.length) return null;
  const ok = withDue.filter((task) => dateInJohannesburg(task.completed_at) <= task.due_date).length;
  return Math.round((ok / withDue.length) * 100);
}

export function buildManage(db, { projectId = null, month = null, now = new Date() } = {}) {
  const today = todayDate(now);
  const nowMs = now.getTime();
  const tasks = db.prepare(`
    SELECT t.id, t.title, t.status, t.due_date, t.waiting_on, t.external_delay, t.push_count, t.project_id, t.created_at, t.completed_at, t.updated_at, t.deleted_at,
           p.name AS project_name
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    ${projectId ? 'WHERE t.project_id = ?' : ''}
  `).all(...(projectId ? [projectId] : []));
  const people = db.prepare('SELECT id, name, role, color FROM users WHERE active = 1 AND is_bot = 0 ORDER BY name COLLATE NOCASE').all()
    .map((person) => ({ ...person, color: colorForUser(person.id, person.color) }));
  const links = db.prepare('SELECT task_id, user_id FROM task_assignees').all();
  const history = db.prepare('SELECT task_id, status, changed_at FROM task_status_history ORDER BY changed_at, id').all();
  const entries = db.prepare(`
    SELECT te.started_at, te.ended_at, t.project_id
    FROM time_entries te JOIN tasks t ON t.id = te.task_id
  `).all().filter((row) => !projectId || row.project_id === projectId);

  const assignees = new Map();
  for (const link of links) {
    if (!assignees.has(link.task_id)) assignees.set(link.task_id, []);
    assignees.get(link.task_id).push(link.user_id);
  }
  const hist = new Map();
  for (const row of history) {
    if (!hist.has(row.task_id)) hist.set(row.task_id, []);
    hist.get(row.task_id).push(row);
  }
  const live = tasks.filter((task) => !task.deleted_at);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const colors = new Map(people.map((person) => [person.id, person.color]));
  const firstStamp = live.reduce((min, task) => {
    const at = Date.parse(task.created_at);
    return Number.isFinite(at) ? Math.min(min, at) : min;
  }, Infinity);
  const firstYmd = Number.isFinite(firstStamp) ? dateInJohannesburg(new Date(firstStamp)) : today;
  const picked = clampMonth(month, firstYmd, today);
  const monthWindow = monthSpan(picked.ym, now);
  const periodStart = monthWindow.start;
  const periodEnd = monthWindow.end;
  const previous = monthSpan(monthWindow.prev, new Date(monthWindow.start - 1));
  const prevStart = previous.start;
  const prevEnd = previous.end;
  const compare = 'vs last month';

  function openAt(ms) {
    return live.filter((task) => Date.parse(task.created_at) <= ms && (!task.completed_at || Date.parse(task.completed_at) > ms));
  }

  const personStats = people.map((person) => {
    const mine = live.filter((task) => (assignees.get(task.id) || []).includes(person.id));
    const open = mine.filter((task) => task.status !== 'done');
    const done = mine.filter((task) => task.status === 'done' && task.completed_at && Date.parse(task.completed_at) >= periodStart && Date.parse(task.completed_at) < periodEnd);
    const withDue = done.filter((task) => countsForOnTime(task));
    const onTime = withDue.filter((task) => dateInJohannesburg(task.completed_at) <= task.due_date);
    const cycles = done.map((task) => (Date.parse(task.completed_at) - Date.parse(task.created_at)) / 86400000).filter((value) => value >= 0);
    return {
      id: person.id,
      name: person.name,
      color: person.color,
      assigned: open.length,
      overdue: open.filter((task) => countsAsOverdue(task, today)).length,
      done: done.length,
      onTimePct: withDue.length ? Math.round((onTime.length / withDue.length) * 100) : null,
      avgDays: round1(mean(cycles)),
      inProgress: mine.filter((task) => task.status === 'in_progress').length,
    };
  });

  const sortedPeople = [...personStats].sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));

  const openNow = live.filter((task) => task.status !== 'done');
  const overdueNow = openNow.filter((task) => countsAsOverdue(task, today));
  const doneIn = (from, to) => live.filter((task) => task.status === 'done' && task.completed_at && Date.parse(task.completed_at) >= from && Date.parse(task.completed_at) < to);
  const donePeriod = doneIn(periodStart, periodEnd);
  const donePrev = doneIn(prevStart, prevEnd);
  const cycles = donePeriod.map((task) => (Date.parse(task.completed_at) - Date.parse(task.created_at)) / 86400000).filter((value) => value >= 0);
  const prevCycles = donePrev.map((task) => (Date.parse(task.completed_at) - Date.parse(task.created_at)) / 86400000).filter((value) => value >= 0);
  const openThen = openAt(periodStart);

  const spanMs = Math.max(1, periodEnd - periodStart);
  const sparkOpen = [];
  const sparkDone = [];
  const sparkOver = [];
  const sparkCycle = [];
  for (let i = 0; i < 8; i += 1) {
    const from = periodStart + (spanMs * i) / 8;
    const to = periodStart + (spanMs * (i + 1)) / 8;
    const sample = openAt(to);
    sparkOpen.push(sample.length);
    sparkOver.push(sample.filter((task) => countsAsOverdue(task, todayDate(new Date(to)))).length);
    const finished = doneIn(from, to);
    sparkDone.push(finished.length);
    sparkCycle.push(finished.length ? round1(mean(finished.map((task) => (Date.parse(task.completed_at) - Date.parse(task.created_at)) / 86400000))) : null);
  }

  const startYmd = dateInJohannesburg(new Date(periodStart));
  const lastYmd = dateInJohannesburg(new Date(periodEnd - 1));
  const slots = [];
  for (let day = startYmd; day <= lastYmd; day = shiftDate(day, 1)) {
    const from = Date.parse(`${day}T00:00:00+02:00`);
    const to = Math.min(periodEnd, Date.parse(`${shiftDate(day, 1)}T00:00:00+02:00`));
    slots.push({ label: day.slice(5), from, to });
  }

  const throughput = slots.map((slot) => ({
    label: slot.label,
    created: live.filter((task) => Date.parse(task.created_at) >= slot.from && Date.parse(task.created_at) < slot.to).length,
    completed: live.filter((task) => task.completed_at && Date.parse(task.completed_at) >= slot.from && Date.parse(task.completed_at) < slot.to).length,
  }));

  const cfd = { days: [], todo: [], in_progress: [], review: [], done: [] };
  for (const slot of slots) {
    const endMs = slot.to - 1;
    const counts = { todo: 0, in_progress: 0, review: 0, done: 0 };
    for (const task of tasks) {
      const status = taskStatusAt(task, hist.get(task.id) || [], endMs);
      if (status && counts[status] != null) counts[status] += 1;
    }
    cfd.days.push(slot.label);
    for (const key of Object.keys(counts)) cfd[key].push(counts[key]);
  }

  const points = [];
  for (const task of donePeriod) {
    const cycle = (Date.parse(task.completed_at) - Date.parse(task.created_at)) / 86400000;
    if (cycle >= 0) points.push({ date: dateInJohannesburg(task.completed_at), days: round1(cycle), title: task.title });
  }
  const sortedCycles = [...cycles].sort((a, b) => a - b);
  const p85 = round1(percentile(sortedCycles, 0.85));

  const weekdayName = (ymd) => {
    const [year, month, day] = ymd.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 10));
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Johannesburg', weekday: 'short' }).format(date);
  };
  const monthName = (ymd) => {
    const [year, month, day] = ymd.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 10));
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', month: 'short' }).format(date);
  };
  const letters = { Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'T', Fri: 'F', Sat: 'S', Sun: 'S' };
  const [heatYear, heatMonth] = picked.ym.split('-').map(Number);
  const heatLength = new Date(Date.UTC(heatYear, heatMonth, 0)).getUTCDate();
  const heatDays = [];
  for (let day = 1; day <= heatLength; day += 1) {
    const ymd = `${picked.ym}-${String(day).padStart(2, '0')}`;
    const name = weekdayName(ymd);
    heatDays.push({
      label: String(day).padStart(2, '0'),
      weekday: letters[name] || '',
      weekend: name === 'Sat' || name === 'Sun',
      future: ymd > today,
      today: ymd === today,
      when: `${name} ${day} ${monthName(ymd)}`,
    });
  }
  const heatRows = sortedPeople.map((person) => ({ name: person.name, color: person.color, cells: [] }));
  let heatMax = 1;
  heatDays.forEach((day, dayIndex) => {
    const ymd = `${picked.ym}-${day.label}`;
    const endMs = Date.parse(`${shiftDate(ymd, 1)}T00:00:00+02:00`) - 1;
    sortedPeople.forEach((person, index) => {
      if (day.future) {
        heatRows[index].cells[dayIndex] = { open: 0, done: 0 };
        return;
      }
      const open = tasks.filter((task) => {
        if (!(assignees.get(task.id) || []).includes(person.id)) return false;
        const status = taskStatusAt(task, hist.get(task.id) || [], endMs);
        return status && status !== 'done';
      }).length;
      const done = live.filter((task) => task.completed_at && dateInJohannesburg(task.completed_at) === ymd && (assignees.get(task.id) || []).includes(person.id)).length;
      heatRows[index].cells[dayIndex] = { open, done };
      if (open > heatMax) heatMax = open;
    });
  });

  const backlog = slots.map((slot) => ({
    label: slot.label,
    open: tasks.filter((task) => {
      const status = taskStatusAt(task, hist.get(task.id) || [], slot.to - 1);
      return status && status !== 'done';
    }).length,
  }));

  const attention = [];
  for (const task of overdueNow.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))) {
    const owners = (assignees.get(task.id) || []).map((id) => ({ id, name: names.get(id), color: colors.get(id) })).filter((person) => person.name);
    attention.push({ id: task.id, title: task.title, owners, note: 'overdue' });
    if (attention.length >= 8) break;
  }
  for (const task of live.filter((item) => item.status === 'review')) {
    if (attention.length >= 12) break;
    const rows = hist.get(task.id) || [];
    const entered = [...rows].reverse().find((row) => row.status === 'review');
    const at = Date.parse(entered?.changed_at || task.created_at);
    if (nowMs - at <= 3 * 86400000) continue;
    const owners = (assignees.get(task.id) || []).map((id) => ({ id, name: names.get(id), color: colors.get(id) })).filter((person) => person.name);
    attention.push({ id: task.id, title: task.title, owners, note: 'in review more than 3 days' });
  }
  for (const task of openNow.filter((item) => !(assignees.get(item.id) || []).length)) {
    if (attention.some((item) => item.id === task.id) || attention.length >= 16) continue;
    attention.push({ id: task.id, title: task.title, owners: [], note: 'unassigned', pushCount: Number(task.push_count) || 0 });
  }
  for (const item of attention) {
    const task = live.find((row) => row.id === item.id);
    if (task) item.pushCount = Number(task.push_count) || 0;
  }
  for (const task of openNow.filter((item) => Number(item.push_count) >= 1)) {
    if (attention.some((item) => item.id === task.id) || attention.length >= 16) continue;
    const owners = (assignees.get(task.id) || []).map((id) => ({ id, name: names.get(id), color: colors.get(id) })).filter((person) => person.name);
    attention.push({ id: task.id, title: task.title, owners, note: 'pushed', pushCount: Number(task.push_count) || 0 });
  }

  const projectRows = db.prepare('SELECT id, name FROM projects ORDER BY name COLLATE NOCASE').all().map((project) => {
    const mine = live.filter((task) => task.project_id === project.id);
    const open = mine.filter((task) => task.status !== 'done');
    const done = mine.filter((task) => task.status === 'done' && task.completed_at && Date.parse(task.completed_at) >= periodStart && Date.parse(task.completed_at) < periodEnd);
    const seconds = entries.filter((row) => row.project_id === project.id).reduce((sum, row) => sum + overlapSeconds(row.started_at, row.ended_at, periodStart, nowMs), 0);
    return { name: project.name, open: open.length, overdue: open.filter((task) => countsAsOverdue(task, today)).length, done: done.length, seconds };
  }).filter((row) => row.open || row.overdue || row.done || row.seconds);

  const reviewStuck = live.filter((task) => task.status === 'review').filter((task) => {
    const rows = hist.get(task.id) || [];
    const entered = [...rows].reverse().find((row) => row.status === 'review');
    return nowMs - Date.parse(entered?.changed_at || task.created_at) > 3 * 86400000;
  }).length;
  const asOf = monthWindow.current ? today : dateInJohannesburg(new Date(periodEnd - 1));
  const asOfMs = monthWindow.current ? nowMs : Date.parse(`${asOf}T23:59:59+02:00`);
  function statusAt(task) {
    const rows = (hist.get(task.id) || []).filter((row) => Date.parse(row.changed_at) <= asOfMs);
    if (rows.length) return rows[rows.length - 1].status;
    return task.status;
  }
  const openScope = live.filter((task) => Date.parse(task.created_at) <= asOfMs && statusAt(task) !== 'done');
  const ownersOf = (task) => assignees.get(task.id) || [];
  const tipPeople = people.filter((person) => person.role === 'user' || person.role === 'admin').map((person) => {
    const mine = openScope.filter((task) => ownersOf(task).includes(person.id));
    return {
      id: person.id,
      name: person.name,
      role: person.role,
      open: mine.length,
      overdue: mine.filter((task) => countsAsOverdue(task, asOf)).length,
    };
  });
  const soonEnd = shiftDate(asOf, 3);
  const dueSoon = openScope.filter((task) => statusAt(task) === 'todo' && task.due_date && task.due_date >= asOf && task.due_date <= soonEnd).length;
  const staleCount = openScope.filter((task) => statusAt(task) === 'in_progress' && Date.parse(task.updated_at) <= asOfMs - 7 * 86400000).length;
  const reviewUsed = live.some((task) => task.status === 'review' || (hist.get(task.id) || []).some((row) => row.status === 'review'));
  const reviewWaiting = openScope.filter((task) => {
    if (statusAt(task) !== 'review') return false;
    const rows = hist.get(task.id) || [];
    const entered = [...rows].reverse().find((row) => row.status === 'review' && Date.parse(row.changed_at) <= asOfMs);
    return asOfMs - Date.parse(entered?.changed_at || task.created_at) > 2 * 86400000;
  }).length;
  const recentAssign = new Set(db.prepare(`
    SELECT task_id FROM activity
    WHERE action = 'assignee' AND created_at >= ? AND created_at < ?
  `).all(new Date(periodStart).toISOString(), new Date(periodEnd).toISOString()).map((row) => row.task_id));
  const projectTips = [];
  const seenProjects = new Map();
  for (const task of openScope) {
    if (!task.project_id) continue;
    if (!seenProjects.has(task.project_id)) seenProjects.set(task.project_id, { id: task.project_id, name: task.project_name, open: 0, assignedRecently: false });
    const row = seenProjects.get(task.project_id);
    row.open += 1;
  }
  for (const row of seenProjects.values()) {
    const mine = live.filter((task) => task.project_id === row.id);
    row.assignedRecently = mine.some((task) => recentAssign.has(task.id) || (
      Date.parse(task.created_at) >= periodStart
      && Date.parse(task.created_at) < periodEnd
      && ownersOf(task).length > 0
    ));
    projectTips.push(row);
  }
  const monthRows = [];
  let monthCursor = today.slice(0, 7);
  for (let i = 0; i < 6; i += 1) {
    const span = monthSpan(monthCursor, now);
    const asOf = span.current ? today : dateInJohannesburg(new Date(span.end));
    const finished = doneIn(span.start, span.end);
    monthRows.push({
      label: span.label,
      created: live.filter((task) => Date.parse(task.created_at) >= span.start && Date.parse(task.created_at) < span.end).length,
      done: finished.length,
      overdue: live.filter((task) => Date.parse(task.created_at) < span.end && (!task.completed_at || Date.parse(task.completed_at) >= span.end) && countsAsOverdue(task, asOf)).length,
      avg: round1(mean(finished.map((task) => (Date.parse(task.completed_at) - Date.parse(task.created_at)) / 86400000).filter((value) => value >= 0))),
    });
    monthCursor = addMonths(monthCursor, -1);
  }

  return {
    periodDays: Math.max(1, Math.ceil(spanMs / 86400000)),
    month: picked.ym,
    monthTitle: picked.title,
    prevMonth: picked.prev,
    nextMonth: picked.next,
    canPrev: picked.canPrev,
    canNext: picked.canNext,
    compare,
    bucket: 'day',
    monthRows,
    sort: 'assigned',
    dir: 'desc',
    projectId,
    people: sortedPeople,
    kpis: {
      open: openNow.length,
      openPrev: openThen.length,
      done: donePeriod.length,
      donePrev: donePrev.length,
      overdue: overdueNow.length,
      overduePrev: openThen.filter((task) => countsAsOverdue(task, todayDate(new Date(periodStart)))).length,
      avg: round1(mean(cycles)),
      avgPrev: round1(mean(prevCycles)),
      sparkOpen,
      sparkDone,
      sparkOver,
      sparkCycle,
    },
    throughput,
    cfd,
    cycle: { p85, points },
    heatmap: { days: heatDays, rows: heatRows, max: heatMax },
    backlog,
    attention: attention.slice(0, 12),
    projects: projectRows,
    tips: coachTips({
      open: openScope.length,
      people: tipPeople,
      unassigned: openScope.filter((task) => !ownersOf(task).length).length,
      dueSoon,
      stale: staleCount,
      reviewUsed,
      reviewWaiting,
      noDue: openScope.filter((task) => !task.due_date).length,
      projects: projectTips,
    }),
    hasReview: live.some((task) => task.status === 'review'),
  };
}
