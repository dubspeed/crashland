// Rescue missions: every lander / orbit combination a planet offers is landable by following the HUD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';
import * as B from '../src/base.js';
import * as R from '../src/rescue.js';
import { makePilot } from './pilots.mjs';
import { recordPilot, replay, summary } from './replay-lib.mjs';
import { FULL } from './rescue-lib.mjs';

// (the flights per planet: rescue-<planet>.test.mjs, via rescue-lib.mjs)

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

test('meeting plans: from 4-8 km ahead / behind, higher / lower, a plan, the approach and docking work', () => {
  const P = S.ORBIT_PLANETS[0], L = R.LANDERS.shuttle;
  // (fast run: one of the four; FULL=1: all)
  for (const [phase, up] of [[0.55, 150], [0.6, -170], [-0.45, 120], [-0.4, -100]].slice(0, FULL ? 4 : 1)) {
    const set = { orbit: R.orbitFor(P, 'module'), fuelMult: L.fuelK, site: B.BASE_SITES[P.id], target: { type: 'module', phase, up } }, PP = { ...P, ...set.orbit };
    const s0 = S.newRound(P, 0, 5, set, L.build);
    const plans = [1, 2, 3].map((k) => S.meetPlan(s0, k));
    assert.ok(plans.some((m) => m.ok), `${phase} ${up}: no valid plan`);
    const { s } = recordPilot(PP, 0, 5, makePilot(S, PP, {}), 5000, set, L.build);
    assert.ok(s.target.docked, `${phase} ${up}: not docked`);
    assert.equal(s.status, 'landed', `${phase} ${up}: ${s.reason}`);
  }
});
