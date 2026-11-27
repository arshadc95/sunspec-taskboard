export const PALETTE = [
  '#e53935',
  '#1e88e5',
  '#43a047',
  '#fdd835',
  '#8e24aa',
  '#fb8c00',
  '#00acc1',
  '#d81b60',
  '#6d4c41',
  '#3949ab',
  '#7cb342',
  '#546e7a',
];

export const COLOR_NAMES = [
  'Red',
  'Blue',
  'Green',
  'Yellow',
  'Purple',
  'Orange',
  'Cyan',
  'Pink',
  'Brown',
  'Indigo',
  'Lime',
  'Slate',
];

export function normalizeColor(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  const hex = text.startsWith('#') ? text : `#${text}`;
  return PALETTE.includes(hex) ? hex : null;
}

export function isPaletteColor(value) {
  return normalizeColor(value) !== null;
}

export function colorForUser(userId, stored) {
  const known = normalizeColor(stored);
  if (known) return known;
  const id = Number(userId);
  const index = Number.isFinite(id) ? Math.abs(Math.trunc(id)) % PALETTE.length : 0;
  return PALETTE[index];
}

export function colorClass(color, userId) {
  const hex = colorForUser(userId, color);
  const index = PALETTE.indexOf(hex);
  return `c-${index < 0 ? 0 : index}`;
}

export function colorsToStore(rows) {
  const sorted = [...rows].sort((a, b) => Number(a.id) - Number(b.id));
  const used = new Set();
  for (const row of sorted) {
    const known = normalizeColor(row.color);
    if (known) used.add(known);
  }
  const updates = [];
  for (const row of sorted) {
    const known = normalizeColor(row.color);
    if (known) {
      if (known !== row.color) updates.push({ id: row.id, color: known });
      continue;
    }
    const free = PALETTE.find((color) => !used.has(color));
    const color = free || PALETTE[Math.abs(Math.trunc(Number(row.id))) % PALETTE.length] || PALETTE[0];
    used.add(color);
    if (color !== row.color) updates.push({ id: row.id, color });
  }
  return updates;
}

export function nextColor(used = []) {
  const counts = new Map(PALETTE.map((color) => [color, 0]));
  for (const color of used) {
    const key = normalizeColor(color);
    if (key) counts.set(key, counts.get(key) + 1);
  }
  let choice = PALETTE[0];
  let least = Infinity;
  for (const color of PALETTE) {
    const count = counts.get(color);
    if (count < least) {
      choice = color;
      least = count;
    }
  }
  return choice;
}
