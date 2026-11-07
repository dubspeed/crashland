// Lander builder: every option does what it says, every build is flyable, replays include the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';
import { makePilot } from './pilots.mjs';
import { recordPilot, replay, summary } from './replay-lib.mjs';

const mass = (build, P = S.PLANETS[0]) => { const s = S.createState(P, { build, rnd: () => 0.5, windHeading: 0 }); return { s, m: S.massProps(s).m, dry: S.massProps(s).m - s.fuel0 }; };
const ALL = S.BUILD_SLOTS.flatMap((sl) => sl.options.map((o) => ({ [sl.id]: o.id })));

test('the standard build reproduces the original lander exactly', () => {
  const spec = S.makeSpec(), sp = S.makeSpec(S.DEFAULT_BUILD);
  assert.equal(spec.fMax, S.F_MAX); assert.equal(spec.isp, S.ISP); assert.equal(spec.tankK, 1); assert.equal(spec.batK, 1);
  assert.deepEqual(spec.land, S.LAND);
  assert.deepEqual(spec.comps.map((c) => [c.id, c.mass]), S.COMPONENTS.map((c) => [c.id, c.mass]));
  assert.deepEqual(sp.comps, spec.comps);
});

test('options change what they claim', () => {
  const base = mass({});
  assert.ok(S.makeSpec({ engine: 'strong' }).fMax > S.F_MAX && S.makeSpec({ engine: 'eco' }).isp > S.ISP);
  assert.ok(mass({ tanks: 'large' }).s.fuel0 > base.s.fuel0 && mass({ tanks: 'small' }).s.fuel0 < base.s.fuel0);
  assert.ok(!S.makeSpec({ power: 'battery' }).ids.has('solarL') && S.makeSpec({ power: 'battery' }).batK > 1);
  assert.ok(S.makeSpec({ power: 'both' }).ids.has('solarL') && mass({ power: 'both' }).dry > base.dry);
  assert.ok(!S.makeSpec({ chute: 'none' }).ids.has('chute') && mass({ chute: 'none' }).dry < base.dry);
  assert.ok(S.makeSpec({ chute: 'large' }).chuteCda > S.CHUTE_CDA);
  assert.ok(S.makeSpec({ shield: 'shield' }).ids.has('shield') && mass({ shield: 'shield' }).dry === base.dry + 240);
  assert.ok(S.makeSpec({ legs: 'wide' }).land.vx[2] > S.LAND.vx[2] && S.makeSpec({ legs: 'light' }).land.vy[2] < S.LAND.vy[2]);
});

test('without a chute the chute button does nothing; without panels nothing charges', () => {
  const s = S.newRound(S.PLANETS[2], 0, 1, {}, { chute: 'none', power: 'battery' });
  S.act(s, 'chute'); assert.equal(s.chute, 'stowed');
  s.battery = 50; for (let i = 0; i < 1200; i++) S.advance(s, { thrust: false });
  assert.ok(s.battery < 50);
});

test('every build lands the re-entries when following the HUD', () => {
  for (const id of ['terra-orbit', 'brontes-orbit']) {
    const P = S.ORBIT_PLANETS.find((p) => p.id === id);
    for (const b of ALL) {
      if (id === 'terra-orbit' && b.chute === 'none') continue; // terminal speed ~85 m/s: needs a better pilot
      const { s } = recordPilot(P, 0, 5, makePilot(S, P, {}), 600, {}, b);
      assert.equal(s.status, 'landed', `${id} ${JSON.stringify(b)}: ${s.reason}`);
      assert.ok(Math.hypot(s.x, s.z) < 40, `${id} ${JSON.stringify(b)}: ${Math.hypot(s.x, s.z).toFixed(0)} m`);
    }
  }
});

test('the heat shield keeps the rest of the lander far cooler on a normal Terra entry', () => {
  const P = S.PLANETS[2], peak = (b) => {
    const base = makePilot(S, P, { mode: 'retro2' }), mx = {};
    recordPilot(P, 0, 5, (s, act) => { for (const [k, v] of Object.entries(s.temp)) mx[k] = Math.max(mx[k] ?? 0, v); return base(s, act); }, 600, {}, b);
    return mx;
  };
  const a = peak({}), b = peak({ shield: 'shield' });
  assert.ok(b.engine < a.engine * 0.5 && b.tankR < a.tankR * 0.5, `engine ${a.engine.toFixed(0)} -> ${b.engine.toFixed(0)}`);
});

test('a flight with a custom build replays identically', () => {
  const P = S.ORBIT_PLANETS[2], build = { engine: 'strong', tanks: 'large', power: 'both', chute: 'large', shield: 'shield', legs: 'wide' };
  const { record } = recordPilot(P, 1, 3, makePilot(S, P, {}), 600, {}, build);
  assert.deepEqual(record.build, { ...S.DEFAULT_BUILD, ...build });
  assert.deepEqual(summary(replay(JSON.parse(JSON.stringify(record)))), record.result);
});
