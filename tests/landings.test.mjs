// Every level is landable by following the HUD: the autopilots in pilots.mjs only use player controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';
import { makePilot } from './pilots.mjs';
import { recordPilot } from './replay-lib.mjs';

const fly = (P, opts = {}, seed = 5) => recordPilot(P, opts.wind ?? 0, seed, makePilot(S, P, opts), 600, opts.settings ?? {}).s;
const dist = (s) => Math.hypot(s.x, s.z);
function landedClean(s, maxD, label) {
  assert.equal(s.status, 'landed', `${label}: ${s.status} ${s.reason}`);
  assert.ok(dist(s) < maxD, `${label}: ${dist(s).toFixed(1)} m from the pad (max ${maxD})`);
  assert.equal(Object.keys(s.lost).length, 0, `${label}: lost ${Object.keys(s.lost)}`);
  assert.ok(s.crew.every((c) => !c.fainted), `${label}: crew fainted`);
  assert.ok(S.fuel(s) > 10, `${label}: fuel ${S.fuel(s).toFixed(0)}`);
}

for (const id of ['luna', 'mars', 'terra']) {
  test(`normal level ${id}: Retro 2 pilot lands on the pad`, () => {
    const P = S.PLANETS.find((p) => p.id === id);
    for (const seed of [3, 11, 29]) landedClean(fly(P, { mode: 'retro2' }, seed), 8, `${id} seed ${seed}`);
  });
}
test('normal level terra with medium wind lands', () => {
  landedClean(fly(S.PLANETS[2], { mode: 'retro2', wind: 2 }, 11), 10, 'terra wind');
});

const ORB = Object.fromEntries(S.ORBIT_PLANETS.map((p) => [p.id, p]));
// default settings: hints on, fine control by hand (the pilot follows the fine-control hint)
for (const [id, maxD] of [['luna-orbit', 25], ['mars-orbit', 25], ['terra-orbit', 20], ['brontes-orbit', 40]]) {
  test(`orbit level ${id}: following the cue lands on the pad`, () => landedClean(fly(ORB[id]), maxD, id));
}
test('orbit levels: braking a bit early or late still lands', () => {
  for (const id of Object.keys(ORB)) {
    landedClean(fly(ORB[id], { offset: 3, dD: -1500 }), 200, `${id} early`);
    landedClean(fly(ORB[id], { offset: -1, dD: 1500 }), 200, `${id} late`);
  }
});
test('thick-air re-entry: engine-first shield keeps every part', () => {
  for (const id of ['terra-orbit', 'brontes-orbit']) {
    const s = fly(ORB[id]);
    assert.ok(Math.max(...Object.values(s.temp)) < 600, `${id}: hottest ${Math.max(...Object.values(s.temp)).toFixed(0)} °C`);
  }
});
test('Mars orbit lands with medium wind', () => landedClean(fly(ORB['mars-orbit'], { wind: 2 }), 120, 'mars wind'));

test('settings: the optional automatic fine control puts thick-air re-entries within a few metres', () => {
  for (const id of ['terra-orbit', 'brontes-orbit']) landedClean(fly(ORB[id], { settings: { autoFine: true } }), 10, `${id} auto`);
});
test('settings: scarce fuel (75 %) is still enough when following the HUD', () => {
  for (const id of ['terra-orbit', 'brontes-orbit']) {
    const s = fly(ORB[id], { settings: { fuel: 0 } });
    assert.equal(s.fuel0, ORB[id].fuel * 0.75);
    assert.equal(s.status, 'landed', `${id}: ${s.reason}`);
  }
});
test('settings: plenty of fuel scales the tanks', () => {
  const s = S.newRound(S.PLANETS[0], 0, 1, { fuel: 2 });
  assert.equal(s.fuel0, S.PLANETS[0].fuel * 1.25);
  assert.equal(s.fuelL + s.fuelR, s.fuel0);
});

// base missions start on an orbit that runs past the base: a sideways burn (Seite) at the cheapest point,
// then the usual braking; the pilot lands on the pad from both sides
for (const P of S.ORBIT_PLANETS) {
  test(`missed orbit on ${P.id}: Seite swings the plane over the base, then it lands`, () => {
    for (const sign of [1, -1]) {
      const set = { orbit: S.missOrbit(P, sign) }, PP = { ...P, ...set.orbit };
      const s0 = S.newRound(P, 0, 5, set, {});
      const tm = S.trackMiss(s0);
      assert.ok(Math.abs(Math.abs(tm.miss) - Math.abs(set.orbit.miss)) < 5, `miss ${tm.miss}`);
      assert.ok(tm.best > 5, 'the cheapest point is still ahead');
      const s = recordPilot(PP, 0, 5, makePilot(S, PP, { dropShield: 'hint' }), 1500, set, {}).s;
      landedClean(s, P.id === 'brontes-orbit' ? 40 : 30, `${P.id} ${sign}`);
    }
  });
}
