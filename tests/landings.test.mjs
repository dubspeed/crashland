// Every level is landable by following the HUD: the autopilots in pilots.mjs only use player controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';
import { makePilot } from './pilots.mjs';
import { recordPilot } from './replay-lib.mjs';

const fly = (P, opts = {}, seed = 5) => recordPilot(P, opts.wind ?? 0, seed, makePilot(S, P, opts)).s;
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
for (const [id, maxD] of [['luna-orbit', 25], ['mars-orbit', 25], ['terra-orbit', 20], ['brontes-orbit', 15]]) {
  test(`orbit level ${id}: following the cue lands on the pad`, () => landedClean(fly(ORB[id]), maxD, id));
}
test('orbit levels: braking a bit early or late still lands', () => {
  for (const id of Object.keys(ORB)) {
    landedClean(fly(ORB[id], { offset: 3, dD: -1500 }), 120, `${id} early`);
    landedClean(fly(ORB[id], { offset: -1, dD: 1500 }), 120, `${id} late`);
  }
});
test('thick-air re-entry: engine-first shield keeps every part', () => {
  for (const id of ['terra-orbit', 'brontes-orbit']) {
    const s = fly(ORB[id]);
    assert.ok(Math.max(...Object.values(s.temp)) < 600, `${id}: hottest ${Math.max(...Object.values(s.temp)).toFixed(0)} °C`);
  }
});
test('Mars orbit lands with medium wind', () => landedClean(fly(ORB['mars-orbit'], { wind: 2 }), 120, 'mars wind'));
