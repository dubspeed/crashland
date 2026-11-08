import * as THREE from 'three';
import * as S from './sim.js';
import { loadModels } from './models.js';
import { createWorld } from './world.js';
import { createShip } from './ship.js';
import { createDebris } from './debris.js';
import { createHud, setLabel } from './hud.js';
import { createOrbitMap } from './orbitmap.js';
import { createReentry } from './reentry.js';
import { createBuilder } from './builder.js';

const $ = (id) => document.getElementById(id);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
// resolution: phones start at 1.5x, then a simple governor lowers/raises it with the frame time
const coarse = matchMedia('(pointer: coarse)').matches;
const maxRatio = Math.min(devicePixelRatio, coarse ? 1.5 : 2);
let pixelRatio = maxRatio;
renderer.setPixelRatio(pixelRatio);
const perf = { acc: 0, n: 0 };
function governResolution(raw) {
  perf.acc += raw; perf.n++;
  if (perf.acc < 1) return;
  const avg = perf.acc / perf.n; perf.acc = 0; perf.n = 0;
  const next = avg > 0.024 ? Math.max(0.75, pixelRatio - 0.25) : avg < 0.015 ? Math.min(maxRatio, pixelRatio + 0.25) : pixelRatio;
  if (next !== pixelRatio) { pixelRatio = next; renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight); }
}
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 6000);

const models = await loadModels();
const world = createWorld(scene, models);
const ship = createShip(models);
scene.add(ship.group);
const debris = createDebris(scene);
const reentry = createReentry(scene);
const _hull = new THREE.Vector3();

// aiming aids on the ground: ring right below the lander, cross where it would hit if it kept falling
const markMat = new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false });
const belowRing = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.5, 32).rotateX(-Math.PI / 2), markMat);
const impact = new THREE.Group();
for (const r of [0, Math.PI / 2]) {
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.45).rotateX(-Math.PI / 2).rotateY(r + Math.PI / 4), new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }));
  bar.renderOrder = 20;
  impact.add(bar);
}
belowRing.renderOrder = 19;
scene.add(belowRing, impact);
function updateMarkers() {
  const on = mode === 'flight' && s.status === 'flying';
  belowRing.visible = impact.visible = on;
  if (!on) return;
  belowRing.position.set(s.x, S.terrainHeight(s.x, s.z) + 0.15, s.z);
  const alt = Math.max(0, S.altitude(s));
  // predicted touchdown without thrust (gravity, drag, wind, canopy), shared with the HUD compass
  // the forward integration is the costliest bit per frame: refresh it ~12 times a second
  // the prediction itself is refreshed inside the simulation step (S.advance); the orbit map's path is
  // computed here, a few times a second, only while the map is open
  if (orbitMap.visible && (s.predPathAt === undefined || time - s.predPathAt > 0.25 || time < s.predPathAt)) {
    s.predPath = []; S.predictImpact(s, s.predPath); s.predPathAt = time;
  }
  const pred = s.pred;
  impact.visible = !!pred;
  if (pred) world.toRender(pred.x, S.terrainHeight(pred.x, pred.z) + 0.2, pred.z, impact.position, impact.quaternion);
  const k = Math.min(6, 1 + alt / 120); // grow with height so it stays visible from above
  impact.scale.setScalar(k); belowRing.scale.setScalar(Math.min(4, 1 + alt / 200));
}
// screen marker above the lander when it is only a few pixels tall (zoomed-out views)
const shipMark = document.getElementById('ship-mark');
const markV = new THREE.Vector3();
function placeShipMark() {
  let show = mode === 'flight' && s.status === 'flying';
  if (show) {
    markV.set(s.x, s.y + 2.5, s.z);
    const depth = markV.distanceTo(camera.position);
    const px = (7 / (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * innerHeight; // lander height on screen
    markV.project(camera);
    show = px < 46 && markV.z < 1 && Math.abs(markV.x) < 1.05 && Math.abs(markV.y) < 1.05;
    if (show) {
      const x = (markV.x * 0.5 + 0.5) * innerWidth, y = (-markV.y * 0.5 + 0.5) * innerHeight;
      shipMark.style.transform = `translate(${x.toFixed(1)}px, ${(y - px * 0.5 - 6).toFixed(1)}px)`;
      shipMark.style.opacity = String(Math.min(1, (46 - px) / 16));
    }
  }
  if (shipMark.hidden === show) shipMark.hidden = !show;
}
let fogBase = 1400;
const hud = createHud();

// ---------- game state ----------
let planet = S.PLANETS[0];
let s = S.createState(planet);
let mode = 'menu'; // menu | flight | end
let endTimer = 0;
const input = { thrust: false, rcs: 0, limitDir: 0 };
const keys = new Set();
let showCom = true;
let cam = { yaw: 0.35, pitch: 0, dist: 28, shake: 0, view: 'chase' };
const VIEWS = { chase: 'Hinten', oblique: 'Schräg', target: 'Ziel', top: 'Oben' };
try { const v = localStorage.getItem('crashland.view'); if (VIEWS[v]) cam.view = v; } catch { /* storage unavailable */ }
function toggleView() {
  const order = Object.keys(VIEWS);
  cam.view = order[(order.indexOf(cam.view) + 1) % order.length];
  cam.tgtD = 0; cam.intro = 0; cam.tgt = null; cam.pitch = 0;
  try { localStorage.setItem('crashland.view', cam.view); } catch { /* storage unavailable */ }
  viewButton();
}
function viewButton() {
  const b = document.getElementById('c-view');
  setLabel(b, `Ansicht: ${VIEWS[cam.view]}`, 'V');
  b.classList.toggle('on', cam.view !== 'chase');
}
viewButton();

let windLevel = 0;
try { windLevel = Math.min(S.WIND_LEVELS.length - 1, Math.max(0, +localStorage.getItem('crashland.wind') || 0)); } catch { /* storage unavailable */ }
function setWind(i) {
  windLevel = i;
  try { localStorage.setItem('crashland.wind', String(i)); } catch { /* storage unavailable */ }
  buildMenu();
}
function buildWindSelect() {
  const box = $('wind-select');
  box.innerHTML = S.WIND_LEVELS.map((w, i) => `<button role="radio" aria-checked="${i === windLevel}" class="${i === windLevel ? 'on' : ''}" data-i="${i}">${w.name}${w.speed ? `<small>${w.speed} m/s · ×${w.bonus.toLocaleString('de-DE')}</small>` : '<small>ruhig</small>'}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setWind(+b.dataset.i)));
}
// difficulty settings besides the wind (start menu, remembered)
let settings = { ...S.DEFAULT_SETTINGS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('crashland.settings') || '{}')); } catch { /* defaults */ }
function setSetting(k, v) {
  settings[k] = v;
  try { localStorage.setItem('crashland.settings', JSON.stringify(settings)); } catch { /* storage unavailable */ }
  buildMenu();
}
function buildSettings() {
  const row = (id, opts, cur, key) => {
    const box = $(id);
    box.innerHTML = opts.map(([v, name, sub], i) => `<button role="radio" aria-checked="${v === cur}" class="${v === cur ? 'on' : ''}" data-i="${i}">${name}<small>${sub}</small></button>`).join('');
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setSetting(key, opts[+b.dataset.i][0])));
  };
  const x = (k) => `×${k.toLocaleString('de-DE')}`;
  row('fuel-select', S.FUEL_LEVELS.map((f, i) => [i, f.name, `${Math.round(f.k * 100)} % · ${x(f.bonus)}`]), settings.fuel, 'fuel');
  row('hint-select', [[true, 'An', 'Tipps im HUD'], [false, 'Aus', `nur Warnungen · ${x(S.HINTS_OFF_BONUS)}`]], settings.hints, 'hints');
  row('auto-select', [[false, 'Aus', 'Feinregelung von Hand'], [true, 'An', `Computer regelt · ${x(S.AUTO_FINE_BONUS)}`]], settings.autoFine, 'autoFine');
}
// ---------- lander builder ----------
let build = { ...S.DEFAULT_BUILD };
try { Object.assign(build, JSON.parse(localStorage.getItem('crashland.build') || '{}')); } catch { /* defaults */ }
const optName = (slot, id) => S.BUILD_SLOTS.find((x) => x.id === slot).options.find((o) => o.id === id)?.name ?? id;
function buildSummary() {
  const diff = S.BUILD_SLOTS.filter((sl) => build[sl.id] !== S.DEFAULT_BUILD[sl.id]).map((sl) => `${sl.name}: ${optName(sl.id, build[sl.id])}`);
  return diff.length ? diff.join(' · ') : 'Standard';
}
function setBuild(slot, id) {
  build[slot] = id;
  try { localStorage.setItem('crashland.build', JSON.stringify(build)); } catch { /* storage unavailable */ }
  if (mode === 'menu') parkShip();
  updateBuildBtn();
}
const updateBuildBtn = () => { $('build-btn').innerHTML = `Lander bauen<small>${buildSummary() === 'Standard' ? 'Standard' : 'Eigener Lander'}</small>`; };
// fullscreen 3D editor (src/builder.js); the start menu steps aside while it is open
const builder = createBuilder({
  S, ship, camera, canvas: renderer.domElement,
  getBuild: () => build,
  setBuild,
  resetBuild: () => { build = { ...S.DEFAULT_BUILD }; setBuild('engine', 'std'); },
  getFuelK: () => S.FUEL_LEVELS[settings.fuel]?.k ?? 1,
  onClose: () => { $('menu').hidden = false; buildMenu(); },
});
$('build-btn').addEventListener('click', () => { $('menu').hidden = true; cam.pitch = 0; builder.open(); });

/** score multiplier of the chosen settings (wind is applied separately, only where there is air) */
const settingsBonus = (set) => (S.FUEL_LEVELS[set.fuel]?.bonus ?? 1) * (set.hints ? 1 : S.HINTS_OFF_BONUS) * (set.autoFine ? S.AUTO_FINE_BONUS : 1);
const bestKey = (id) => `${id}${windLevel ? `.wind${windLevel}` : ''}${settings.fuel !== 1 ? `.fuel${settings.fuel}` : ''}${settings.hints ? '' : '.nohints'}${settings.autoFine ? '.auto' : ''}${buildSummary() === 'Standard' ? '' : '.b' + S.BUILD_SLOTS.map((sl) => build[sl.id]).join('-')}`;
function best(id) { try { return JSON.parse(localStorage.getItem(`crashland.best.${id}`)); } catch { return null; } }
function saveBest(id, v) { try { localStorage.setItem(`crashland.best.${id}`, JSON.stringify(v)); } catch { /* storage unavailable */ } }

// start: from the approach (normal levels) or from orbit; remembered
let fromOrbit = false;
try { fromOrbit = localStorage.getItem('crashland.orbit') === '1'; } catch { /* default */ }
$('start-select').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  fromOrbit = b.dataset.orbit === '1';
  try { localStorage.setItem('crashland.orbit', fromOrbit ? '1' : '0'); } catch { /* storage unavailable */ }
  buildMenu();
});
// difficulty: one summary button, the options fold out below it
$('diff-btn').addEventListener('click', () => { const d = $('diff'); d.hidden = !d.hidden; $('diff-btn').setAttribute('aria-expanded', String(!d.hidden)); });

function buildMenu() {
  const wrap = $('planets');
  wrap.innerHTML = '';
  buildWindSelect();
  buildSettings();
  updateBuildBtn();
  for (const b of $('start-select').querySelectorAll('button')) {
    const on = (b.dataset.orbit === '1') === fromOrbit;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
  }
  const bonus = (windLevel ? S.WIND_LEVELS[windLevel].bonus : 1) * settingsBonus(settings);
  const diff = [windLevel ? `Wind ${S.WIND_LEVELS[windLevel].name.toLowerCase()}` : '', settings.fuel !== 1 ? `Treibstoff ${S.FUEL_LEVELS[settings.fuel].name.toLowerCase()}` : '',
    settings.hints ? '' : 'ohne Hinweise', settings.autoFine ? 'Computer an' : ''].filter(Boolean);
  $('diff-btn').innerHTML = `Schwierigkeit${Math.abs(bonus - 1) > 0.001 ? ` <em>×${bonus.toLocaleString('de-DE', { maximumFractionDigits: 2 })}</em>` : ''}<small>${diff.length ? diff.join(' · ') : 'Standard'}</small>`;
  for (const p of fromOrbit ? S.ORBIT_PLANETS : S.PLANETS) {
    const b = document.createElement('button');
    b.className = 'planet';
    const rec = best(bestKey(p.id));
    const sky = '#' + new THREE.Color(p.ground).getHexString(), sky2 = '#' + new THREE.Color(p.ground2).getHexString();
    b.innerHTML = `<span class="orb" style="background: radial-gradient(circle at 35% 30%, ${sky}, ${sky2} 70%)"></span>
      <span class="pname"><b>${p.name.replace(' Orbit', '')}</b><span class="g">${(p.g / S.G0).toLocaleString('de-DE', { maximumFractionDigits: 2 })} g</span></span>
      <p>${p.text}</p>
      <span class="best">${rec ? `<i>${'★'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)}</i> ${rec.score.toLocaleString('de-DE')}` : `<span class="air">${p.rho > 0 ? `Luft: ${p.atmo}` : 'keine Luft'}</span>`}</span>`;
    b.addEventListener('click', () => start(p));
    wrap.append(b);
  }
}

function buildWindowInfo() {
  const L = S.LAND, f = (n) => n.toLocaleString('de-DE');
  $('window-info').innerHTML = `<h3>Landefenster (gilt auf allen Planeten)</h3>
    <span><b class="ok">Sanft</b> ≤ ${f(L.vy[0])} m/s · Drift ≤ ${f(L.vx[0])} · ≤ ${L.tilt[0]}°</span>
    <span><b class="warn">Hart</b> ≤ ${f(L.vy[1])} m/s · Drift ≤ ${f(L.vx[1])} · ≤ ${L.tilt[1]}°</span>
    <span><b style="color: var(--amber)">Fahrwerk beschädigt</b> ≤ ${f(L.vy[2])} m/s · Drift ≤ ${f(L.vx[2])} · ≤ ${L.tilt[2]}°</span>
    <span><b class="bad">Bruchlandung</b> ≤ ${f(S.WRECK_V)} m/s: Lander kaputt, kein Feuer, Crew überlebt</span>
    <span><b class="bad">Explosion</b> darüber, wenn noch Treibstoff in den Tanks ist</span>`;
}

function openHelp() { $('help').hidden = false; $('help-close').focus(); }
function closeHelp() { $('help').hidden = true; }
$('help-btn').addEventListener('click', openHelp);
$('help-close').addEventListener('click', closeHelp);
$('help').addEventListener('click', (e) => { if (e.target === $('help')) closeHelp(); });

function showMenu() {
  buildWindowInfo();
  mode = 'menu';
  $('menu').hidden = false; $('result').hidden = true; $('result-open').hidden = true; $('hud').hidden = true;
  buildMenu();
  debris.clear();
  parkShip();
}
/** ship parked on the pad as a backdrop (menu and builder) */
function parkShip() {
  s = S.createState(planet, { build });
  ship.reset(s.spec); s.x = 0; s.z = 0; s.y = 0; s.vy = 0; s.vx = 0; s.vz = 0; s.a = 0; s.b = 0; s.status = 'parked';
  ship.update(s, time);
}

// ---------- recording (replays) ----------
let rec = null, lastRec = null, forceSeed = null;
/** player / autopilot action: applied to the state and recorded at the current step */
function doAct(name) {
  if (mode !== 'flight' || s.status !== 'flying') return;
  rec?.ev.push([s.stepN ?? 0, 'a', name]);
  return S.act(s, name);
}
const q3 = (v) => Math.round((v || 0) * 1000) / 1000;
/** quantise this step's inputs (so the record is compact and the live flight equals the replay) and record
 *  whatever changed */
function recordStep() {
  input.rcs = q3(input.rcs); input.rcsZ = q3(input.rcsZ);
  s.limit = Math.round(s.limit * 1000) / 1000;
  const th = !!input.thrust;
  if (th !== lastRec.thrust || input.rcs !== lastRec.rcs || input.rcsZ !== lastRec.rcsZ) {
    rec.ev.push([s.stepN ?? 0, 'i', th ? 1 : 0, input.rcs, input.rcsZ]);
    lastRec.thrust = th; lastRec.rcs = input.rcs; lastRec.rcsZ = input.rcsZ;
  }
  if (s.limit !== lastRec.limit) { rec.ev.push([s.stepN ?? 0, 'l', s.limit]); lastRec.limit = s.limit; }
}
function flightRecord() {
  return { ...rec, steps: s.stepN ?? 0, result: { status: s.status, t: +s.t.toFixed(3), x: +s.x.toFixed(3), z: +s.z.toFixed(3), vy: +s.vy.toFixed(3), fuel: +S.fuel(s).toFixed(3) } };
}

function start(p) {
  if (p !== planet || !world.ready) {
    planet = p;
    const sr = S.surfaceR(p); // every planet is drawn as a sphere now; only orbit levels fly on a curved planet
    S.setupTerrain(p); // before the ground is built from the terrain
    world.setPlanet(p); world.ready = true; fogBase = scene.fog.far;
    camera.far = sr ? 45000 : 6000; camera.updateProjectionMatrix();
  }
  debris.clear(); ship.reset();
  // a round is fully determined by its seed and the recorded inputs (replays, see tests/replay.mjs)
  const seed = (forceSeed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  forceSeed = null;
  s = S.newRound(planet, windLevel, seed, settings, build);
  ship.reset(s.spec);
  rec = { v: 1, planet: planet.id, wind: windLevel, seed, settings: { ...settings }, build: { ...build }, ev: [] };
  lastRec = { thrust: false, rcs: 0, rcsZ: 0, limit: s.limit };
  hud.reset();
  cam.tgtD = 0; cam.intro = 0; cam.tgt = null; cam.pitch = 0;
  mode = 'flight';
  $('c-map').hidden = !p.orbit; toggleMap(false);
  $('menu').hidden = true; $('result').hidden = true; $('result-open').hidden = true; $('hud').hidden = false;
  ship.helpers.visible = showCom;
}

const PAD_RADIUS = 12;
function precision(st) {
  const d = Math.hypot(st.x, st.z);
  const [label, tone] = d <= 3 ? ['Volltreffer', 'ok'] : d <= PAD_RADIUS ? ['auf dem Pad', 'ok'] : d <= 40 ? ['knapp daneben', 'warn']
    : d <= 200 ? ['nah dran', 'warn'] : d <= 1000 ? ['daneben', 'amber'] : ['weit daneben', 'bad'];
  return { d, label, tone };
}
/** 300 for a bullseye, 150 on the pad, then fading with the distance (~70 at 100 m, ~35 at 200 m) */
function precisionBonus(st) { const { d } = precision(st); return d <= 3 ? 300 : d <= PAD_RADIUS ? 150 : 120 * Math.exp(-(d - PAD_RADIUS) / 160); }

function rate(st) {
  const mult = (st.planet.rho > 0 ? st.wind.bonus : 1) * settingsBonus(st.settings ?? settings);
  if (st.status !== 'landed') {
    // crashed, but the crew got out: no stars, but the crew, the aim and the planet still count
    if (!st.touch?.crash?.crew) return { stars: 0, score: 0, parts: [], mult: 1 };
    const parts = [['Crew', st.crew.length * 70], ['Ziel', precisionBonus(st)], ['Planet', st.planet.g * 20]];
    return { stars: 0, score: Math.round(parts.reduce((a, p) => a + p[1], 0) * mult), parts: parts.filter((p) => Math.round(p[1]) !== 0), mult };
  }
  const fuelPct = S.fuel(st) / st.fuel0;
  let stars = 3 - st.touch.grade;
  const fainted = st.crew.some((c) => c.fainted > 0);
  const lost = Object.keys(st.lost).length;
  if (fainted || fuelPct < 0.1 || lost) stars--;
  stars = Math.max(1, stars);
  // the score in parts (shown on the result screen); their sum times the bonus is the score
  const parts = [
    ['Treibstoff', fuelPct * 1000],
    ['Landung', (st.spec.land.vy[2] - st.touch.vy) * 60 + (st.spec.land.tilt[1] - st.touch.tilt) * 10 - st.touch.grade * 150],
    ['Ziel', precisionBonus(st)],
    ['Crew', st.crew.filter((c) => !c.fainted).length * 70],
    ['Planet', st.planet.g * 20],
    ['Schäden', -lost * 120],
  ];
  const base = parts.reduce((a, p) => a + p[1], 0);
  const score = Math.max(0, Math.round(base * mult));
  return { stars, score, parts: parts.filter((p) => Math.round(p[1]) !== 0), mult };
}

function finish() {
  mode = 'end';
  const ok = s.status === 'landed';
  if (!ok) { debris.explode(ship, s); cam.shake = s.touch.crash.kind === 'wreck' ? 0.4 : 0.5 + s.touch.energy; }
  else if (s.touch.grade >= 1) { debris.puff(ship, s, s.touch.grade); cam.shake = 0.15 * s.touch.grade; }
  if (ok && s.touch.grade === 2) ship.damageLegs();
  endTimer = ok ? 1.0 : 2.2;
}

function showResult() {
  const ok = s.status === 'landed';
  const { stars, score, parts, mult } = rate(s);
  const f1 = (n) => n.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  // kicker: where, and the difficulty bonus as one figure
  const bonus = (s.wind.speed && planet.rho > 0 ? s.wind.bonus : 1) * settingsBonus(s.settings);
  $('r-kicker').textContent = `${planet.name}${s.wind.speed && planet.rho > 0 ? ` · Wind ${s.wind.name}` : ''}${Math.abs(bonus - 1) > 0.001 ? ` · Bonus ×${bonus.toLocaleString('de-DE', { maximumFractionDigits: 2 })}` : ''}`;
  const g = s.touch.grade, crash = s.touch.crash;
  $('r-title').textContent = ok ? ['Butterweich gelandet', 'Gelandet', 'Harte Landung'][g]
    : !crash.crew ? 'Totalverlust' : crash.kind === 'wreck' ? 'Bruchlandung' : 'Explosion';
  $('r-title').style.color = ok ? S.GRADES[g].color : crash.kind === 'wreck' && crash.crew ? 'var(--amber)' : 'var(--bad)';
  // stars and points, with the best so far
  const prev = best(bestKey(planet.id));
  const record = score > 0 && (!prev || score > prev.score);
  $('r-score').innerHTML = `<span class="r-stars">${'<i class="on">★</i>'.repeat(stars)}${'<i>★</i>'.repeat(3 - stars)}</span>`
    + `<span class="r-pts"><b id="r-pts">0</b>Punkte</span>`
    + (record ? (prev ? '<em class="r-best new">Neuer Bestwert</em>' : '') : prev ? `<em class="r-best">Bestwert ${prev.score.toLocaleString('de-DE')}</em>` : '')
    // where the points come from, in one row
    + (parts.length ? `<span class="r-parts">${parts.map(([k, v]) => `<em class="${v < 0 ? 'neg' : ''}">${v < 0 ? '−' : '+'}${Math.abs(Math.round(v)).toLocaleString('de-DE')} <small>${k}</small></em>`).join('')}${
      Math.abs(mult - 1) > 0.001 ? `<em class="mult">×${mult.toLocaleString('de-DE', { maximumFractionDigits: 2 })} <small>Bonus</small></em>` : ''}</span>` : '');
  if (record) saveBest(bestKey(planet.id), { stars, score });
  // count the points up
  const pts = $('r-pts'), t0 = performance.now();
  const tick = () => { const k = Math.min(1, (performance.now() - t0) / 900); pts.textContent = Math.round(score * (1 - (1 - k) ** 3)).toLocaleString('de-DE'); if (k < 1) requestAnimationFrame(tick); };
  if (score) tick();
  $('r-reason').hidden = ok;
  if (!ok) $('r-reason').textContent = `Aufschlag: ${s.reason}.`;
  // six tiles: the touchdown window (coloured by grade) and how the flight went
  const tone = (k) => ['ok', 'warn', 'amber', 'bad'][k];
  const tile = (label, val, sub, cls = '') => `<div class="r-tile"><span>${label}</span><b class="${cls}">${val}</b><small class="${cls}">${sub}</small></div>`;
  const pr = precision(s), fuelPct = Math.round((S.fuel(s) / s.fuel0) * 100);
  const gr = s.touch.grades, gName = (k) => S.GRADES[k].name.split(' ')[0];
  $('r-tiles').innerHTML =
    tile('Aufsetzen', `${f1(s.touch.vy)}<u>m/s</u>`, gName(gr.vy), tone(gr.vy)) +
    tile('Drift', `${f1(s.touch.vx)}<u>m/s</u>`, gName(gr.vx), tone(gr.vx)) +
    tile('Neigung', `${Math.round(s.touch.tilt)}<u>°</u>`, gName(gr.tilt), tone(gr.tilt)) +
    tile('Ziel', `${pr.d < 10 ? f1(pr.d) : Math.round(pr.d).toLocaleString('de-DE')}<u>m</u>`, pr.label, pr.tone) +
    tile('Treibstoff', `${fuelPct}<u>%</u>`, `${Math.round(S.fuel(s))} kg übrig`, fuelPct < 10 ? 'bad' : fuelPct < 25 ? 'warn' : '') +
    tile('Max. G', `${f1(s.maxG)}<u>g</u>`, s.maxG > S.G_LIMIT ? 'zu hoch' : 'Crew ok', s.maxG > S.G_LIMIT ? 'bad' : '');
  // notes only for what went wrong (or the crash's outcome)
  const notes = [];
  if (!ok) notes.push(crash.crew ? ['Crew gerettet', 'ok'] : ['Crew verloren', 'bad']);
  if (!ok && crash.kind === 'explosion') notes.push([`${Math.round(crash.fuelBurned)} kg Treibstoff explodiert`, 'bad']);
  for (const c of s.crew) if (c.fainted) notes.push([`${c.name} ${c.fainted}× ohnmächtig`, 'warn']);
  for (const c of s.spec.comps) if (s.lost[c.id]) notes.push([`${c.name} verglüht`, 'bad']);
  if (s.chute === 'torn' || s.chute === 'burned') notes.push([`Fallschirm ${s.chute === 'torn' ? 'gerissen' : 'verglüht'}`, 'warn']);
  $('r-notes').innerHTML = notes.map(([t, c]) => `<em class="${c}">${t}</em>`).join('');
  $('r-notes').hidden = !notes.length;
  // don't pop up: offer a button so the scene can be looked at first
  $('result-open').innerHTML = `<b style="color:${$('r-title').style.color}">${$('r-title').textContent}</b>${ok ? ` ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : ''} · Ergebnis ansehen`;
  $('result-open').hidden = false;
}

// ---------- input ----------
addEventListener('keyup', (e) => { if (e.code === 'Space' && mode === 'flight') e.preventDefault(); });
addEventListener('keydown', (e) => {
  if (e.repeat && !['Space'].includes(e.code)) return;
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyR' && mode !== 'menu') start(planet);
  if (e.code === 'Escape' && !$('help').hidden) { closeHelp(); return; }
  if ((e.code === 'KeyH' || e.code === 'F1') && mode === 'menu') { e.preventDefault(); openHelp(); }
  if ((e.code === 'KeyM' || e.code === 'Escape') && mode !== 'menu') showMenu();
  if (mode !== 'flight') return;
  if (e.code === 'KeyT') cycleSas();
  if (e.code === 'KeyV') toggleView();
  if (e.code === 'KeyK') toggleMap();
  if (e.code === 'F3') { e.preventDefault(); setDebug(!dbg.on); }
  const digit = /^(Digit|Numpad)(\d)$/.exec(e.code);
  if (digit) s.limit = digit[2] === '0' ? 1 : +digit[2] / 10;
  if (e.code === 'KeyP') doAct('chute');
  if (e.code === 'KeyE') doAct('panels');
  if (e.code === 'KeyJ') doAct('shield');
  if (e.code === 'KeyC') toggleCom();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// iOS: long presses would still select text or open the copy / share menu (also on the canvas)
const editable = (e) => e.target.closest?.('input, textarea, [contenteditable]');
addEventListener('selectstart', (e) => { if (!editable(e)) e.preventDefault(); });
addEventListener('contextmenu', (e) => { if (!editable(e)) e.preventDefault(); });
document.addEventListener('selectionchange', () => { const sel = getSelection(); if (sel && !sel.isCollapsed && !editable({ target: sel.anchorNode?.parentElement ?? document.body })) sel.removeAllRanges(); });

// ---------- touch / mouse controls ----------
// Each control tracks its own pointer, so lever and rotate pad work with two thumbs at once.
function bindPointer(el, onMove, onEnd) {
  let id = null;
  const move = (e) => { if (e.pointerId === id) { e.preventDefault(); onMove(e, el.getBoundingClientRect()); } };
  const end = (e) => { if (e.pointerId === id) { id = null; onEnd(); } };
  el.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    e.preventDefault(); id = e.pointerId;
    el.setPointerCapture?.(e.pointerId);
    onMove(e, el.getBoundingClientRect());
  });
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
const touch = { lever: false, px: 0, py: 0 };
bindPointer($('c-lever'), (e, r) => {
  touch.lever = true;
  // top 12 % snaps to full thrust so a quick thumb press near the top is 100 %
  const f = (r.bottom - e.clientY) / r.height;
  s.limit = Math.min(1, Math.max(0.05, f >= 0.88 ? 1 : f / 0.88));
}, () => { touch.lever = false; });
// tilt pad: two axes, relative to the screen (right / away from the camera); further out = faster
bindPointer($('c-rcs'), (e, r) => {
  const shape = (d) => (Math.abs(d) < 0.12 ? 0 : Math.max(-1, Math.min(1, (d - Math.sign(d) * 0.12) / 0.7)));
  touch.px = shape((e.clientX - (r.left + r.width / 2)) / (r.width / 2));
  touch.py = shape(((r.top + r.height / 2) - e.clientY) / (r.height / 2));
}, () => { touch.px = 0; touch.py = 0; });
function cycleSas() { doAct('sas'); }
function toggleCom() { showCom = !showCom; ship.helpers.visible = showCom; $('c-com').classList.toggle('on', showCom); }
$('c-sas').addEventListener('click', cycleSas);
$('c-chute').addEventListener('click', () => doAct('chute'));
$('c-view').addEventListener('click', toggleView);
$('c-panels').addEventListener('click', () => doAct('panels'));
$('c-shield').addEventListener('click', () => doAct('shield'));
$('c-com').addEventListener('click', toggleCom);
$('c-com').classList.add('on');
// ---------- debug overlay: F3, ?debug, or three taps on the title (phone) ----------
const dbg = { on: false, frames: 0, acc: 0, worst: 0, steps: 0, at: 0 };
function setDebug(on) { dbg.on = on; $('debug').hidden = !on; try { localStorage.setItem('crashland.debug', on ? '1' : ''); } catch { /* storage unavailable */ } }
try { if (new URLSearchParams(location.search).has('debug') || localStorage.getItem('crashland.debug')) setDebug(true); } catch { /* ignore */ }
let taps = [];
for (const el of document.querySelectorAll('.brand, #menu h1')) {
  el.addEventListener('pointerdown', () => {
    const now = performance.now(); taps = taps.filter((x) => now - x < 700); taps.push(now);
    if (taps.length >= 3) { taps = []; setDebug(!dbg.on); }
  });
}
function debugFrame(raw, steps) {
  if (!dbg.on) return;
  dbg.frames++; dbg.acc += raw; dbg.worst = Math.max(dbg.worst, raw); dbg.steps += steps;
  if (time - dbg.at < 0.5 && time >= dbg.at) return;
  const info = renderer.info.render, n = Math.max(1, dbg.frames);
  $('debug').textContent =
    `${(n / dbg.acc).toFixed(0)} fps  ${(dbg.acc / n * 1000).toFixed(1)} ms (max ${(dbg.worst * 1000).toFixed(0)})\n` +
    `${info.calls} calls  ${(info.triangles / 1000).toFixed(1)}k tris  ${world.stats().tiles} tiles\n` +
    `px ${renderer.getPixelRatio().toFixed(2)}  ${(dbg.steps / n).toFixed(1)} steps/frame  x${timeScale}\n` +
    `${planet.id}  seed ${rec?.seed ?? '-'}  t ${s.t.toFixed(1)}`;
  dbg.frames = 0; dbg.acc = 0; dbg.worst = 0; dbg.steps = 0; dbg.at = time;
}

// orbit map (orbit levels): K or the button
const orbitMap = createOrbitMap($('orbitmap'));
function toggleMap(force) {
  if (!planet.orbit) { orbitMap.visible = false; return; }
  orbitMap.visible = force ?? !orbitMap.visible;
  $('c-map').classList.toggle('on', orbitMap.visible);
}
$('c-map').addEventListener('click', () => toggleMap());
setLabel($('c-map'), 'Karte', 'K');
setLabel($('c-com'), 'Schwerpunkt', 'C');
// buttons never take keyboard focus: otherwise Space (thrust) or Enter would also "press" the last clicked button
for (const b of document.querySelectorAll('#controls .tog')) b.addEventListener('mousedown', (e) => e.preventDefault());
$('r-again').addEventListener('click', () => start(planet));
$('result-open').addEventListener('click', () => { $('result').hidden = false; $('result-open').hidden = true; $('r-again').focus(); });
$('r-close').addEventListener('click', () => { $('result').hidden = true; $('result-open').hidden = false; });
$('r-menu').addEventListener('click', showMenu);
// flight export (replay file): download, or copy if downloads are blocked
$('r-export').addEventListener('click', async () => {
  const json = JSON.stringify(flightRecord());
  const name = `crashland-${rec.planet}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  let ok = false;
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    ok = true;
  } catch { /* fall back to the clipboard */ }
  try { await navigator.clipboard.writeText(json); $('r-export').textContent = ok ? 'Exportiert und kopiert' : 'In die Zwischenablage kopiert'; }
  catch { $('r-export').textContent = ok ? 'Exportiert' : 'Export nicht möglich'; }
  setTimeout(() => { $('r-export').textContent = 'Flug exportieren'; }, 2500);
});

// camera orbit by dragging the canvas, zoom with the wheel
// sideways = around the lander, up/down = camera height (orbit pitch); only the finger that started on the canvas
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  cam.yaw -= (e.clientX - drag.x) * 0.006;
  cam.pitch = Math.max(-1.6, Math.min(1.6, cam.pitch + (e.clientY - drag.y) * 0.005));
  drag.x = e.clientX; drag.y = e.clientY;
});
// double tap / double click on the scene: back to the view's own camera height
renderer.domElement.addEventListener('dblclick', () => { cam.pitch = 0; });
renderer.domElement.addEventListener('wheel', (e) => {
  if (builder.active) return; cam.dist = Math.min(90, Math.max(12, cam.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- loop ----------
const timer = new THREE.Timer();
let acc = 0, time = 0;
const focus = new THREE.Vector3();
const STEP = S.STEP;
let timeScale = Math.max(1, Math.min(50, +(new URLSearchParams(location.search).get('speed')) || 1));

let autopilot = null; // optional (state) => {thrust, rcs}, used by automated tests
function readInput(dt) {
  if (autopilot) return; // the autopilot sets the inputs per simulation step
  input.thrust = keys.has('Space') || touch.lever;
  // tilt: WASD / arrows or the pad, in screen terms (px right, py away from the camera)
  const kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const ky = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const px = kx || touch.px, py = ky || touch.py;
  input.padX = px; input.padY = py;
  // screen direction -> world tilt direction (camera right / forward on the ground plane)
  const dxw = px * Math.cos(cam.yaw) - py * Math.sin(cam.yaw);
  const dzw = -px * Math.sin(cam.yaw) - py * Math.cos(cam.yaw);
  input.rcs = -dxw;  // roll: + tips the top to -x
  input.rcsZ = dzw;  // pitch: + tips the top to +z
  // thrust limiter: + / - (hold) or digits 1..9, 0 = 100 %
  const up = keys.has('Equal') || keys.has('NumpadAdd'), down = keys.has('Minus') || keys.has('NumpadSubtract');
  if (up || down) s.limit = Math.min(1, Math.max(0, s.limit + (up ? 0.6 : -0.6) * dt));
}

renderer.setAnimationLoop(() => {
  timer.update();
  const raw = timer.getDelta();
  governResolution(raw);
  const dt = Math.min(raw, 0.05);
  time += dt;

  if (mode === 'flight') {
    readInput(dt);
    acc += (timeScale > 1 ? Math.min(raw, 0.25) : dt) * timeScale; // fast-forward (tests): more steps per frame
    var stepsThisFrame = 0; // eslint-disable-line no-var
    while (acc >= STEP && s.status === 'flying') {
      stepsThisFrame++;
      if (autopilot) { const r = autopilot(s, doAct); if (r) Object.assign(input, r); }
      recordStep();
      S.advance(s, input);
      acc -= STEP;
    }
    if (s.status !== 'flying') acc = 0;
    for (const ev of s.events.splice(0)) {
      if (ev.type === 'lost') {
        const pos = ship.blowOff(ev.id, s);
        if (pos) { debris.burst(pos); cam.shake = Math.max(cam.shake, 0.35); }
      }
      if (ev.type === 'drop') { ship.drop(ev.id, s); cam.shake = Math.max(cam.shake, 0.12); } // pyro bolts: a short jolt
    }
    if (s.status !== 'flying') finish();
  } else if (mode === 'end' && endTimer > 0) {
    endTimer -= raw;
    if (endTimer <= 0) showResult();
  }
  if (mode === 'menu' && !builder.active) cam.yaw += dt * 0.12;

  builder.beforeUpdate();
  ship.update(s, time);
  builder.frame(s, dt, time);
  // re-entry glow around the hull centre, and the sky / haze by how much air is above
  reentry.update(s, _hull.set(s.x, s.y + 2.8, s.z), dt, time);
  if (planet.rho > 0) {
    const air = Math.pow(Math.min(1, S.density(s) / planet.rho), 0.35);
    const R = S.surfaceR(planet) || 1e7, h = Math.max(0, S.altitude(s));
    world.setAir(mode === 'menu' ? 1 : air, Math.acos(Math.min(1, R / (R + h))));
  }
  debris.update(dt);
  if (mode !== 'menu') hud.update(s, input, cam.yaw);

  // orbit level: turn the moon under the lander (frozen once it is down, so debris and wreck stay put)
  const sphere = S.surfaceR(planet) > 0;
  if (sphere && (s.status === 'flying' || mode === 'menu')) world.align(s.x, s.z, S.altitude(s));
  if (sphere) {
    const near = Math.min(3, Math.max(0.1, S.altitude(s) / 300));
    if (Math.abs(near - camera.near) > 0.05) { camera.near = near; camera.updateProjectionMatrix(); }
  } else if (camera.near !== 0.1) { camera.near = 0.1; camera.updateProjectionMatrix(); }
  updateMarkers();
  focus.set(s.x, s.y + 2.5, s.z);
  const dist = mode === 'menu' ? 22 : cam.dist * (camera.aspect < 0.8 ? 1.25 : 1);
  const view = mode === 'menu' ? 'chase' : cam.view;
  const fwdX = -Math.sin(cam.yaw), fwdZ = -Math.cos(cam.yaw); // screen-up direction on the ground (= tilt pad up)
  const lookAt = focus.clone();
  const alt = Math.max(0, S.altitude(s));
  camera.up.set(0, 1, 0);
  if (scene.fog) scene.fog.far = fogBase;
  if (view === 'top') {
    // overhead: straight down onto the lander, screen-up = the camera's forward direction (matches the tilt pad)
    camera.position.set(focus.x, focus.y + dist * 1.8, focus.z);
    camera.up.set(fwdX, 0, fwdZ);
    lookAt.y -= 10;
    scene.fog.far = fogBase + alt * 1.5 + dist * 2;
  } else if (view === 'oblique') {
    // behind and above, ~50 degrees down: the lander plus a good stretch of ground ahead
    const d = dist * 1.3;
    camera.position.set(focus.x - fwdX * d * 0.65, focus.y + d * 0.8, focus.z - fwdZ * d * 0.65);
    lookAt.set(focus.x + fwdX * d * 0.15, focus.y - d * 0.25, focus.z + fwdZ * d * 0.15);
    scene.fog.far = fogBase + alt + dist * 2;
  } else if (view === 'target') {
    // frame the lander and the predicted touchdown point (or the pad near the ground) together
    const raw = s.status === 'flying' && s.pred ? new THREE.Vector3(s.pred.x, 0, s.pred.z) : new THREE.Vector3(0, 0, 0);
    if (s.status !== 'flying') raw.set(s.x, 0, s.z);
    // close to the ground the prediction twitches with every short thrust pulse: lean on the spot below the lander
    const low = Math.min(1, alt / 40);
    raw.x = s.x + (raw.x - s.x) * low; raw.z = s.z + (raw.z - s.z) * low;
    // the prediction refreshes in steps (~12 Hz): follow it smoothly so the camera doesn't jerk
    if (!cam.tgt) cam.tgt = raw.clone();
    else cam.tgt.lerp(raw, 1 - Math.exp(-dt * 2.5));
    const tgt = world.toRender(cam.tgt.x, S.terrainHeight(cam.tgt.x, cam.tgt.z), cam.tgt.z, new THREE.Vector3());
    // intro: start close on the lander, then pull back over ~3 s until the touchdown point is in frame too
    cam.intro = Math.min(1, (cam.intro ?? 1) + dt / 3);
    const ik = cam.intro < 1 ? Math.max(0, (cam.intro - 0.25) / 0.75) : 1;
    const k = ik * ik * (3 - 2 * ik);
    const mid = focus.clone().lerp(tgt, 0.5 * k);
    const span = focus.distanceTo(tgt);
    // distance so both fit: narrow (portrait) screens need more room
    const fit = 1.15 / Math.min(1, camera.aspect * 1.3);
    const near = dist * 1.2;
    const d = near + (Math.max(near, span * fit + 20) - near) * k;
    cam.tgtD = cam.tgtD ? cam.tgtD + (d - cam.tgtD) * Math.min(1, dt * (cam.intro < 1 ? 8 : 4)) : d; // ease the zoom
    camera.position.set(mid.x - fwdX * cam.tgtD * 0.55, mid.y + cam.tgtD * 0.75, mid.z - fwdZ * cam.tgtD * 0.55);
    lookAt.copy(mid);
    scene.fog.far = fogBase + cam.tgtD * 3;
  } else {
    camera.position.set(focus.x + Math.sin(cam.yaw) * dist, focus.y + dist * 0.16, focus.z + Math.cos(cam.yaw) * dist);
  }
  // free orbit pitch from vertical swipes: swing the camera up/down around the point it looks at,
  // keeping the distance; the view's own height is the starting angle
  if (mode !== 'menu' && cam.pitch !== 0) {
    const off = camera.position.clone().sub(lookAt);
    const r = off.length(), h = Math.hypot(off.x, off.z);
    const bx = -fwdX, bz = -fwdZ; // horizontal "behind" direction (also defined for the straight-down top view)
    const e = Math.max(-0.12, Math.min(1.53, Math.atan2(off.y, h) + cam.pitch));
    const hx = h > 0.01 ? off.x / h : bx, hz = h > 0.01 ? off.z / h : bz;
    camera.position.set(lookAt.x + hx * r * Math.cos(e), lookAt.y + r * Math.sin(e), lookAt.z + hz * r * Math.cos(e));
    if (view === 'top') camera.position.set(lookAt.x + bx * r * Math.cos(e), lookAt.y + r * Math.sin(e), lookAt.z + bz * r * Math.cos(e));
  }
  // canopy goes see-through when looking down so it doesn't hide the cross and the lander
  ship.setCanopyAlpha(view === 'top' ? 0.25 : view === 'chase' ? 1 : 0.45);
  const minY = S.terrainHeight(camera.position.x, camera.position.z) + 1.5;
  if (camera.position.y < minY) camera.position.y = minY;
  // buffeting in dense, fast airflow (and while the canopy jerks)
  if (mode === 'flight' && s.status === 'flying' && s.q > 300) camera.position.add(_hull.randomDirection().multiplyScalar(Math.min(0.35, s.q / 25000)));
  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt);
    camera.position.add(new THREE.Vector3().randomDirection().multiplyScalar(cam.shake * 0.8));
  }
  if (builder.active) builder.placeCamera(s, cam.yaw, cam.pitch, dt, lookAt);
  camera.lookAt(lookAt);
  placeShipMark();
  if (mode === 'flight') orbitMap.draw(s);
  world.update(camera, focus, time, mode === 'menu' ? { x: 0, z: 0 } : { x: s.windX, z: s.windZ }, dt);
  renderer.render(scene, camera);
  debugFrame(raw, typeof stepsThisFrame === 'number' ? stepsThisFrame : 0);
});

world.setPlanet(planet); world.ready = true; fogBase = scene.fog.far;
showMenu();

// handle for automated tests
window.__crashland = { renderer, camera, cam, get state() { return s; }, exportFlight: flightRecord, act: doAct,
  setTimeScale(k) { timeScale = Math.max(1, Math.min(50, k)); }, setWind(i) { setWind(i); }, setSettings(o) { Object.assign(settings, o); }, get record() { return rec; }, startSeed(p, seed) { forceSeed = seed; start(p); }, start: (i) => start(i === 'orbit' ? S.ORBIT_PLANETS[0] : typeof i === 'string' ? S.ORBIT_PLANETS.find((p) => p.id === i) : S.PLANETS[i]), input, S, get mode() { return mode; }, setAutopilot(f) { autopilot = f; }, get world() { return world; }, builder, ship };
