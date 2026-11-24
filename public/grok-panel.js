export function applyGrokClick(open, kind, inside) {
  if (kind === 'bubble') return !open;
  if (kind === 'close') return false;
  if (kind === 'outside') return inside ? open : false;
  return open;
}
