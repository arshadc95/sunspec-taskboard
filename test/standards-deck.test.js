import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { moveStandardsDeck, openStandardsDeck, shuffleStandards, storedOrder } from '../public/standards-deck.js';

const standards = JSON.parse(readFileSync(new URL('../src/data/standards.json', import.meta.url), 'utf8'));

function randomFrom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function categoriesInOrder(items, order) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return order.map((id) => byId.get(id).category);
}

function noAdjacentCategory(categories) {
  for (let index = 1; index < categories.length; index += 1) {
    if (categories[index] === categories[index - 1]) return false;
  }
  return true;
}

test('a shuffled standards deck uses every card and never repeats a category in a row', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const shuffled = shuffleStandards(standards, randomFrom(seed));
    assert.equal(shuffled.length, standards.length);
    assert.equal(new Set(shuffled.map((item) => item.id)).size, standards.length);
    assert.equal(noAdjacentCategory(shuffled.map((item) => item.category)), true);
  }
  const once = shuffleStandards(standards, randomFrom(4)).map((item) => item.id);
  assert.notDeepEqual(once, standards.map((item) => item.id));
});

test('each open picks a random card in the saved shuffle and skips the card already showing', () => {
  const first = openStandardsDeck(standards, null, randomFrom(8));
  assert.equal(first.order.length, standards.length);
  assert.equal(storedOrder({ order: first.order }, standards).length, standards.length);
  assert.ok(first.pos >= 0 && first.pos < first.order.length);
  const again = openStandardsDeck(standards, first, () => 0);
  assert.deepEqual(again.order, first.order);
  assert.notEqual(again.pos, first.pos);
  const fresh = openStandardsDeck(standards, null, () => 0.5);
  assert.notEqual(fresh.pos, 0);
});

test('prev and next walk the saved order, then reshuffle at either end', () => {
  const random = randomFrom(11);
  const opened = openStandardsDeck(standards, null, random);
  const middle = { order: opened.order, pos: 3 };
  const forward = moveStandardsDeck(standards, middle, 1, random);
  assert.deepEqual(forward.order, middle.order);
  assert.equal(forward.pos, 4);
  const back = moveStandardsDeck(standards, middle, -1, random);
  assert.equal(back.pos, 2);

  const seen = [];
  let deck = { order: opened.order, pos: 0 };
  for (let step = 0; step < standards.length; step += 1) {
    seen.push(deck.order[deck.pos]);
    deck = moveStandardsDeck(standards, deck, 1, randomFrom(20 + step));
  }
  assert.equal(new Set(seen).size, standards.length);
  assert.equal(deck.pos, 0);
  assert.notDeepEqual(deck.order, opened.order);
  const categories = categoriesInOrder(standards, deck.order);
  assert.equal(noAdjacentCategory(categories), true);
  const left = standards.find((item) => item.id === seen.at(-1));
  assert.notEqual(categories[0], left.category);

  const rewound = moveStandardsDeck(standards, { order: opened.order, pos: 0 }, -1, randomFrom(30));
  assert.equal(rewound.pos, rewound.order.length - 1);
  const rewoundCategories = categoriesInOrder(standards, rewound.order);
  assert.equal(noAdjacentCategory(rewoundCategories), true);
  const started = standards.find((item) => item.id === opened.order[0]);
  assert.notEqual(rewoundCategories.at(-1), started.category);
});

test('a saved deck is dropped when the catalogue changes or two categories touch', () => {
  const order = standards.map((item) => item.id);
  assert.equal(storedOrder({ order: order.slice(0, -1) }, standards), null);
  assert.equal(storedOrder({ order: [...order, 'extra'] }, standards), null);
  const wiring = standards.filter((item) => item.category === 'Wiring');
  const others = standards.filter((item) => item.category !== 'Wiring');
  const touching = [wiring[0], wiring[1], ...others, ...wiring.slice(2)].map((item) => item.id);
  assert.equal(storedOrder({ order: touching }, standards), null);
});
