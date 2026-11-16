// approach layout 2: side pads (rock field, rock pillar) on rough ground, sideways start
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';
import { makePilot } from './pilots.mjs';

const fly = (id, pad, seed) => {
  const P = S.PLANETS.find((p) => p.id === id);
  const s = S.newRound(P, 0, seed, { layout: 2, site: S.SITE_IDS[seed % 4] }, {}), pilot = makePilot(S, s.planet, { mode: 'retro2', pad });
  const input = { thrust: false };
  while (s.status === 'flying' && s.t < 400) { Object.assign(input, pilot(s, (n) => S.act(s, n)) ?? {}); S.advance(s, input); }
  return s;
};
const onPad = (s, kind) => { const a = S.padAt(s); return s.status === 'landed' && a.pad.kind === kind && a.d <= a.pad.r; };

test('layout 2: three pads, flat on top, boulders around the rock field, rough ground between', () => {
  const s = S.newRound(S.PLANETS[0], 0, 3, { layout: 2 }, {});
  assert.deepEqual(s.pads.map((p) => p.kind), ['main', 'rocks', 'spire']);
  for (const p of s.pads) {
    assert.ok(S.groundSpread(s, p.x + p.r * 0.7, p.z) < 0.05, `${p.kind} is flat`);
    if (p.kind !== 'main') { const d = Math.hypot(p.x, p.z); assert.ok(d > 120 && d < 250, `${p.kind} ${d} m away`); }
  }
  const spire = s.pads.find((p) => p.kind === 'spire');
  assert.ok(S.terrainHeight(spire.x, spire.z) - S.terrainHeight(spire.x + spire.r + 20, spire.z) > 20, 'the pillar stands out');
  const rocks = s.pads.find((p) => p.kind === 'rocks');
  assert.ok(s.obstacles.length >= 20 && s.obstacles.every((o) => Math.hypot(o.x - rocks.x, o.z - rocks.z) > rocks.r + o.r + 2), 'boulders around, the pad clear');
  let tip = 0, n = 0;
  for (let i = 0; i < 600; i++) { const x = (i * 37 % 600) - 300, z = (i * 53 % 600) - 300; if (Math.hypot(x, z) < 60) continue; n++; if (S.groundSpread(s, x, z) > 2) tip++; }
  assert.ok(tip / n > 0.2, 'missing the pads is risky');
  // the free fall would miss: past the main pad and off to one side
  assert.ok(Math.hypot(s.pred.x, s.pred.z) > 100, 'the cross starts off the pad');
  assert.ok(Math.hypot(s.vx, s.vz) > 10, 'sideways speed at the start');
});

test('without layout 2 the approach is unchanged (old replays)', () => {
  const s = S.newRound(S.PLANETS[0], 0, 3, {}, {});
  assert.equal(s.pads, undefined);
  assert.equal(S.terrainRoughOn(), false);
  assert.equal(S.terrainHeight(150, 40), S.terrainHeight(150, 40));
  assert.ok(Math.hypot(s.vx, s.vz) < 6);
});

for (const pad of ['main', 'rocks', 'spire']) for (const seed of [3, 11, 25]) {
  test(`pilot lands Luna on ${pad} (seed ${seed})`, () => assert.ok(onPad(fly('luna', pad, seed), pad)));
}
for (const [pad, seed] of [['main', 11], ['rocks', 11], ['spire', 3]]) {
  test(`pilot lands Mars on ${pad} (seed ${seed})`, () => assert.ok(onPad(fly('mars', pad, seed), pad)));
}
test('pilot lands Terra on the rock field (chute, steered canopy)', () => { for (const seed of [3, 25]) assert.ok(onPad(fly('terra', 'rocks', seed), 'rocks')); });
test('pilot lands Terra safely aiming for the main pad', () => { for (const seed of [3, 11, 25]) assert.equal(fly('terra', 'main', seed).status, 'landed'); });
