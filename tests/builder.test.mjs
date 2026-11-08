// Lander builder: every option does what it says, every build is flyable, replays include the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';
import { makePilot } from './pilots.mjs';
import { recordPilot, replay, summary } from './replay-lib.mjs';

const mass = (build, P = S.PLANETS[0]) => { const s = S.createState(P, { build, rnd: () => 0.5, windHeading: 0 }); return { s, m: S.massProps(s).m, dry: S.massProps(s).m - s.fuel0 }; };
const ALL = S.BUILD_SLOTS.flatMap((sl) => sl.options.filter((o) => o.id !== S.DEFAULT_BUILD[sl.id]).map((o) => ({ [sl.id]: o.id })));

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

test('every build lands where the builder shows no warning (and the warnings flag what fails)', () => {
  const levels = [...S.PLANETS.slice(0, 3), ...S.ORBIT_PLANETS];
  for (const b of ALL) {
    const w = S.buildWarnings(b, levels);
    for (const P of levels) {
      if (w.per[P.id]) continue; // warned: may be a challenge the test pilot can't do
      const { s } = recordPilot(P, 0, 5, makePilot(S, P, { dropShield: 'hint' }), 600, {}, b);
      assert.equal(s.status, 'landed', `${P.id} ${JSON.stringify(b)}: ${s.reason}`);
    }
  }
  // the classic challenges are flagged
  const all = [...S.PLANETS, ...S.ORBIT_PLANETS];
  assert.ok(S.buildWarnings({ solar: 'none' }, all).list.some((x) => /Kein Solar/.test(x.text)));
  assert.ok(S.buildWarnings({ engine: 'mini', capsule: 'hab', tanks: 'huge' }, all).list.some((x) => x.level === 'bad' && /zu schwach/.test(x.text)));
  assert.equal(S.buildWarnings({}, all).list.length, 0);
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
  assert.deepEqual(record.build, S.normalizeBuild(build));
  assert.deepEqual(summary(replay(JSON.parse(JSON.stringify(record)))), record.result);
});

test('the decoupler drops the heat shield: lighter, no damage, only once, recorded', () => {
  const P = S.ORBIT_PLANETS[2];
  const s = S.newRound(P, 0, 1, {}, { shield: 'shield' });
  const m0 = S.massProps(s).m;
  assert.equal(S.act(s, 'shield'), true);
  assert.equal(S.massProps(s).m, m0 - S.SHIELD.mass);
  assert.ok(!S.hasPart(s, 'shield') && s.dropped.shield && !s.lost.shield);
  assert.equal(S.act(s, 'shield'), false);
  assert.deepEqual(s.events.map((e) => e.type), ['drop']);
  const n = S.newRound(P, 0, 1, {}, {}); assert.equal(S.act(n, 'shield'), false); // nothing to drop
  const { record } = recordPilot(P, 0, 4, makePilot(S, P, { dropShield: 'hint' }), 600, {}, { shield: 'shield' });
  assert.ok(record.ev.some((e) => e[1] === 'a' && e[2] === 'shield'));
  assert.deepEqual(summary(replay(JSON.parse(JSON.stringify(record)))), record.result);
});

test('dropping the shield when the HUD says so is safe and saves fuel', () => {
  for (const P of [S.PLANETS[0], S.PLANETS[1], S.PLANETS[2], ...S.ORBIT_PLANETS]) {
    const keep = recordPilot(P, 0, 5, makePilot(S, P, {}), 600, {}, { shield: 'shield' }).s;
    const drop = recordPilot(P, 0, 5, makePilot(S, P, { dropShield: 'hint' }), 600, {}, { shield: 'shield' }).s;
    assert.ok(drop.dropped.shield, `${P.id}: hint never came`);
    assert.equal(drop.status, 'landed', `${P.id}: ${drop.reason}`);
    assert.deepEqual(Object.keys(drop.lost), [], `${P.id}: lost ${Object.keys(drop.lost)}`);
    assert.ok(S.fuel(drop) > S.fuel(keep), `${P.id}: fuel ${S.fuel(drop).toFixed(0)} vs ${S.fuel(keep).toFixed(0)}`);
  }
});

test('the hint waits for the re-entry: dropped at the start, the lander gets much hotter', () => {
  const P = S.ORBIT_PLANETS[3], peak = (opt) => {
    const base = makePilot(S, P, opt); let mx = 0;
    recordPilot(P, 0, 5, (s, act) => { mx = Math.max(mx, s.temp.engine, s.temp.tankL, s.temp.tankR); return base(s, act); }, 600, {}, { shield: 'shield' });
    return mx;
  };
  const early = peak({ dropShield: 1 }), hint = peak({ dropShield: 'hint' });
  assert.ok(early > hint * 1.3, `early ${early.toFixed(0)} °C vs hint ${hint.toFixed(0)} °C`);
});

test('attachment points: the standard build sits exactly where the original parts were, variants move what hangs on them', () => {
  const std = S.makeSpec();
  for (const c of S.COMPONENTS) assert.deepEqual(std.comps.find((k) => k.id === c.id).pos, c.pos, c.id);
  assert.deepEqual(S.makeSpec({ shield: 'shield' }).comps.find((c) => c.id === 'shield').pos, S.SHIELD.pos);
  assert.equal(std.footX, S.FOOT_X);
  const pos = (b, id) => S.makeSpec(b).comps.find((c) => c.id === id).pos;
  assert.ok(pos({ tanks: 'large' }, 'tankR')[0] > pos({}, 'tankR')[0] && pos({ tanks: 'small' }, 'tankR')[0] < pos({}, 'tankR')[0]);
  assert.ok(pos({ engine: 'eco', shield: 'shield' }, 'shield')[1] < S.SHIELD.pos[1]); // long bell: the shield sits lower
  assert.ok(pos({ chute: 'large' }, 'chute')[1] > pos({}, 'chute')[1]);
  assert.ok(S.makeSpec({ legs: 'wide' }).footX > S.FOOT_X && S.makeSpec({ legs: 'light' }).footX < S.FOOT_X);
  // bigger tanks further out: more inertia, the lander turns slower
  const I = (b) => S.massProps(S.createState(S.PLANETS[0], { build: b, rnd: () => 0.5, windHeading: 0 })).I;
  assert.ok(I({ tanks: 'large' }) > I({}));
  // wider feet: tilted, the low foot reaches further down
  const tiltAlt = (b) => { const s = S.createState(S.PLANETS[0], { build: b, rnd: () => 0.5, windHeading: 0 }); s.x = 0; s.z = 0; s.y = 10; s.a = 0.2; s.b = 0; return S.altitude(s); };
  assert.ok(tiltAlt({ legs: 'wide' }) < tiltAlt({}));
});

test('base building: cargo replaces the capsule, is damaged by g-load or a hard touchdown, modules are obstacles', () => {
  const P = S.PLANETS[0];
  const s = S.newRound(P, 0, 2, {}, { payload: 'lab' });
  assert.equal(s.crew.length, 0);
  assert.ok(!s.spec.ids.has('capsule') && s.spec.ids.has('payload'));
  assert.equal(S.gLimitOf(s), S.CARGO.lab.g * S.CARGO_MARGIN);
  // a cargo flight lands with the HUD pilot and the cargo intact
  const { s: f } = recordPilot(P, 0, 5, makePilot(S, P, {}), 600, {}, { payload: 'depot' });
  assert.equal(f.status, 'landed'); assert.equal(f.cargo, 'intact');
  // landing right on a module is a crash
  const near = recordPilot(P, 0, 5, makePilot(S, P, {}), 600, { base: { obstacles: [{ x: 0, z: 0, r: 8, name: 'Funkbake' }] } }, { payload: 'solar' }).s;
  assert.equal(near.status, 'crashed'); assert.match(near.reason, /Funkbake/); assert.equal(near.cargo, 'lost');
  // too much g for the fragile lab
  const lab = S.newRound(P, 0, 2, {}, { payload: 'lab' });
  for (let i = 0; i < 120; i++) { lab.gNow = 5; S.advance(lab, { thrust: true }); }
  assert.ok(lab.cargoDamaged);
  // bonuses of intact modules, slots apart from each other
  const bon = S.baseBonus([{ type: 'depot' }, { type: 'refinery' }, { type: 'lab', damaged: true }]);
  assert.ok(Math.abs(bon.fuel - 1.15 * 1.25) < 1e-9 && bon.score === 1);
  const slots = S.MISSIONS.map((_, k) => S.baseSlot(k));
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) assert.ok(Math.hypot(slots[i][0] - slots[j][0], slots[i][1] - slots[j][1]) > 10);
  // from orbit (base missions start there): the light, fragile lab gets through Brontes' thick air intact
  const PB = S.ORBIT_PLANETS[3];
  const { s: ob } = recordPilot(PB, 0, 5, makePilot(S, PB, {}), 900, {}, { payload: 'lab' });
  assert.equal(ob.status, 'landed'); assert.equal(ob.cargo, 'intact', `lab: ${ob.cargoDamaged}, max ${ob.maxG.toFixed(1)} g`);
  // replays carry the cargo and the base
  const { record } = recordPilot(P, 0, 6, makePilot(S, P, {}), 600, { base: { fuel: 1.15, obstacles: [{ x: 16, z: 3, r: 1.4, name: 'Treibstoffdepot' }] } }, { payload: 'rover' });
  assert.deepEqual(summary(replay(JSON.parse(JSON.stringify(record)))), record.result);
});
