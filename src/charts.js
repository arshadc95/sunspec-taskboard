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

export function stackedArea(cfd) {
  const days = cfd?.days || [];
  if (!days.length) return '';
  const keys = ['todo', 'in_progress', 'review', 'done'];
  const colors = { todo: '#d4d4d4', in_progress: '#f97316', review: '#93c5fd', done: '#111' };
  const totals = days.map((_, index) => keys.reduce((sum, key) => sum + (cfd[key][index] || 0), 0));
  if (!totals.some((value) => value > 0)) return '';
  const w = 640;
  const h = 160;
  const max = Math.max(...totals, 1);
  const xAt = (index) => (days.length === 1 ? w / 2 : (index / (days.length - 1)) * (w - 8) + 4);
  const yAt = (value) => h - 16 - (value / max) * (h - 28);
  let shapes = '';
  for (let layer = keys.length - 1; layer >= 0; layer -= 1) {
    const top = [];
    const bottom = [];
    days.forEach((_, index) => {
      const below = keys.slice(0, layer).reduce((sum, key) => sum + (cfd[key][index] || 0), 0);
      const here = below + (cfd[keys[layer]][index] || 0);
      top.push(`${xAt(index).toFixed(1)},${yAt(here).toFixed(1)}`);
      bottom.push(`${xAt(index).toFixed(1)},${yAt(below).toFixed(1)}`);
    });
    const points = [...top, ...bottom.reverse()].join(' ');
    shapes += `<polygon points="${points}" fill="${colors[keys[layer]]}" opacity="0.9"/>`;
  }
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Tasks in each status over the period">${shapes}</svg>`;
}

export function scatterChart(points, p85) {
  if (!points?.length) return '';
  const w = 640;
  const h = 160;
  const maxY = Math.max(p85 || 0, ...points.map((point) => point.days), 1);
  const xs = points.map((point) => point.date).sort();
  const minX = xs[0];
  const maxX = xs[xs.length - 1];
  const span = Math.max(1, Date.parse(`${maxX}T12:00:00Z`) - Date.parse(`${minX}T12:00:00Z`));
  const dots = points.map((point) => {
    const x = 8 + ((Date.parse(`${point.date}T12:00:00Z`) - Date.parse(`${minX}T12:00:00Z`)) / span) * (w - 16);
    const y = h - 16 - (point.days / maxY) * (h - 28);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#111"><title>${esc(point.title)} ${point.days}d</title></circle>`;
  }).join('');
  const lineY = p85 == null ? null : h - 16 - (p85 / maxY) * (h - 28);
  const line = lineY == null ? '' : `<line x1="8" x2="${w - 8}" y1="${lineY.toFixed(1)}" y2="${lineY.toFixed(1)}" stroke="#f97316" stroke-width="1.5"/>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cycle time of finished tasks">${line}${dots}</svg>`;
}

export function backlogChart(points) {
  if (!points?.length) return '';
  return sparkline(points.map((point) => point.open), '#111').replace('class="spark"', 'class="chart backlog"').replace('width="96"', 'width="100%"').replace('height="28"', 'height="48"');
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
