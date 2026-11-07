#!/usr/bin/env node
// End-to-end run in the real game (headless Chromium): every level flown by the test autopilot at 10x
// speed, with the HUD messages logged, the orbit map opened once, console errors collected, and the
// exported flight replayed in node, which must end identically.
//   npm run e2e            (builds, serves dist/ on a free port, needs Playwright with Chromium)
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { replay, summary } from './replay-lib.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  try { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
  catch { console.error('Playwright not found (npm i -D playwright, or a global install)'); process.exit(1); }
}

const OUT = new URL('./e2e-out/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on('exit', stop);
for (let i = 0; i < 50; i++) {
  try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
}

// level id, wind, seed, HUD messages expected in this order (substrings). Only messages that last longer
// than a frame at 10x: the autopilot reacts within one step, so e.g. "FALLSCHIRM MÖGLICH" may never show.
const CASES = [
  ['terra', 0, 4, []],
  ['luna-orbit', 0, 1, ['BREMSEN IN', 'BREMSEN ·']],
  ['mars-orbit', 0, 1, ['BREMSEN IN', 'BREMSEN ·']],
  ['terra-orbit', 0, 1, ['BREMSEN IN', 'KURS STIMMT']],
  ['brontes-orbit', 0, 1, ['BREMSEN IN', 'KURS STIMMT']], // 'FÜR DEN SCHIRM' is hidden behind G and heat warnings
];
const pilotSrc = readFileSync(new URL('./pilots.mjs', import.meta.url), 'utf8').replace(/^export /m, '');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
let failures = 0;
for (const [id, wind, seed, expect] of CASES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/?speed=10`);
  await page.waitForFunction(() => window.__crashland);
  await page.evaluate(([id, wind, seed, src]) => {
    const c = window.__crashland, S = c.S;
    const P = [...S.PLANETS, ...S.ORBIT_PLANETS].find((p) => p.id === id);
    c.setWind(wind);
    c.startSeed(P, seed);
    const makePilot = new Function(`${src}; return makePilot;`)();
    c.setAutopilot(makePilot(S, P, {}));
    // log every HUD message with the sim time it appeared
    window.__alerts = [];
    const al = document.getElementById('alert');
    // one entry per kind of message (numbers ignored), so a countdown is logged once
    const kind = (txt) => txt.replace(/[\d.,:]+/g, '#');
    const log = () => { if (!al.hidden) { const txt = al.textContent; const last = window.__alerts.at(-1); if (!last || kind(last[1]) !== kind(txt)) window.__alerts.push([+c.state.t.toFixed(1), txt]); } };
    new MutationObserver(log).observe(al, { childList: true, characterData: true, subtree: true, attributes: true });
  }, [id, wind, seed, pilotSrc]);
  const t0 = Date.now();
  let mapShot = false;
  while (Date.now() - t0 < 6 * 60 * 1000) {
    const st = await page.evaluate(() => ({ t: window.__crashland.state.t, status: window.__crashland.state.status, orbit: !!window.__crashland.state.planet.orbit }));
    if (st.orbit && !mapShot && st.t > 30) {
      await page.keyboard.press('KeyK'); await page.waitForTimeout(400);
      await page.screenshot({ path: new URL(`${id}-map.png`, OUT).pathname });
      await page.keyboard.press('KeyK'); mapShot = true;
    }
    if (st.status !== 'flying') break;
    await page.waitForTimeout(250);
  }
  // the result window opens a few seconds after touchdown
  await page.waitForFunction(() => !document.getElementById('result').hidden || !document.getElementById('result-open').hidden, null, { timeout: 15000 }).catch(() => {});
  const res = await page.evaluate(() => ({ rec: window.__crashland.exportFlight(), alerts: window.__alerts, resultShown: !document.getElementById('result-open').hidden || !document.getElementById('result').hidden }));
  await page.screenshot({ path: new URL(`${id}-end.png`, OUT).pathname });
  await page.close();

  // checks
  const problems = [];
  const r = res.rec.result;
  if (r.status !== 'landed') problems.push(`status ${r.status}`);
  if (Math.hypot(r.x, r.z) > 30) problems.push(`${Math.hypot(r.x, r.z).toFixed(0)} m from the pad`);
  if (!res.resultShown) problems.push('no result shown');
  if (errors.length) problems.push(`console errors: ${errors.slice(0, 3).join(' | ')}`);
  let k = 0;
  for (const [, txt] of res.alerts) if (k < expect.length && txt.includes(expect[k])) k++;
  if (k < expect.length) problems.push(`HUD message missing or out of order: "${expect[k]}"`);
  const again = summary(replay(res.rec));
  if (JSON.stringify(again) !== JSON.stringify(r)) problems.push(`replay differs: ${JSON.stringify(again)} vs ${JSON.stringify(r)}`);
  failures += problems.length ? 1 : 0;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${id.padEnd(14)} ${r.status} ${Math.hypot(r.x, r.z).toFixed(1)} m, ${r.t.toFixed(0)} s sim in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${res.rec.ev.length} events${problems.length ? '\n     ' + problems.join('\n     ') : ''}`);
  console.log('     HUD: ' + res.alerts.map(([t, a]) => `${t}s ${a}`).join(' → ').slice(0, 600));
}
await browser.close();
stop();
console.log(failures ? `\n${failures} level(s) failed` : '\nall levels ok');
process.exit(failures ? 1 : 0);
