const TZ = 'Africa/Johannesburg';

export function todayDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function formatDue(ymd) {
  if (!ymd) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function isValidDate(ymd) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isOverdue(due, status, today = todayDate()) {
  return Boolean(due) && status !== 'done' && due < today;
}

export function startOfWeekIso(now = new Date()) {
  const today = todayDate(now);
  const [year, month, day] = today.split('-').map(Number);
  const midnight = new Date(Date.UTC(year, month - 1, day, -2, 0, 0));
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(midnight);
  const offset = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] || 0;
  return new Date(midnight.getTime() - offset * 86400000).toISOString();
}

export function daysAgoIso(days, now = new Date()) {
  return new Date(now.getTime() - days * 86400000).toISOString();
}

export function daysBetween(due, today) {
  const [year, month, day] = due.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const a = Date.UTC(year, month - 1, day);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
}
