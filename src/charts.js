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

export function throughputChart(rows) {
  if (!rows?.some((row) => row.created || row.completed)) return '';
  const w = 640;
  const h = 168;
  const left = 28;
  const max = Math.max(1, ...rows.flatMap((row) => [row.created, row.completed]));
  const plotW = w - left - 8;
  const plotH = h - 46;
  const slot = plotW / rows.length;
  const y = (value) => 18 + plotH - (value / max) * plotH;
  const bars = rows.map((row, index) => {
    const x = left + index * slot + 4;
    const bw = Math.max(3, slot / 2 - 5);
    return `<rect x="${x.toFixed(1)}" y="${y(row.created).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, 18 + plotH - y(row.created)).toFixed(1)}" fill="#d4d4d4"><title>Created ${row.created}</title></rect>`
      + `<rect x="${(x + bw + 2).toFixed(1)}" y="${y(row.completed).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, 18 + plotH - y(row.completed)).toFixed(1)}" fill="#f97316"><title>Done ${row.completed}</title></rect>`
      + `<text x="${(x + bw).toFixed(1)}" y="${h - 16}" text-anchor="middle" font-size="9" fill="#555" font-family="Inter, sans-serif">${esc(row.label)}</text>`;
  }).join('');
  const axis = `<line x1="${left}" y1="18" x2="${left}" y2="${18 + plotH}" stroke="#e5e5e5"/>`
    + `<line x1="${left}" y1="${18 + plotH}" x2="${w - 8}" y2="${18 + plotH}" stroke="#e5e5e5"/>`
    + `<text x="2" y="22" font-size="9" fill="#555" font-family="Inter, sans-serif">${max}</text>`
    + `<text x="2" y="${18 + plotH}" font-size="9" fill="#555" font-family="Inter, sans-serif">0</text>`
    + `<rect x="${left}" y="2" width="8" height="8" fill="#d4d4d4"/><text x="${left + 12}" y="10" font-size="10" fill="#111" font-family="Inter, sans-serif">Created</text>`
    + `<rect x="${left + 78}" y="2" width="8" height="8" fill="#f97316"/><text x="${left + 90}" y="10" font-size="10" fill="#111" font-family="Inter, sans-serif">Done</text>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Tasks created and completed over 12 weeks">${axis}${bars}</svg>`;
}

const FLOW = [
  ['todo', 'To do', '#e5e5e5'],
  ['in_progress', 'In progress', '#f97316'],
  ['review', 'Review', '#fdba74'],
  ['done', 'Done', '#111'],
];

export function stackedArea(cfd) {
  const days = cfd?.days || [];
  if (!days.length) return '';
  const totals = days.map((_, index) => FLOW.reduce((sum, [key]) => sum + (cfd[key][index] || 0), 0));
  if (!totals.some((value) => value > 0)) return '';
  const w = 640;
  const h = 200;
  const left = 32;
  const top = 22;
  const bottom = 28;
  const plotH = h - top - bottom;
  const max = Math.max(...totals, 1);
  const xAt = (index) => (days.length === 1 ? left + (w - left - 12) / 2 : left + (index / (days.length - 1)) * (w - left - 12));
  const yAt = (value) => top + plotH - (value / max) * plotH;
  let shapes = '';
  for (let layer = FLOW.length - 1; layer >= 0; layer -= 1) {
    const key = FLOW[layer][0];
    const topPts = [];
    const bottomPts = [];
    days.forEach((_, index) => {
      const below = FLOW.slice(0, layer).reduce((sum, [name]) => sum + (cfd[name][index] || 0), 0);
      const here = below + (cfd[key][index] || 0);
      topPts.push(`${xAt(index).toFixed(1)},${yAt(here).toFixed(1)}`);
      bottomPts.push(`${xAt(index).toFixed(1)},${yAt(below).toFixed(1)}`);
    });
    shapes += `<polygon points="${[...topPts, ...bottomPts.reverse()].join(' ')}" fill="${FLOW[layer][2]}"><title>${FLOW[layer][1]}</title></polygon>`;
  }
  const probes = days.map((day, index) => {
    const bits = FLOW.map(([key, label]) => `${label} ${cfd[key][index] || 0}`).join(', ');
    const slot = days.length === 1 ? 12 : Math.max(4, (w - left - 12) / (days.length - 1));
    return `<rect x="${(xAt(index) - slot / 2).toFixed(1)}" y="${top}" width="${slot.toFixed(1)}" height="${plotH}" fill="transparent"><title>${esc(day)}: ${bits}</title></rect>`;
  }).join('');
  const legend = FLOW.map(([, label, color], index) => {
    const x = left + index * 110;
    return `<rect x="${x}" y="4" width="8" height="8" fill="${color}"/><text x="${x + 12}" y="12" font-size="10" fill="#111" font-family="Inter, sans-serif">${label}</text>`;
  }).join('');
  const axis = `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + `<line x1="${left}" y1="${top + plotH}" x2="${w - 12}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + `<text x="2" y="${top + 8}" font-size="9" fill="#555" font-family="Inter, sans-serif">${max}</text>`
    + `<text x="2" y="${top + plotH}" font-size="9" fill="#555" font-family="Inter, sans-serif">0</text>`
    + `<text x="${left}" y="${h - 6}" font-size="9" fill="#555" font-family="Inter, sans-serif">${esc(days[0])}</text>`
    + `<text x="${w - 12}" y="${h - 6}" text-anchor="end" font-size="9" fill="#555" font-family="Inter, sans-serif">${esc(days[days.length - 1])}</text>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cumulative flow by status">${legend}${axis}${shapes}${probes}</svg>`;
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
  const line = p85 == null ? '' : `<line x1="${left}" x2="${left + plotW}" y1="${yAt(p85).toFixed(1)}" y2="${yAt(p85).toFixed(1)}" stroke="#f97316" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${left + plotW}" y="${Math.max(12, yAt(p85) - 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#f97316" font-family="Inter, sans-serif">85th · ${p85}d</text>`;
  const axis = `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + `<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + `<text x="2" y="${top + 8}" font-size="9" fill="#555" font-family="Inter, sans-serif">${Math.ceil(maxY)}</text>`
    + `<text x="2" y="${top + plotH}" font-size="9" fill="#555" font-family="Inter, sans-serif">0</text>`
    + `<text x="${left}" y="${h - 6}" font-size="9" fill="#555" font-family="Inter, sans-serif">${esc(points[0].date.slice(5))}</text>`
    + `<text x="${left + plotW}" y="${h - 6}" text-anchor="end" font-size="9" fill="#555" font-family="Inter, sans-serif">${esc(points[points.length - 1].date.slice(5))}</text>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cycle time of finished tasks">${axis}${line}${dots}</svg>`;
}

export function backlogChart(points) {
  if (!points?.length) return '';
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
  const probes = values.map((value, index) => `<circle cx="${xAt(index).toFixed(1)}" cy="${yAt(value).toFixed(1)}" r="6" fill="transparent"><title>Open ${value}</title></circle>`).join('');
  const axis = `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + `<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#e5e5e5"/>`
    + `<text x="2" y="${top + 8}" font-size="9" fill="#555" font-family="Inter, sans-serif">${max}</text>`
    + `<text x="2" y="${top + plotH}" font-size="9" fill="#555" font-family="Inter, sans-serif">0</text>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Open tasks over the period">${axis}<polygon points="${area}" fill="#f97316" opacity="0.15"/><polyline fill="none" stroke="#111" stroke-width="2" points="${line}"/>${probes}</svg>`;
}

export function heatMap(heatmap) {
  const rows = heatmap?.rows || [];
  const weeks = heatmap?.weeks || [];
  if (!rows.length || !weeks.length) return '';
  const cell = 22;
  const label = 110;
  const w = label + weeks.length * cell;
  const h = 18 + rows.length * cell;
  const max = heatmap.max || 1;
  let body = weeks.map((week, index) => `<text x="${label + index * cell + 2}" y="12" font-size="9" fill="#555">${esc(week)}</text>`).join('');
  rows.forEach((row, rowIndex) => {
    body += `<text x="0" y="${22 + rowIndex * cell + 12}" font-size="10" fill="#111">${esc(row.name)}</text>`;
    row.cells.forEach((count, index) => {
      const shade = count ? 0.15 + 0.85 * (count / max) : 0.06;
      body += `<rect x="${label + index * cell}" y="${18 + rowIndex * cell}" width="${cell - 2}" height="${cell - 2}" fill="#f97316" opacity="${shade.toFixed(2)}"><title>${esc(row.name)} ${count}</title></rect>`;
    });
  });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Tasks completed by person over 8 weeks">${body}</svg>`;
}
