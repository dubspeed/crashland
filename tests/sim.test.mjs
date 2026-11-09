// Flight-model basics: determinism, orbit computer, terrain, chute safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';

test('a round is deterministic for the same seed and inputs', () => {
  const run = () => {
    const s = S.newRound(S.PLANETS[2], 2, 42);
    for (let i = 0; i < 120 * 40; i++) S.advance(s, { thrust: i % 300 < 120, rcs: Math.sin(i / 200), rcsZ: 0 });
    return [s.x, s.y, s.z, s.vx, s.vy, s.a, s.b, s.fuelL];
  };
  assert.deepEqual(run(), run());
});

test('different seeds give different wind', () => {
  const a = S.newRound(S.PLANETS[2], 3, 1), b = S.newRound(S.PLANETS[2], 3, 2);
  assert.notEqual(a.wind.heading, b.wind.heading);
});

test('orbit computer: apoapsis / periapsis match a simulated orbit', () => {
  S.setTerrainEdge(null);
  for (const P of [S.ORBIT_PLANETS[0], { ...S.ORBIT_PLANETS[0], g: 3.71, alt: 2500, rho: 0 }]) {
    const s = S.createState(P); s.vx -= 2; s.vy = 3;
    const o = S.orbitInfo(s);
    let mn = Infinity, mx = -Infinity, tmn = 0, tmx = 0;
    for (let i = 0; i < 120 * o.period; i++) {
      S.step(s, { thrust: false }, S.STEP);
      if (s.y < mn) { mn = s.y; tmn = s.t; }
      if (s.y > mx) { mx = s.y; tmx = s.t; }
    }
    assert.ok(Math.abs(mx - o.ap) < 1, `ap ${o.ap} vs ${mx}`);
    assert.ok(Math.abs(mn - o.pe) < 1, `pe ${o.pe} vs ${mn}`);
    assert.ok(Math.abs(tmx - o.tAp) < 1.5 && Math.abs(tmn - o.tPe) < 1.5, 'times');
  }
});

test('circular start orbit: ap = pe = start height, no impact predicted on vacuum orbits', () => {
  const s = S.newRound(S.ORBIT_PLANETS[0], 0, 1);
  const o = S.orbitInfo(s);
  assert.ok(Math.abs(o.ap - 1500) < 0.5 && Math.abs(o.pe - 1500) < 0.5 && o.e < 1e-6);
  assert.equal(S.predictImpact(s), null);
});

test('terrain: every planet surface is continuous and within sane heights', () => {
  for (const P of [...S.PLANETS, ...S.ORBIT_PLANETS]) {
    S.setupTerrain(P);
    let mn = Infinity, mx = -Infinity, jump = 0, prev = S.terrainHeight(-12000, 7);
    for (let x = -12000; x < 12000; x += 1) {
      const h = S.terrainHeight(x + 1, 7);
      jump = Math.max(jump, Math.abs(h - prev)); prev = h;
      mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    assert.ok(jump < 15, `${P.id}: step ${jump.toFixed(2)} m per m`);
    assert.ok(mn > -250 && mx < 500, `${P.id}: ${mn.toFixed(0)}..${mx.toFixed(0)}`);
    // the pad itself stays flat
    assert.equal(S.terrainHeight(0, 0), 0);
    assert.equal(S.terrainHeight(40, -30), 0);
  }
});

test('chute safety looks ahead: rising pressure near the limit is not safe', () => {
  const s = S.newRound(S.PLANETS[2], 0, 1);
  s.q = S.CHUTE_QMAX * 0.7; s.qRate = 0; assert.ok(S.chuteSafe(s));
  s.qRate = S.CHUTE_QMAX * 0.2; assert.ok(!S.chuteSafe(s));
  s.q = S.CHUTE_QMAX * 0.99; s.qRate = -100; assert.ok(!S.chuteSafe(s));
});

test('attitude modes: cycling through quickly only applies the mode it rests on', () => {
  const s = S.newRound(S.ORBIT_PLANETS[0], 0, 1);
  for (let i = 0; i < 240; i++) S.advance(s, { thrust: false }); // 2 s in, Retro
  assert.equal(s.sas, 'retro');
  const seen = new Set();
  for (const k of [0, 1, 2]) { S.act(s, 'sas'); for (let i = 0; i < 30; i++) { S.advance(s, { thrust: false }); seen.add(s.sas); } } // three taps, 0.25 s apart
  assert.deepEqual([...seen], ['retro']); // never Retro 2 or Senkrecht on the way
  for (let i = 0; i < Math.ceil(S.SAS_DELAY / S.STEP) + 2; i++) S.advance(s, { thrust: false });
  assert.equal(s.sas, false); // rests on "Aus"
});

test('Retro after an overshot braking burn turns upright calmly instead of spinning round', () => {
  const s = S.newRound(S.ORBIT_PLANETS[0], 0, 1);
  let maxW = 0, burning = true;
  for (let i = 0; i < 120 * 40; i++) {
    if (burning && s.vx < -3) burning = false; // braked a little too much: the velocity has reversed
    S.advance(s, { thrust: burning });
    if (!burning) maxW = Math.max(maxW, Math.abs(s.w));
    if (!burning && s.t > 200) break;
  }
  assert.ok(!burning, 'never overshot');
  assert.ok(maxW < 0.45, `turned at ${(maxW * 57.3).toFixed(0)}°/s`);
});

test('uneven ground: a bit too rough damages the gear, far too rough tips over', () => {
  const P = S.ORBIT_PLANETS[0];
  // find spots off the pad with the right roughness
  const s0 = S.newRound(P, 0, 1);
  const spots = { mid: null, bad: null };
  for (let x = -600; x < -100 && !(spots.mid && spots.bad); x += 1.3) for (let z = -300; z < 300 && !(spots.mid && spots.bad); z += 7.7) {
    const k = S.groundSpread(s0, x, z) / s0.spec.uneven;
    if (!spots.mid && k > 1.3 && k < 2) spots.mid = [x, z];
    if (!spots.bad && k > 3.5) spots.bad = [x, z];
  }
  for (const [name, want] of [['mid', 'landed'], ['bad', 'crashed']]) {
    const s = S.newRound(P, 0, 1); const [x, z] = spots[name];
    Object.assign(s, { x, z, y: S.terrainHeight(x, z) + 1.5, vx: 0, vy: -1.5, vz: 0, a: 0, b: 0, w: 0, wb: 0, sas: 'up' });
    for (let i = 0; i < 600 && s.status === 'flying'; i++) S.advance(s, { thrust: false });
    assert.equal(s.status, want, `${name}: ${s.reason}`);
    if (name === 'mid') assert.equal(s.touch.grade, 2);
  }
});
