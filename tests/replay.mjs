#!/usr/bin/env node
// Replay an exported flight ("Flug exportieren" in the result window) and print what happened.
//   npm run replay -- path/to/crashland-....json [--every 2]
import { readFileSync } from 'node:fs';
import * as S from '../src/sim.js';
import { replay, summary, planetById } from './replay-lib.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('usage: npm run replay -- flight.json [--every seconds]'); process.exit(1); }
const every = +(args[args.indexOf('--every') + 1]) || 5;
const rec = JSON.parse(readFileSync(file, 'utf8'));
const P = planetById(rec.planet);
console.log(`${P.name} · Wind ${S.WIND_LEVELS[rec.wind]?.name ?? rec.wind} · Seed ${rec.seed} · ${rec.ev.length} Ereignisse · ${(rec.steps / 120).toFixed(1)} s`);

const f = (v, d = 0) => (v ?? 0).toFixed(d);
const pad = (v, n) => String(v).padStart(n);
console.log(`${pad('t', 6)} ${pad('Höhe', 7)} ${pad('vy', 6)} ${pad('vh', 6)} ${pad('Schub', 5)} ${pad('Limit', 5)} ${pad('Neig.', 5)} ${pad('Fuel', 5)} ${pad('Bat', 4)} ${pad('Zum Pad', 8)}  Regler  Schirm  Paneele  Ereignisse`);
let nextLog = 0, lastEv = 0;
const evAt = new Map();
for (const e of rec.ev) if (e[1] === 'a') evAt.set(e[0], [...(evAt.get(e[0]) ?? []), e[2]]);
const lostSeen = new Set();
const s = replay(rec, (st, n) => {
  const notes = [];
  for (let k = lastEv; k <= n; k++) if (evAt.has(k)) notes.push(...evAt.get(k).map((a) => `[${a}]`));
  lastEv = n + 1;
  for (const id of Object.keys(st.lost)) if (!lostSeen.has(id)) { lostSeen.add(id); notes.push(`${id} verloren`); }
  for (const c of st.crew) if (c.out && !c.logged) { c.logged = true; notes.push(`${c.name} bewusstlos`); }
  if (st.t >= nextLog || notes.length || st.status !== 'flying') {
    if (st.t >= nextLog) nextLog += every;
    console.log(`${pad(f(st.t, 1), 6)} ${pad(f(S.altitude(st)), 7)} ${pad(f(st.vy, 1), 6)} ${pad(f(Math.hypot(st.vx, st.vz), 1), 6)} ${pad(f(st.throttle * 100) + '%', 5)} ${pad(f(st.limit * 100) + '%', 5)} ${pad(f(S.tiltDeg(st)) + '°', 5)} ${pad(f(S.fuel(st)), 5)} ${pad(f(st.battery), 4)} ${pad(f(Math.hypot(st.x, st.z)), 8)}  ${String(st.sas || 'aus').padEnd(7)} ${st.chute.padEnd(7)} ${st.panels.padEnd(8)} ${notes.join(' ')}`);
  }
});
const now = summary(s);
console.log(`\nErgebnis: ${s.status}${s.reason ? ' – ' + s.reason : ''}${s.touch ? ` · Sinkrate ${s.touch.vy.toFixed(1)} m/s · Drift ${s.touch.vx.toFixed(1)} m/s · Neigung ${s.touch.tilt.toFixed(0)}°` : ''}`);
if (rec.result) {
  const same = JSON.stringify(now) === JSON.stringify(rec.result);
  console.log(same ? 'Replay identisch mit dem gespielten Flug.' : `ABWEICHUNG zum gespielten Flug:\n  gespielt ${JSON.stringify(rec.result)}\n  replay   ${JSON.stringify(now)}`);
  process.exitCode = same ? 0 : 2;
}
