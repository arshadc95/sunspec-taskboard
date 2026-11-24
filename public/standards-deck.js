function shuffleInPlace(list, random) {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [list[index], list[swap]] = [list[swap], list[index]];
  }
  return list;
}

function neighboursOk(list, index) {
  const category = list[index].category;
  if (index > 0 && list[index - 1].category === category) return false;
  if (index + 1 < list.length && list[index + 1].category === category) return false;
  return true;
}

export function shuffleStandards(items, random = Math.random) {
  const groups = new Map();
  for (const item of items) {
    const key = item.category || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const list of groups.values()) shuffleInPlace(list, random);
  const out = [];
  let last = null;
  while (out.length < items.length) {
    const remaining = [...groups.keys()].filter((key) => groups.get(key).length);
    const different = remaining.filter((key) => key !== last);
    const pool = different.length ? different : remaining;
    let max = 0;
    for (const key of pool) max = Math.max(max, groups.get(key).length);
    const biggest = pool.filter((key) => groups.get(key).length === max);
    const key = biggest[Math.floor(random() * biggest.length)];
    out.push(groups.get(key).pop());
    last = key;
  }
  return out;
}

function withDifferentEdge(items, edge, forbidden) {
  if (!forbidden || items.length < 2 || items[edge].category !== forbidden) return items;
  const copy = items.slice();
  for (let index = 0; index < copy.length; index += 1) {
    if (index === edge || copy[index].category === forbidden) continue;
    [copy[edge], copy[index]] = [copy[index], copy[edge]];
    if (neighboursOk(copy, edge) && neighboursOk(copy, index)) return copy;
    [copy[edge], copy[index]] = [copy[index], copy[edge]];
  }
  return items;
}

export function storedOrder(stored, items) {
  if (!stored || !Array.isArray(stored.order) || stored.order.length !== items.length) return null;
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set();
  const resolved = [];
  for (const id of stored.order) {
    const item = byId.get(id);
    if (!item || seen.has(id)) return null;
    seen.add(id);
    resolved.push(item);
  }
  for (let index = 1; index < resolved.length; index += 1) {
    if (resolved[index].category && resolved[index].category === resolved[index - 1].category) return null;
  }
  return stored.order.slice();
}

export function openStandardsDeck(items, stored, random = Math.random) {
  if (!items.length) return { order: [], pos: 0 };
  const kept = storedOrder(stored, items);
  const order = kept || shuffleStandards(items, random).map((item) => item.id);
  let pos = Math.floor(random() * order.length);
  if (order.length > 1 && kept && Number.isInteger(stored.pos)) {
    const previous = ((stored.pos % order.length) + order.length) % order.length;
    if (pos === previous) pos = (pos + 1 + Math.floor(random() * (order.length - 1))) % order.length;
  }
  return { order, pos };
}

export function cardAt(items, deck) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return byId.get(deck.order[deck.pos]) || null;
}

export function moveStandardsDeck(items, deck, direction, random = Math.random) {
  if (!items.length) return { order: [], pos: 0 };
  const next = deck.pos + direction;
  if (next >= 0 && next < deck.order.length) return { order: deck.order, pos: next };
  const leaving = cardAt(items, deck);
  const edge = direction < 0 ? items.length - 1 : 0;
  const shuffled = withDifferentEdge(shuffleStandards(items, random), edge, leaving?.category);
  return { order: shuffled.map((item) => item.id), pos: edge };
}
