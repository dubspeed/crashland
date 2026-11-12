// Replay a recorded flight (the JSON from "Flug exportieren" in the result window, or exportFlight()).
// A round is fully determined by planet, wind level, seed and the recorded events:
//   [step, 'a', name]           action before that step (chute, panels, sas)
//   [step, 'i', thrust, rcs, rcsZ]  inputs from that step on
//   [step, 't', tx, ty, tz]          RCS translation (docking) from that step on
//   [step, 'l', limit]          thrust limiter from that step on
import * as S from '../src/sim.js';

export function planetById(id) {
  return [...S.PLANETS, ...S.ORBIT_PLANETS].find((p) => p.id === id);
}

/** run the record; onStep(s, n) is called after every step (for logs). Returns the final state. */
export function replay(record, onStep) {
  const planet = planetById(record.planet);
  if (!planet) throw new Error(`unknown planet ${record.planet}`);
  const s = S.newRound(planet, record.wind, record.seed, record.settings ?? {}, record.build ?? {});
  const input = { thrust: false, rcs: 0, rcsZ: 0 };
  const ev = record.ev;
  let i = 0;
  const last = record.steps ?? Infinity;
  for (let n = 0; n < last && s.status === 'flying'; n++) {
    while (i < ev.length && ev[i][0] === n) {
      const e = ev[i++];
      if (e[1] === 'a') S.act(s, e[2]);
      else if (e[1] === 'i') { input.thrust = !!e[2]; input.rcs = e[3]; input.rcsZ = e[4]; }
      else if (e[1] === 't') { input.tx = e[2]; input.ty = e[3]; input.tz = e[4]; }
      else if (e[1] === 'l') s.limit = e[2];
    }
    S.advance(s, input);
    onStep?.(s, n);
  }
  return s;
}

/** the same summary the game stores in record.result */
export function summary(s) {
  return { status: s.status, t: +s.t.toFixed(3), x: +s.x.toFixed(3), z: +s.z.toFixed(3), vy: +s.vy.toFixed(3), fuel: +S.fuel(s).toFixed(3) };
}

/** fly a pilot (tests/pilots.mjs) like the game does and record it, without a browser */
export function recordPilot(planet, wind, seed, pilot, maxT = 600, settings = {}, build = {}) {
  const s = S.newRound(planet, wind, seed, settings, build);
  const record = { v: 1, planet: planet.id, wind, seed, settings: s.settings, build: s.spec.build, ev: [] };
  const input = { thrust: false, rcs: 0, rcsZ: 0 };
  const last = { thrust: false, rcs: 0, rcsZ: 0, limit: s.limit };
  const q3 = (v) => Math.round((v || 0) * 1000) / 1000;
  const act = (name) => { record.ev.push([s.stepN ?? 0, 'a', name]); return S.act(s, name); };
  while (s.status === 'flying' && s.t < maxT) {
    const r = pilot(s, act);
    if (r) Object.assign(input, r);
    input.rcs = q3(input.rcs); input.rcsZ = q3(input.rcsZ);
    s.limit = Math.round(s.limit * 1000) / 1000;
    const th = !!input.thrust;
    if (th !== last.thrust || input.rcs !== last.rcs || input.rcsZ !== last.rcsZ) {
      record.ev.push([s.stepN ?? 0, 'i', th ? 1 : 0, input.rcs, input.rcsZ]);
      last.thrust = th; last.rcs = input.rcs; last.rcsZ = input.rcsZ;
    }
    if (s.limit !== last.limit) { record.ev.push([s.stepN ?? 0, 'l', s.limit]); last.limit = s.limit; }
    input.tx = q3(input.tx); input.ty = q3(input.ty); input.tz = q3(input.tz);
    if (input.tx !== (last.tx ?? 0) || input.ty !== (last.ty ?? 0) || input.tz !== (last.tz ?? 0)) { record.ev.push([s.stepN ?? 0, 't', input.tx, input.ty, input.tz]); last.tx = input.tx; last.ty = input.ty; last.tz = input.tz; }
    S.advance(s, input);
  }
  record.steps = s.stepN;
  record.result = summary(s);
  return { record, s };
}
