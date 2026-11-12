// Rescue missions: every lander / orbit combination a planet offers is landable by following the HUD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';
import * as B from '../src/base.js';
import * as R from '../src/rescue.js';
import { makePilot } from './pilots.mjs';
import { recordPilot, replay, summary } from './replay-lib.mjs';

for (const P of S.ORBIT_PLANETS) {
  test(`rescue on ${P.id}: every offered lander and orbit lands`, () => {
    for (const [l, o] of R.combos(P.id)) {
      const L = R.LANDERS[l], set = { orbit: R.orbitFor(P, o), fuelMult: L.fuelK, site: B.BASE_SITES[P.id] }, PP = { ...P, ...set.orbit };
      const { s } = recordPilot(PP, 0, 5, makePilot(S, PP, { dropShield: 'hint', apMax: R.ORBITS[o].aero ? P.aero.land : 0 }), 4000, set, L.build);
      const label = `${P.id} ${l} ${o}`;
      assert.equal(s.status, 'landed', `${label}: ${s.reason}`);
      assert.ok(Math.hypot(s.x, s.z) < 150, `${label}: ${Math.hypot(s.x, s.z).toFixed(0)} m off`);
      assert.equal(Object.keys(s.lost).length, 0, `${label}: lost ${Object.keys(s.lost)}`);
      assert.ok(S.fuel(s) > 5, `${label}: dry`);
    }
  });
}

test('rescue scenarios: deterministic, varied, and the orbit override replays', () => {
  const P = S.ORBIT_PLANETS[0];
  assert.deepEqual(R.scenario(P, 3), R.scenario(P, 3));
  const seen = new Set(Array.from({ length: 30 }, (_, n) => { const sc = R.scenario(P, n); return `${sc.lander}:${sc.orbit}`; }));
  assert.ok(seen.size >= 8, `only ${seen.size} different scenarios`);
  for (let n = 0; n < 30; n++) assert.ok(!R.SKIP.has(`${P.id}:${R.scenario(P, n).lander}:${R.scenario(P, n).orbit}`));
  const sc = R.scenario(P, 1), set = { orbit: sc.orbitSet, fuelMult: sc.fuelK };
  const s = S.newRound(P, 0, 9, set, sc.build);
  assert.equal(s.y, sc.orbitSet.alt);
  assert.equal(s.x, -sc.orbitSet.downrange);
  const { s: flown, record } = recordPilot({ ...P, ...sc.orbitSet }, 0, 9, makePilot(S, { ...P, ...sc.orbitSet }, {}), 900, set, sc.build);
  assert.deepEqual(summary(replay(record)), summary(flown));
});
