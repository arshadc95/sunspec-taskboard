import { colorForUser } from './colors.js';
import { dateInJohannesburg, shiftDate, todayDate } from './time.js';
import { coachTips, managerTip } from './coach.js';

function weekStartDate(ymd) {
  const [year, month, day] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return shiftDate(ymd, -((dow + 6) % 7));
}

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

function onTimeRate(tasks) {
  const withDue = tasks.filter((task) => task.due_date);
  if (!withDue.length) return null;
  const ok = withDue.filter((task) => dateInJohannesburg(task.completed_at) <= task.due_date).length;
  return Math.round((ok / withDue.length) * 100);
}

export function buildManage(db, { projectId = null, month = null, sort = 'name', dir = 'asc', now = new Date() } = {}) {
  const today = todayDate(now);
  const nowMs = now.getTime();
  const tasks = db.prepare(`
    SELECT t.id, t.title, t.status, t.due_date, t.project_id, t.created_at, t.completed_at, t.updated_at, t.deleted_at,
           p.name AS project_name
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    ${projectId ? 'WHERE t.project_id = ?' : ''}
  `).all(...(projectId ? [projectId] : []));
  const people = db.prepare('SELECT id, name, color FROM users WHERE active = 1 AND is_bot = 0 ORDER BY name COLLATE NOCASE').all()
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
    const withDue = done.filter((task) => task.due_date);
    const onTime = withDue.filter((task) => dateInJohannesburg(task.completed_at) <= task.due_date);
    const cycles = done.map((task) => (Date.parse(task.completed_at) - Date.parse(task.created_at)) / 86400000).filter((value) => value >= 0);
    return {
      id: person.id,
      name: person.name,
      color: person.color,
      assigned: open.length,
      overdue: open.filter((task) => task.due_date && task.due_date < today).length,
      done: done.length,
      onTimePct: withDue.length ? Math.round((onTime.length / withDue.length) * 100) : null,
      avgDays: round1(mean(cycles)),
      inProgress: mine.filter((task) => task.status === 'in_progress').length,
    };
  }).filter((person) => person.assigned > 0 || person.done > 0);

  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name),
    assigned: (a, b) => a.assigned - b.assigned,
    done: (a, b) => a.done - b.done,
    ontime: (a, b) => (a.onTimePct ?? -1) - (b.onTimePct ?? -1),
    avg: (a, b) => (a.avgDays ?? 9999) - (b.avgDays ?? 9999),
    overdue: (a, b) => a.overdue - b.overdue,
  };
  const sortedPeople = [...personStats].sort((a, b) => {
    const cmp = (sorters[sort] || sorters.name)(a, b);
    const signed = dir === 'desc' ? -cmp : cmp;
    return signed || a.name.localeCompare(b.name);
  });

  const openNow = live.filter((task) => task.status !== 'done');
  const overdueNow = openNow.filter((task) => task.due_date && task.due_date < today);
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
    sparkOver.push(sample.filter((task) => task.due_date && task.due_date < todayDate(new Date(to))).length);
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
      if (Date.parse(task.created_at) > endMs) continue;
      if (task.deleted_at && Date.parse(task.deleted_at) <= endMs) continue;
      const rows = hist.get(task.id) || [];
      let status = task.status;
      for (const row of rows) {
        if (Date.parse(row.changed_at) <= endMs) status = row.status;
        else break;
      }
      if (status === 'done' && task.completed_at && Date.parse(task.completed_at) > endMs) {
        const earlier = [...rows].reverse().find((row) => row.status !== 'done' && Date.parse(row.changed_at) <= endMs);
        status = earlier ? earlier.status : 'todo';
      }
      if (counts[status] != null) counts[status] += 1;
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

  const heatWeeks = slots.map((slot) => slot.label.slice(3));
  const heatRows = sortedPeople.map((person) => ({ name: person.name, color: person.color, cells: [] }));
  let heatMax = 1;
  slots.forEach((slot, slotIndex) => {
    sortedPeople.forEach((person, index) => {
      const count = live.filter((task) => task.status === 'done' && task.completed_at && Date.parse(task.completed_at) >= slot.from && Date.parse(task.completed_at) < slot.to && (assignees.get(task.id) || []).includes(person.id)).length;
      heatRows[index].cells[slotIndex] = count;
      if (count > heatMax) heatMax = count;
    });
  });

  const backlog = slots.map((slot) => ({ label: slot.label, open: openAt(slot.to).length }));

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
    attention.push({ id: task.id, title: task.title, owners: [], note: 'unassigned' });
  }

  const projectRows = db.prepare('SELECT id, name FROM projects ORDER BY name COLLATE NOCASE').all().map((project) => {
    const mine = live.filter((task) => task.project_id === project.id);
    const open = mine.filter((task) => task.status !== 'done');
    const done = mine.filter((task) => task.status === 'done' && task.completed_at && Date.parse(task.completed_at) >= periodStart && Date.parse(task.completed_at) < periodEnd);
    const seconds = entries.filter((row) => row.project_id === project.id).reduce((sum, row) => sum + overlapSeconds(row.started_at, row.ended_at, periodStart, nowMs), 0);
    return { name: project.name, open: open.length, overdue: open.filter((task) => task.due_date && task.due_date < today).length, done: done.length, seconds };
  }).filter((row) => row.open || row.overdue || row.done || row.seconds);

  const reviewStuck = live.filter((task) => task.status === 'review').filter((task) => {
    const rows = hist.get(task.id) || [];
    const entered = [...rows].reverse().find((row) => row.status === 'review');
    return nowMs - Date.parse(entered?.changed_at || task.created_at) > 3 * 86400000;
  }).length;
  const staleProgress = live.filter((task) => task.status === 'in_progress' && Date.parse(task.updated_at) < nowMs - 7 * 86400000).map((task) => ({
    id: task.id,
    title: task.title,
    owner: names.get((assignees.get(task.id) || [])[0]) || 'someone',
    days: Math.max(1, Math.floor((nowMs - Date.parse(task.updated_at)) / 86400000)),
  }));
  const weekStartMs = Date.parse(`${weekStartDate(today)}T00:00:00+02:00`);
  const onTimeWeek = live.filter((task) => task.status === 'done' && task.due_date && task.completed_at && Date.parse(task.completed_at) >= weekStartMs && dateInJohannesburg(task.completed_at) <= task.due_date).length;
  const finisher = [...personStats].sort((a, b) => b.done - a.done)[0];
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
      overdue: live.filter((task) => Date.parse(task.created_at) < span.end && (!task.completed_at || Date.parse(task.completed_at) >= span.end) && task.due_date && task.due_date < asOf).length,
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
    sort,
    dir,
    projectId,
    people: sortedPeople,
    kpis: {
      open: openNow.length,
      openPrev: openThen.length,
      done: donePeriod.length,
      donePrev: donePrev.length,
      overdue: overdueNow.length,
      overduePrev: openThen.filter((task) => task.due_date && task.due_date < todayDate(new Date(periodStart))).length,
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
    heatmap: { weeks: heatWeeks, rows: heatRows, max: heatMax },
    backlog,
    attention: attention.slice(0, 12),
    projects: projectRows,
    tips: coachTips({
      periodDays: Math.max(1, Math.ceil(spanMs / 86400000)),
      historyDays: Math.max(1, Math.ceil(spanMs / 86400000)),
      open: openNow.length,
      people: personStats.map((person) => ({ ...person, open: person.assigned })),
      reviewStuck,
      staleProgress,
      noDue: openNow.filter((task) => !task.due_date).length,
      unassigned: openNow.filter((task) => !(assignees.get(task.id) || []).length).length,
      unassignedNew: openNow.filter((task) => !(assignees.get(task.id) || []).length && Date.parse(task.created_at) >= periodStart).length,
      donePeriod: donePeriod.length,
      donePrevious: donePrev.length,
      overdueNow: overdueNow.length,
      overdueStart: openThen.filter((task) => task.due_date && task.due_date < todayDate(new Date(periodStart))).length,
      onTimeWeek,
      topFinisher: finisher && finisher.done >= 3 ? { name: finisher.name, done: finisher.done } : null,
    }),
    hasReview: live.some((task) => task.status === 'review'),
    managerTip: managerTip(now, { review: live.some((task) => task.status === 'review') }),
  };
}
