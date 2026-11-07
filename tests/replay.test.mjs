// Replays and the golden snapshot: a recorded flight replays bit-identically, and the fixed reference
// flights below end exactly where they did when golden.json was written. A physics change shows up here;
// if it was intended, refresh with:  UPDATE_GOLDEN=1 npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as S from '../src/sim.js';
import { makePilot } from './pilots.mjs';
import { recordPilot, replay, summary } from './replay-lib.mjs';

const GOLDEN = new URL('./golden.json', import.meta.url);

test('a recorded flight replays bit-identically (incl. wind, chute, panels, limiter)', () => {
  const P = S.ORBIT_PLANETS[3];
  const { record } = recordPilot(P, 2, 9, makePilot(S, P, {}));
  assert.ok(record.ev.length > 100);
  assert.deepEqual(summary(replay(JSON.parse(JSON.stringify(record)))), record.result);
});

const REFERENCE = [
  ['luna', 'retro2', 0, 3], ['luna', 'hold', 0, 3], ['mars', 'hold', 2, 7], ['terra', 'retro2', 3, 4],
  ['terra', 'hold', 0, 8], ['brontes', 'retro2', 1, 2],
  ['luna-orbit', null, 0, 1], ['mars-orbit', null, 2, 1], ['terra-orbit', null, 1, 1], ['brontes-orbit', null, 0, 1],
];
test('golden snapshot: reference flights end exactly as recorded', () => {
  const now = {};
  for (const [id, mode, wind, seed] of REFERENCE) {
    const P = [...S.PLANETS, ...S.ORBIT_PLANETS].find((p) => p.id === id);
    now[`${id} ${mode ?? 'orbit'} wind${wind} seed${seed}`] = recordPilot(P, wind, seed, makePilot(S, P, { mode: mode ?? undefined })).record.result;
  }
  if (process.env.UPDATE_GOLDEN || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
    return;
  }
  const want = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  for (const k of Object.keys(now)) assert.deepEqual(now[k], want[k], `${k} changed`);
});
