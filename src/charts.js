import { isPaletteColor } from './colors.js';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

export function sparkline(values, color = '#111') {
  const nums = values?.length ? values : [0];
  const w = 96;
  const h = 28;
  const max = Math.max(...nums, 1);
  const min = Math.min(...nums, 0);
  const span = max - min || 1;
  const pts = nums.map((value, index) => {
    const x = nums.length === 1 ? w / 2 : (index / (nums.length - 1)) * (w - 4) + 2;
    const y = h - 3 - ((value - min) / span) * (h - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.6" points="${pts}"/></svg>`;
}

export function ring(pct) {
  if (pct == null) return '';
  const length = 2 * Math.PI * 10;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * length;
  return `<svg class="ring" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="10" fill="none" stroke="#e5e5e5" stroke-width="3"/><circle cx="14" cy="14" r="10" fill="none" stroke="#f97316" stroke-width="3" stroke-dasharray="${dash.toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 14 14)"/></svg>`;
}

function axisTicks(max) {
  const top = Math.max(1, Math.ceil(max));
  let step = 1;
  if (top > 20) step = Math.ceil(top / 4);
  else if (top > 10) step = 5;
  else if (top > 5) step = 2;
  const ticks = [];
  for (let value = 0; value < top; value += step) ticks.push(value);
  if (ticks[ticks.length - 1] !== top) ticks.push(top);
  return ticks;
}

function legendRow(items, x0, y) {
  return items.map(([label, color], index) => {
    const x = x0 + index * 118;
    return `<rect x="${x}" y="${y}" width="8" height="8" fill="${color}"/><text x="${x + 12}" y="${y + 8}" font-size="10" fill="#111" font-family="Inter, sans-serif">${label}</text>`;
  }).join('');
}

export function throughputChart(rows) {
  const source = rows || [];
  const active = source.filter((row) => row.created || row.completed);
  const plotted = active.length && active.length < 2 ? active : source;
  if (!plotted.some((row) => row.created || row.completed)) return '';
  const w = 640;
  const h = 168;
  const left = 28;
  const top = 18;
  const plotH = h - top - 28;
  const max = Math.max(1, ...plotted.flatMap((row) => [row.created, row.completed]));
  const plotW = w - left - 8;
  const slot = plotW / plotted.length;
  const y = (value) => top + plotH - (value / max) * plotH;
  const bars = plotted.map((row, index) => {
    const x = left + index * slot + Math.min(8, slot * 0.15);
    const bw = Math.max(8, (slot - 16) / 2);
    const createdH = Math.max(0, top + plotH - y(row.created));
    const doneH = Math.max(0, top + plotH - y(row.completed));
    return `<rect x="${x.toFixed(1)}" y="${y(row.created).toFixed(1)}" width="${bw.toFixed(1)}" height="${createdH.toFixed(1)}" fill="#d4d4d4"><title>${esc(row.label)}: Created ${row.created}</title></rect>`
      + `<rect x="${(x + bw + 3).toFixed(1)}" y="${y(row.completed).toFixed(1)}" width="${bw.toFixed(1)}" height="${doneH.toFixed(1)}" fill="#f97316"><title>${esc(row.label)}: Done ${row.completed}</title></rect>`
      + `<text x="${(x + bw).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#555" font-family="Inter, sans-serif">${esc(row.label)}</text>`;
  }).join('');
  const ticks = axisTicks(max).map((value) => {
    const yy = y(value);
    return `<text x="2" y="${(yy + 3).toFixed(1)}" font-size="9" fill="#555" font-family="Inter, sans-serif">${value}</text>`;
  }).join('');
  const axis = `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + `<line x1="${left}" y1="${top + plotH}" x2="${w - 8}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + ticks
    + `<rect x="${left}" y="2" width="8" height="8" fill="#d4d4d4"/><text x="${left + 12}" y="10" font-size="10" fill="#111" font-family="Inter, sans-serif">Created</text>`
    + `<rect x="${left + 78}" y="2" width="8" height="8" fill="#f97316"/><text x="${left + 90}" y="10" font-size="10" fill="#111" font-family="Inter, sans-serif">Done</text>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Created vs done">${axis}${bars}</svg>`;
}

const FLOW = [
  ['todo', 'To do', '#374151'],
  ['in_progress', 'In progress', '#f97316'],
  ['review', 'Review', '#0f766e'],
  ['done', 'Done', '#d1d5db'],
];

function flowSeries(cfd) {
  const days = cfd?.days || [];
  const flow = FLOW.filter(([key]) => (cfd?.[key] || []).some((value) => value > 0));
  const totals = days.map((_, index) => flow.reduce((sum, [key]) => sum + (Number(cfd[key][index]) || 0), 0));
  return { days, flow, totals };
}

function horizontalStatus(cfd, index) {
  const { flow } = flowSeries(cfd);
  const day = cfd.days[index];
  const parts = flow.map(([key, label, color]) => ({ label, color, value: Number(cfd[key][index]) || 0 })).filter((part) => part.value > 0);
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  const w = 640;
  const h = 78;
  let x = 28;
  const barW = w - 40;
  const segs = parts.map((part) => {
    const width = (part.value / total) * barW;
    const rect = `<rect x="${x.toFixed(1)}" y="36" width="${Math.max(width, 1).toFixed(1)}" height="22" fill="${part.color}"><title>${esc(day)}: ${part.label} ${part.value}</title></rect>`;
    x += width;
    return rect;
  }).join('');
  const summary = parts.map((part) => `${part.label} ${part.value}`).join(', ');
  return `<svg class="chart status-today" viewBox="0 0 ${w} ${h}" role="img" aria-label="Status today">${legendRow(parts.map((part) => [part.label, part.color]), 28, 8)}${segs}<text x="28" y="72" font-size="11" fill="#111" font-family="Inter, sans-serif">${esc(day)}: ${esc(summary)}</text></svg>`;
}

export function stackedArea(cfd) {
  const { days, flow, totals } = flowSeries(cfd);
  if (!days.length || !flow.length || !totals.some((value) => value > 0)) return '';
  const active = totals.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
  if (active < 2) {
    const index = totals.findLastIndex((value) => value > 0);
    return horizontalStatus(cfd, index < 0 ? days.length - 1 : index);
  }
  const w = 640;
  const h = 210;
  const left = 32;
  const top = 28;
  const bottom = 28;
  const plotH = h - top - bottom;
  const plotW = w - left - 12;
  const max = Math.max(...totals, 1);
  const slot = plotW / days.length;
  const gap = Math.min(3, slot * 0.18);
  const bw = Math.max(2, slot - gap);
  const yAt = (value) => top + plotH - (value / max) * plotH;
  const bars = days.map((day, index) => {
    let cursor = top + plotH;
    const bits = flow.map(([key, label]) => `${label} ${cfd[key][index] || 0}`).join(', ');
    const segments = flow.map(([key, label, color]) => {
      const value = Number(cfd[key][index]) || 0;
      const height = (value / max) * plotH;
      cursor -= height;
      if (!value) return '';
      return `<rect x="${(left + index * slot).toFixed(1)}" y="${cursor.toFixed(1)}" width="${bw.toFixed(1)}" height="${height.toFixed(1)}" fill="${color}"><title>${esc(day)}: ${label} ${value}</title></rect>`;
    }).join('');
    const labelEvery = Math.ceil(days.length / 8);
    const label = days.length <= 12 || index % labelEvery === 0 || index === days.length - 1
      ? `<text x="${(left + index * slot + bw / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#555" font-family="Inter, sans-serif">${esc(day)}</text>`
      : '';
    return `${segments}<rect x="${(left + index * slot).toFixed(1)}" y="${top}" width="${bw.toFixed(1)}" height="${plotH}" fill="transparent"><title>${esc(day)}: ${bits}</title></rect>${label}`;
  }).join('');
  const ticks = axisTicks(max).map((value) => `<text x="2" y="${(yAt(value) + 3).toFixed(1)}" font-size="9" fill="#555" font-family="Inter, sans-serif">${value}</text>`).join('');
  const axis = `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + `<line x1="${left}" y1="${top + plotH}" x2="${w - 12}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + ticks;
  return `<svg class="chart status-bars" viewBox="0 0 ${w} ${h}" role="img" aria-label="Status over time">${legendRow(flow.map(([, label, color]) => [label, color]), left, 6)}${axis}${bars}</svg>`;
}

export function scatterChart(points, p85) {
  if (!points?.length) return '';
  const w = 640;
  const h = 190;
  const left = 36;
  const top = 16;
  const bottom = 28;
  const plotH = h - top - bottom;
  const plotW = w - left - 16;
  const maxY = Math.max(1, p85 || 0, ...points.map((point) => point.days)) * 1.15;
  const dates = points.map((point) => Date.parse(`${point.date}T12:00:00Z`)).filter(Number.isFinite);
  const minX = Math.min(...dates);
  const maxX = Math.max(...dates);
  const span = Math.max(86400000, maxX - minX);
  const xAt = (date) => left + ((Date.parse(`${date}T12:00:00Z`) - minX) / span) * plotW;
  const yAt = (days) => top + plotH - (days / maxY) * plotH;
  const dots = points.map((point) => `<circle cx="${xAt(point.date).toFixed(1)}" cy="${yAt(point.days).toFixed(1)}" r="4" fill="#111"><title>${esc(point.title)} · ${point.days} days · ${esc(point.date)}</title></circle>`).join('');
  const lineY = p85 == null ? 0 : yAt(p85);
  const line = p85 == null ? '' : `<line x1="${left}" x2="${left + plotW}" y1="${lineY.toFixed(1)}" y2="${lineY.toFixed(1)}" stroke="#f97316" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${left + 6}" y="${(lineY < 28 ? lineY + 14 : lineY - 6).toFixed(1)}" font-size="11" fill="#f97316" font-family="Inter, sans-serif">Most tasks finished within ${p85} days</text>`;
  const axis = `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + `<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + `<text x="2" y="${top + 8}" font-size="9" fill="#555" font-family="Inter, sans-serif">${Math.ceil(maxY)}</text>`
    + `<text x="2" y="${top + plotH}" font-size="9" fill="#555" font-family="Inter, sans-serif">0</text>`
    + `<text x="${left}" y="${h - 6}" font-size="9" fill="#555" font-family="Inter, sans-serif">${esc(points[0].date.slice(5))}</text>`
    + `<text x="${left + plotW}" y="${h - 6}" text-anchor="end" font-size="9" fill="#555" font-family="Inter, sans-serif">${esc(points[points.length - 1].date.slice(5))}</text>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Days per finished task">${axis}${line}${dots}</svg>`;
}

export function backlogChart(points) {
  if (!points?.length || !points.some((point) => point.open > 0)) return '';
  const active = points.filter((point) => point.open > 0);
  if (active.length < 2) {
    const point = active[0];
    return `<svg class="chart open-today" viewBox="0 0 640 64" role="img" aria-label="Open tasks today"><rect x="28" y="28" width="240" height="22" fill="#374151"><title>${esc(point.label)}: Open ${point.open}</title></rect><text x="28" y="18" font-size="11" fill="#111" font-family="Inter, sans-serif">${esc(point.label)}: ${point.open} open</text></svg>`;
  }
  const w = 640;
  const h = 160;
  const left = 32;
  const top = 12;
  const bottom = 22;
  const plotH = h - top - bottom;
  const plotW = w - left - 12;
  const values = points.map((point) => point.open);
  const max = Math.max(...values, 1);
  const xAt = (index) => (points.length === 1 ? left + plotW / 2 : left + (index / (points.length - 1)) * plotW);
  const yAt = (value) => top + plotH - (value / max) * plotH;
  const line = values.map((value, index) => `${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`).join(' ');
  const area = `${left},${top + plotH} ${line} ${xAt(points.length - 1).toFixed(1)},${top + plotH}`;
  const probes = values.map((value, index) => `<circle cx="${xAt(index).toFixed(1)}" cy="${yAt(value).toFixed(1)}" r="6" fill="transparent"><title>${esc(points[index].label)}: Open ${value}</title></circle>`).join('');
  const ticks = axisTicks(max).map((value) => `<text x="2" y="${(yAt(value) + 3).toFixed(1)}" font-size="9" fill="#555" font-family="Inter, sans-serif">${value}</text>`).join('');
  const axis = `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + `<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + ticks;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Open tasks over time">${axis}<polygon points="${area}" fill="#374151" opacity="0.12"/><polyline fill="none" stroke="#111" stroke-width="2" points="${line}"/>${probes}</svg>`;
}

export function heatMap(heatmap) {
  const rows = heatmap?.rows || [];
  const weeks = heatmap?.weeks || [];
  if (!rows.length || !weeks.length) return '';
  const cell = 22;
  const label = 124;
  const w = label + weeks.length * cell;
  const h = 18 + rows.length * cell;
  const max = heatmap.max || 1;
  let body = weeks.map((week, index) => `<text x="${label + index * cell + 2}" y="12" font-size="9" fill="#555">${esc(week)}</text>`).join('');
  rows.forEach((row, rowIndex) => {
    if (isPaletteColor(row.color)) body += `<circle cx="3" cy="${22 + rowIndex * cell + 8}" r="3" fill="${row.color}"/>`;
    body += `<text x="10" y="${22 + rowIndex * cell + 12}" font-size="10" fill="#111">${esc(row.name)}</text>`;
    row.cells.forEach((count, index) => {
      const shade = count ? 0.15 + 0.85 * (count / max) : 0.06;
      body += `<rect x="${label + index * cell}" y="${18 + rowIndex * cell}" width="${cell - 2}" height="${cell - 2}" fill="#f97316" opacity="${shade.toFixed(2)}"><title>${esc(row.name)} ${count}</title></rect>`;
    });
  });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Tasks completed by person over 8 weeks">${body}</svg>`;
}
