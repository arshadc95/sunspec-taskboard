export const PALETTE = [
  '#1d4ed8',
  '#0f766e',
  '#7c3aed',
  '#be185d',
  '#15803d',
  '#b91c1c',
  '#0e7490',
  '#4338ca',
  '#3f6212',
  '#9f1239',
  '#1e3a8a',
  '#6d28d9',
];

export function isPaletteColor(value) {
  return PALETTE.includes(String(value || '').toLowerCase());
}

export function nextColor(used = []) {
  const counts = new Map(PALETTE.map((color) => [color, 0]));
  for (const color of used) {
    const key = String(color || '').toLowerCase();
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
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
