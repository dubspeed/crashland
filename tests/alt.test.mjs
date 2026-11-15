import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';
import { makePilot } from './pilots.mjs';

const fly = (id, alt, seed) => {
  const P = S.PLANETS.find((p) => p.id === id);
  const s = S.newRound(P, 0, seed, { alt }, {}), pilot = makePilot(S, s.planet, { mode: 'retro2' });
  const input = { thrust: false };
  while (s.status === 'flying' && s.t < 400) { Object.assign(input, pilot(s, (n) => S.act(s, n)) ?? {}); S.advance(s, input); }
  return s;
};

test('start height scales the approach start, normal is unchanged', () => {
  const P = S.PLANETS[0];
  const n = S.newRound(P, 0, 3, {}, {}), lo = S.newRound(P, 0, 3, { alt: 0 }, {}), hi = S.newRound(P, 0, 3, { alt: 2 }, {});
  assert.equal(Math.round(S.altitude(n)), Math.round(S.altitude(S.newRound(P, 0, 3, { alt: 1 }, {}))));
  assert.ok(S.altitude(lo) < S.altitude(n) * 0.6 && S.altitude(hi) > S.altitude(n) * 1.8);
});

for (const id of ['luna', 'mars', 'terra']) for (const alt of [0, 2]) {
  test(`pilot lands ${id} with start height ${S.ALT_LEVELS[alt].name}`, () => {
    const s = fly(id, alt, 3);
    assert.equal(s.status, 'landed', s.reason);
  });
}
