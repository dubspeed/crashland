import * as THREE from 'three';
import * as S from './sim.js';
import { loadModels } from './models.js';
import { createWorld } from './world.js';
import { createShip } from './ship.js';
import { createDebris } from './debris.js';
import { createHud } from './hud.js';

const $ = (id) => document.getElementById(id);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
const hud = createHud();

// ---------- game state ----------
let planet = S.PLANETS[0];
let s = S.createState(planet);
let mode = 'menu'; // menu | flight | end
let endTimer = 0;
const input = { thrust: false, rcs: 0, limitDir: 0 };
const keys = new Set();
let showCom = true;
let cam = { yaw: 0.35, dist: 28, shake: 0 };

function best(id) { try { return JSON.parse(localStorage.getItem(`crashland.best.${id}`)); } catch { return null; } }
function saveBest(id, v) { try { localStorage.setItem(`crashland.best.${id}`, JSON.stringify(v)); } catch { /* storage unavailable */ } }

function buildMenu() {
  const wrap = $('planets');
  wrap.innerHTML = '';
  for (const p of S.PLANETS) {
    const b = document.createElement('button');
    b.className = 'planet';
    const rec = best(p.id);
    const sky = '#' + new THREE.Color(p.ground).getHexString(), sky2 = '#' + new THREE.Color(p.ground2).getHexString();
    b.innerHTML = `<span class="orb" style="background: radial-gradient(circle at 35% 30%, ${sky}, ${sky2} 70%)"></span>
      <b>${p.name}</b><span class="g">${p.g.toLocaleString('de-DE')} m/s² · ${(p.g / S.G0).toLocaleString('de-DE', { maximumFractionDigits: 2 })} g</span>
      <p>${p.text}</p><p>Start: ${p.alt} m · ${-p.vy} m/s</p>
      <span class="best">${rec ? `Bestwert: ${'★'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)} · ${rec.score} Punkte` : ''}</span>`;
    b.addEventListener('click', () => start(p));
    wrap.append(b);
  }
}

function showMenu() {
  mode = 'menu';
  $('menu').hidden = false; $('result').hidden = true; $('hud').hidden = true;
  buildMenu();
  // ship parked on the pad as a backdrop
  debris.clear(); ship.reset();
  s = S.createState(planet); s.y = 0; s.vy = 0; s.vx = 0; s.a = 0; s.status = 'parked';
  ship.update(s, 0);
}

function start(p) {
  if (p !== planet || !world.ready) { planet = p; world.setPlanet(p); world.ready = true; }
  debris.clear(); ship.reset();
  s = S.createState(planet);
  mode = 'flight';
  $('menu').hidden = true; $('result').hidden = true; $('hud').hidden = false;
  ship.helpers.visible = showCom;
}

function rate(st) {
  if (st.status !== 'landed') return { stars: 0, score: 0 };
  const fuelPct = S.fuel(st) / (2 * S.FUEL_MAX);
  let stars = 1;
  if (st.touch.vy <= 2.0) stars++;
  if (st.gOverTime < 0.5 && fuelPct >= 0.15) stars++;
  const score = Math.round(fuelPct * 1000 + (S.LAND.vy - st.touch.vy) * 150 + (S.LAND.tilt - st.touch.tilt) * 15 + (st.gOverTime < 0.5 ? 200 : 0) + (st.planet.g * 20));
  return { stars, score };
}

function finish() {
  mode = 'end';
  const ok = s.status === 'landed';
  if (!ok) { debris.explode(ship, s); cam.shake = 1.2; }
  endTimer = ok ? 1.0 : 2.2;
}

function showResult() {
  const ok = s.status === 'landed';
  const { stars, score } = rate(s);
  $('r-kicker').textContent = `${planet.name} · ${planet.g.toLocaleString('de-DE')} m/s²`;
  $('r-title').textContent = ok ? 'Gelandet' : 'Bruchlandung';
  $('r-title').style.color = ok ? 'var(--ok)' : 'var(--bad)';
  $('r-reason').textContent = ok
    ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  ${score} Punkte`
    : `Aufschlag: ${s.reason}.`;
  const f1 = (n) => n.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const rows = [
    ['Aufsetzen', `${f1(s.touch.vy)} m/s (max ${S.LAND.vy})`],
    ['Drift', `${f1(s.touch.vx)} m/s (max ${S.LAND.vx})`],
    ['Neigung', `${f1(s.touch.tilt)}° (max ${S.LAND.tilt})`],
    ['Treibstoff übrig', `${Math.round(S.fuel(s))} kg (${Math.round((S.fuel(s) / (2 * S.FUEL_MAX)) * 100)} %)`],
    ['Max. G-Last', `${f1(s.maxG)} g${s.gOverTime > 0.5 ? ` · ${f1(s.gOverTime)} s über Limit` : ''}`],
    ['Batterie', `${Math.round(s.battery)} %`],
    ['Flugzeit', `${f1(s.t)} s`],
  ];
  $('r-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  if (ok) {
    const prev = best(planet.id);
    if (!prev || score > prev.score) saveBest(planet.id, { stars, score });
  }
  $('result').hidden = false;
  $('r-again').focus();
}

// ---------- input ----------
addEventListener('keydown', (e) => {
  if (e.repeat && !['Space'].includes(e.code)) return;
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyR' && mode !== 'menu') start(planet);
  if ((e.code === 'KeyM' || e.code === 'Escape') && mode !== 'menu') showMenu();
  if (mode !== 'flight') return;
  if (e.code === 'KeyT') cycleSas();
  if (e.code === 'KeyF') cycleFeed();
  if (e.code === 'KeyC') toggleCom();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const hold = { thrust: false, left: false, right: false };
function bindHold(id, key) {
  const el = $(id);
  const on = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); hold[key] = true; };
  const off = () => { hold[key] = false; };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('lostpointercapture', off);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindHold('c-thrust', 'thrust'); bindHold('c-left', 'left'); bindHold('c-right', 'right');
$('c-limit').addEventListener('input', (e) => { s.limit = e.target.value / 100; });
function cycleSas() { s.sas = { retro: 'up', up: false }[s.sas] ?? 'retro'; }
function cycleFeed() { s.feed = { LR: 'L', L: 'R', R: 'LR' }[s.feed]; }
function toggleCom() { showCom = !showCom; ship.helpers.visible = showCom; $('c-com').classList.toggle('on', showCom); }
$('c-sas').addEventListener('click', cycleSas);
$('c-feed').addEventListener('click', cycleFeed);
$('c-com').addEventListener('click', toggleCom);
$('c-com').classList.add('on');
$('r-again').addEventListener('click', () => start(planet));
$('r-menu').addEventListener('click', showMenu);

// camera orbit by dragging the canvas, zoom with the wheel
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = e.clientX; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => { if (drag !== null) { cam.yaw -= (e.clientX - drag) * 0.006; drag = e.clientX; } });
renderer.domElement.addEventListener('wheel', (e) => { cam.dist = Math.min(90, Math.max(12, cam.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- loop ----------
const timer = new THREE.Timer();
let acc = 0, time = 0;
const focus = new THREE.Vector3();
const STEP = 1 / 120;

let autopilot = null; // optional (state) => {thrust, rcs}, used by automated tests
function readInput(dt) {
  if (autopilot) { Object.assign(input, autopilot(s)); return; }
  input.thrust = keys.has('Space') || hold.thrust;
  const l = keys.has('KeyA') || keys.has('ArrowLeft') || hold.left;
  const r = keys.has('KeyD') || keys.has('ArrowRight') || hold.right;
  input.rcs = (l ? 1 : 0) - (r ? 1 : 0);
  const up = keys.has('KeyW') || keys.has('ArrowUp'), down = keys.has('KeyS') || keys.has('ArrowDown');
  if (up || down) s.limit = Math.min(1, Math.max(0, s.limit + (up ? 0.6 : -0.6) * dt));
}

renderer.setAnimationLoop(() => {
  timer.update();
  const raw = timer.getDelta();
  const dt = Math.min(raw, 0.05);
  time += dt;

  if (mode === 'flight') {
    readInput(dt);
    acc += dt;
    while (acc >= STEP) { S.step(s, input, STEP); acc -= STEP; }
    if (s.status !== 'flying') finish();
  } else if (mode === 'end' && endTimer > 0) {
    endTimer -= raw;
    if (endTimer <= 0) showResult();
  }
  if (mode === 'menu') cam.yaw += dt * 0.12;

  ship.update(s, time);
  debris.update(dt);
  if (mode !== 'menu') hud.update(s, input);

  // chase camera
  focus.set(s.x, s.y + 2.5, 0);
  const dist = mode === 'menu' ? 22 : cam.dist;
  camera.position.set(focus.x + Math.sin(cam.yaw) * dist, focus.y + dist * 0.16, Math.cos(cam.yaw) * dist);
  const minY = S.terrainHeight(camera.position.x, camera.position.z) + 1.5;
  if (camera.position.y < minY) camera.position.y = minY;
  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt);
    camera.position.add(new THREE.Vector3().randomDirection().multiplyScalar(cam.shake * 0.8));
  }
  camera.lookAt(focus);
  world.update(camera, focus, time);
  renderer.render(scene, camera);
});

world.setPlanet(planet); world.ready = true;
showMenu();

// handle for automated tests
window.__crashland = { get state() { return s; }, start: (i) => start(S.PLANETS[i]), input, S, get mode() { return mode; }, setAutopilot(f) { autopilot = f; } };
