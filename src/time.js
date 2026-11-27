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

export function shiftDate(ymd, days) {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateInJohannesburg(iso, nowFallback) {
  const date = iso ? new Date(iso) : nowFallback;
  if (!date || Number.isNaN(date.getTime())) return '';
  return todayDate(date);
}

export function startOfMonthIso(now = new Date()) {
  const [year, month] = todayDate(now).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1, -2, 0, 0)).toISOString();
}

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export function timerStopAt(startedAt) {
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs)) return null;
  const day = todayDate(new Date(startMs));
  const eighteen = Date.parse(`${day}T18:00:00+02:00`);
  const midnight = Date.parse(`${shiftDate(day, 1)}T00:00:00+02:00`);
  const fourHours = startMs + FOUR_HOURS_MS;
  const cap = startMs < eighteen ? Math.min(fourHours, eighteen) : Math.min(fourHours, midnight);
  return new Date(cap).toISOString();
}

export function parseDuration(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  let seconds = 0;
  let saw = false;
  const hours = /(\d+(?:\.\d+)?)\s*h/.exec(text);
  const minutes = /(\d+)\s*m/.exec(text);
  if (hours) {
    seconds += Math.round(Number(hours[1]) * 3600);
    saw = true;
  }
  if (minutes) {
    seconds += Number(minutes[1]) * 60;
    saw = true;
  }
  if (!saw || seconds <= 0 || seconds > 24 * 3600) return null;
  return seconds;
}

export function durationFromParts(hours, minutes) {
  const h = Number(hours || 0);
  const m = Number(minutes || 0);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) return null;
  const seconds = Math.round(h * 3600 + m * 60);
  if (seconds <= 0 || seconds > 24 * 3600) return null;
  return seconds;
}

export function entryStart(ymd) {
  if (!isValidDate(ymd)) return null;
  const ms = Date.parse(`${ymd}T08:00:00+02:00`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function formatDayLabel(ymd) {
  if (!isValidDate(ymd)) return '';
  const ms = Date.parse(`${ymd}T12:00:00+02:00`);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(ms));
}

export function clockInJohannesburg(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  return hour && minute ? `${hour}:${minute}` : '';
}

export function formatEntryWhen(startedAt, endedAt) {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return '';
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(start);
  const end = endedAt ? clockInJohannesburg(endedAt) : 'running';
  const dur = formatDuration(entrySeconds(startedAt, endedAt));
  return `${date}, ${clockInJohannesburg(startedAt)} – ${end} (${dur})`;
}

function clockValue(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(String(value || '').trim());
  return match ? `${match[1]}:${match[2]}` : '';
}

export function entrySpan({ date, start, end, duration }) {
  const day = String(date || '').trim();
  const from = clockValue(start);
  const to = clockValue(end);
  if (isValidDate(day) && from && to) {
    const startedMs = Date.parse(`${day}T${from}:00+02:00`);
    const endedMs = Date.parse(`${day}T${to}:00+02:00`);
    if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs <= startedMs) return null;
    const seconds = Math.round((endedMs - startedMs) / 1000);
    if (seconds > 24 * 3600) return null;
    return { startedAt: new Date(startedMs).toISOString(), endedAt: new Date(endedMs).toISOString(), seconds };
  }
  const seconds = parseDuration(duration);
  const startedAt = entryStart(day);
  if (!seconds || !startedAt) return null;
  return {
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + seconds * 1000).toISOString(),
    seconds,
  };
}

export function formatCsvTimeEntry(entry) {
  const start = clockInJohannesburg(entry.started_at);
  const end = entry.ended_at ? clockInJohannesburg(entry.ended_at) : 'running';
  const dur = formatDuration(entrySeconds(entry.started_at, entry.ended_at));
  const range = `${dateInJohannesburg(entry.started_at)} ${start}–${end} (${dur})`;
  const note = String(entry.note || '').trim();
  return note ? `${range}: ${note}` : range;
}

export function entrySeconds(startedAt, endedAt, now = Date.now()) {
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  if (minutes) return `${minutes}m`;
  if (total >= 1) return `${total}s`;
  return '0m';
}

export function formatDurationClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export function daysBetween(due, today) {
  const [year, month, day] = due.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const a = Date.UTC(year, month - 1, day);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
}
