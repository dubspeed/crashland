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

test('research: parts are bought with science points in order, locked choices fall back to standard', () => {
  assert.ok(!B.isUnlocked('engine', 'cluster', new Set(['engine.eco'])));
  assert.ok(B.isUnlocked('engine', 'cluster', new Set(['engine.cluster'])));
  assert.ok(B.isUnlocked('engine', 'std', new Set()));
  const b = B.allowedBuild({ ...S.DEFAULT_BUILD, engine: 'cluster', tanks: 'small' }, new Set());
  assert.equal(b.engine, 'std'); assert.equal(b.tanks, 'small');
  // the standard lander is always buildable, every node is a real builder part and its prerequisites exist
  for (const sl of S.BUILD_SLOTS) assert.ok(B.isUnlocked(sl.id, S.DEFAULT_BUILD[sl.id], new Set()), sl.id);
  for (const n of B.RESEARCH) {
    const [sl, o] = n.id.split('.');
    assert.ok(S.BUILD_SLOTS.find((x) => x.id === sl)?.options.some((x) => x.id === o), n.id);
    for (const r of n.need) assert.ok(B.RESEARCH.some((x) => x.id === r), r);
  }
  // buying: needs the earlier node and enough points
  assert.equal(B.research({ sp: 20, done: [] }, 'engine.strong'), null);
  assert.equal(B.research({ sp: 2, done: [] }, 'engine.eco'), null);
  assert.deepEqual(B.research({ sp: 5, done: [] }, 'engine.eco'), { sp: 2, done: ['engine.eco'] });
  assert.equal(B.research({ sp: 5, done: ['engine.eco'] }, 'engine.eco'), null);
  // science: more on later planets and with labs/rovers, half when damaged, none for fuel
  assert.equal(B.sciencePoints('lab', 'luna-orbit'), 3);
  assert.ok(B.sciencePoints('lab', 'mars-orbit') > 3);
  assert.equal(B.sciencePoints('science', 'luna-orbit', [{ type: 'lab' }, { type: 'rover', damaged: true }]), 4);
  assert.equal(B.sciencePoints('lab', 'luna-orbit', [], true), 1);
  assert.equal(B.sciencePoints('fuel', 'brontes-orbit'), 0);
  // a whole Luna base earns a good part of the tree, not all of it
  const luna = S.MISSIONS.reduce((a, t, i) => a + B.sciencePoints(t, 'luna-orbit', S.MISSIONS.slice(0, i).map((type) => ({ type }))), 0);
  const all = B.RESEARCH.reduce((a, n) => a + n.cost, 0);
  assert.ok(luna > all / 3 && luna < all, `${luna} of ${all}`);
  // old saves keep what their modules unlocked
  assert.deepEqual(B.migratedResearch(new Set(['depot'])), ['tanks.large']);
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
