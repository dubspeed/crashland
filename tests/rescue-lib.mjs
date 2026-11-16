// Rescue flights shared by the per-planet test files (one file each, so node --test runs them in parallel).
// FULL=1 (npm run test:full, CI): every lander / orbit combination; otherwise every orbit once, the landers
// taking turns, so each lander and each orbit type still flies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';
import * as B from '../src/base.js';
import * as R from '../src/rescue.js';
import { makePilot } from './pilots.mjs';
import { recordPilot } from './replay-lib.mjs';

import { FULL } from './env.mjs';
export { FULL };

/** the combos to fly: all (FULL), or each orbit once with the landers in turn */
export function pick(planetId) {
  const all = R.combos(planetId);
  if (FULL) return all;
  const landers = [...new Set(all.map(([l]) => l))], orbits = [...new Set(all.map(([, o]) => o))];
  return orbits.map((o, i) => {
    const ok = all.filter(([, oo]) => oo === o).map(([l]) => l);
    for (let k = 0; k < landers.length; k++) { const l = landers[(i + k) % landers.length]; if (ok.includes(l)) return [l, o]; }
    return null;
  }).filter(Boolean);
}

export function rescueSuite(planetId) {
  const P = S.ORBIT_PLANETS.find((p) => p.id === planetId);
  test(`rescue on ${P.id}: ${FULL ? 'every offered lander and orbit' : 'every orbit (landers in turn)'} lands`, () => {
    for (const [l, o] of pick(P.id)) {
      const L = R.LANDERS[l], set = { orbit: R.orbitFor(P, o), fuelMult: L.fuelK, site: B.BASE_SITES[P.id], target: R.targetFor(o) }, PP = { ...P, ...set.orbit };
      const { s } = recordPilot(PP, 0, 5, makePilot(S, PP, { dropShield: 'hint', apMax: R.ORBITS[o].aero ? P.aero.land : 0 }), 4000, set, L.build);
      const label = `${P.id} ${l} ${o}`;
      assert.equal(s.status, 'landed', `${label}: ${s.reason}`);
      assert.ok(Math.hypot(s.x, s.z) < 150, `${label}: ${Math.hypot(s.x, s.z).toFixed(0)} m off`);
      assert.equal(Object.keys(s.lost).length, 0, `${label}: lost ${Object.keys(s.lost)}`);
      assert.ok(S.fuel(s) > 5, `${label}: dry`);
      if (R.ORBITS[o].module) assert.ok(s.target.docked, `${label}: module not docked`);
    }
  });
}
