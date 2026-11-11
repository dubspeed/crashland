// Base building B: tech tree, slots, unlocked parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';
import * as B from '../src/base.js';

test('tech tree: the beacon first, then what its prerequisites allow', () => {
  const empty = B.missions({ modules: [] });
  assert.deepEqual(empty.open.map((o) => o.type), ['beacon']);
  const one = B.missions({ modules: [{ type: 'beacon', slot: 0 }] });
  assert.deepEqual(one.open.map((o) => o.type).sort(), ['depot', 'solar']);
  const later = B.missions({ modules: ['beacon', 'solar', 'depot'].map((type, i) => ({ type, slot: i })) });
  assert.deepEqual(later.open.map((o) => o.type).sort(), ['lab', 'refinery']);
  assert.ok(later.locked.find((l) => l.type === 'crew').need.includes('rocket'));
  // every module is reachable
  const all = new Set();
  let base = { modules: [] };
  for (let i = 0; i < 20; i++) { const o = B.missions(base).open[0]; if (!o) break; all.add(o.type); base.modules.push({ type: o.type, slot: i }); }
  assert.equal(all.size, S.MISSIONS.length);
});

test('slots: centre, then near ring, then far ring; older saves get slots', () => {
  const base = { modules: [{ type: 'beacon', slot: 0 }] };
  assert.equal(B.freeSlot(base, 'center'), null);
  assert.equal(B.freeSlot(base, 'near'), 1);
  for (let i = 1; i <= 6; i++) base.modules.push({ type: 'x', slot: i });
  assert.equal(B.freeSlot(base, 'near'), null);
  assert.equal(B.freeSlot(base, 'far'), 7);
  for (let i = 0; i < 13; i++) for (let j = i + 1; j < 13; j++) { const a = B.slotPos(i), b = B.slotPos(j); assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 10); }
  const m = B.migrate({ modules: [{ type: 'beacon', x: 0.3, z: 0.1 }, { type: 'solar', x: B.slotPos(3)[0] + 1, z: B.slotPos(3)[1] }], step: 2 });
  assert.deepEqual(m.modules.map((x) => x.slot), [0, 3]);
});

test('unlocks: big parts need the right modules, locked choices fall back to standard', () => {
  assert.ok(!B.isUnlocked('engine', 'cluster', new Set(['beacon'])));
  assert.ok(B.isUnlocked('engine', 'cluster', new Set(['refinery'])));
  assert.ok(B.isUnlocked('engine', 'std', new Set()));
  const b = B.allowedBuild({ ...S.DEFAULT_BUILD, engine: 'cluster', tanks: 'small' }, new Set(['beacon']));
  assert.equal(b.engine, 'std'); assert.equal(b.tanks, 'small');
  // the standard lander is always buildable
  for (const sl of S.BUILD_SLOTS) assert.ok(B.isUnlocked(sl.id, S.DEFAULT_BUILD[sl.id], new Set()), sl.id);
});

test('career order and supply contracts', () => {
  const full = { modules: S.MISSIONS.map((type, i) => { const [x, z] = B.slotPos(i); return { type, slot: i, x, z }; }) };
  const store = { 'luna-orbit': full, 'mars-orbit': { modules: [] } };
  const load = (id) => store[id] ?? { modules: [] };
  assert.ok(B.planetOpen('luna-orbit', load) && B.planetOpen('mars-orbit', load));
  assert.ok(!B.planetOpen('terra-orbit', load) && !B.planetOpen('brontes-orbit', load));
  store['mars-orbit'] = full;
  assert.ok(B.planetOpen('terra-orbit', load) && B.planetOpen('brontes-orbit', load));
  // offers: three, clear of every module, and new ones after a delivery
  const a = B.contracts(full), b = B.contracts({ ...full, cseed: 1 });
  assert.equal(a.length, 3);
  for (const o of a) for (const m of full.modules) assert.ok(Math.hypot(o.x - m.x, o.z - m.z) > (S.CARGO[m.type].r ?? 2) + 4, `${o.type} near ${m.type}`);
  assert.notDeepEqual(a, b);
  assert.ok(B.migrate({ ...full, supplies: 4, cseed: 4 }).supplies === 4);
});
