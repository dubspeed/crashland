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

// aiming aids on the ground: ring right below the lander, cross where it would hit if it kept falling
const markMat = new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.85, depthWrite: false });
const belowRing = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.5, 32).rotateX(-Math.PI / 2), markMat);
const impact = new THREE.Group();
for (const r of [0, Math.PI / 2]) {
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.45).rotateX(-Math.PI / 2).rotateY(r + Math.PI / 4), new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.9, depthWrite: false }));
  impact.add(bar);
}
scene.add(belowRing, impact);
function updateMarkers() {
  const on = mode === 'flight' && s.status === 'flying';
  belowRing.visible = impact.visible = on;
  if (!on) return;
  belowRing.position.set(s.x, S.terrainHeight(s.x, s.z) + 0.15, s.z);
  const alt = Math.max(0, S.altitude(s));
  const tHit = alt / Math.max(1, -s.vy);
  const ix = s.x + s.vx * tHit, iz = s.z + s.vz * tHit;
  impact.position.set(ix, S.terrainHeight(ix, iz) + 0.2, iz);
  const k = Math.min(6, 1 + alt / 120); // grow with height so it stays visible from above
  impact.scale.setScalar(k); belowRing.scale.setScalar(Math.min(4, 1 + alt / 200));
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
let cam = { yaw: 0.35, dist: 28, shake: 0, view: 'chase' };
try { if (localStorage.getItem('crashland.view') === 'top') cam.view = 'top'; } catch { /* storage unavailable */ }
function toggleView() {
  cam.view = cam.view === 'chase' ? 'top' : 'chase';
  try { localStorage.setItem('crashland.view', cam.view); } catch { /* storage unavailable */ }
  viewButton();
}
function viewButton() {
  const b = document.getElementById('c-view');
  b.textContent = cam.view === 'top' ? 'Ansicht: Oben' : 'Ansicht: Hinten';
  b.classList.toggle('on', cam.view === 'top');
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
const bestKey = (id) => `${id}${windLevel ? `.wind${windLevel}` : ''}`;
function best(id) { try { return JSON.parse(localStorage.getItem(`crashland.best.${id}`)); } catch { return null; } }
function saveBest(id, v) { try { localStorage.setItem(`crashland.best.${id}`, JSON.stringify(v)); } catch { /* storage unavailable */ } }

function buildMenu() {
  const wrap = $('planets');
  wrap.innerHTML = '';
  buildWindSelect();
  for (const p of S.PLANETS) {
    const b = document.createElement('button');
    b.className = 'planet';
    const rec = best(bestKey(p.id));
    const sky = '#' + new THREE.Color(p.ground).getHexString(), sky2 = '#' + new THREE.Color(p.ground2).getHexString();
    b.innerHTML = `<span class="orb" style="background: radial-gradient(circle at 35% 30%, ${sky}, ${sky2} 70%)"></span>
      <b>${p.name}</b><span class="g">${p.g.toLocaleString('de-DE')} m/s² · ${(p.g / S.G0).toLocaleString('de-DE', { maximumFractionDigits: 2 })} g</span>
      <p>${p.text}</p><p>Start: ${p.alt} m · ${-p.vy} m/s<br>Atmosphäre: ${p.atmo} · Treibstoff: ${p.fuel} kg${p.rho === 0 && windLevel ? '<br>Kein Wind ohne Luft' : ''}</p>
      <span class="best">${rec ? `Bestwert: ${'★'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)} · ${rec.score} Punkte` : ''}</span>`;
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

function showMenu() {
  buildWindowInfo();
  mode = 'menu';
  $('menu').hidden = false; $('result').hidden = true; $('result-open').hidden = true; $('hud').hidden = true;
  buildMenu();
  // ship parked on the pad as a backdrop
  debris.clear(); ship.reset();
  s = S.createState(planet); s.x = 0; s.z = 0; s.y = 0; s.vy = 0; s.vx = 0; s.vz = 0; s.a = 0; s.b = 0; s.status = 'parked';
  ship.update(s, 0);
}

function start(p) {
  if (p !== planet || !world.ready) { planet = p; world.setPlanet(p); world.ready = true; fogBase = scene.fog.far; }
  debris.clear(); ship.reset();
  s = S.createState(planet, { wind: windLevel });
  hud.reset();
  mode = 'flight';
  $('menu').hidden = true; $('result').hidden = true; $('result-open').hidden = true; $('hud').hidden = false;
  ship.helpers.visible = showCom;
}

function rate(st) {
  if (st.status !== 'landed') return { stars: 0, score: 0 };
  const fuelPct = S.fuel(st) / st.fuel0;
  let stars = 3 - st.touch.grade;
  const fainted = st.crew.some((c) => c.fainted > 0);
  if (fainted || fuelPct < 0.1 || Object.keys(st.lost).length) stars--;
  stars = Math.max(1, stars);
  const score = Math.max(0, Math.round(fuelPct * 1000 + (S.LAND.vy[2] - st.touch.vy) * 60 + (S.LAND.tilt[1] - st.touch.tilt) * 10
    - st.touch.grade * 150 + st.crew.filter((c) => !c.fainted).length * 70 + st.planet.g * 20 - Object.keys(st.lost).length * 120)
    * (st.planet.rho > 0 ? st.wind.bonus : 1));
  return { stars, score };
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
  const { stars, score } = rate(s);
  $('r-kicker').textContent = `${planet.name} · ${planet.g.toLocaleString('de-DE')} m/s²${s.wind.speed && planet.rho > 0 ? ` · Wind ${s.wind.name} ×${s.wind.bonus.toLocaleString('de-DE')}` : ''}`;
  const g = s.touch.grade;
  const crash = s.touch.crash;
  $('r-title').textContent = ok ? ['Butterweich gelandet', 'Gelandet', 'Harte Landung'][g]
    : !crash.crew ? 'Totalverlust' : crash.kind === 'wreck' ? 'Bruchlandung' : 'Explosion';
  $('r-title').style.color = ok ? S.GRADES[g].color : crash.kind === 'wreck' && crash.crew ? 'var(--amber)' : 'var(--bad)';
  $('r-reason').textContent = ok
    ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  ${score} Punkte${g === 2 ? ' · Fahrwerk beschädigt' : g === 1 ? ' · etwas unsanft' : ''}`
    : `Aufschlag: ${s.reason}. ${crash.kind === 'wreck' ? (crash.crew ? 'Der Lander ist Schrott, aber kein Feuer: die Crew ist unverletzt.' : 'Kein Feuer, aber der Aufprall war zu hart für die Kapsel.')
      : crash.crew ? `${Math.round(crash.fuelBurned)} kg Treibstoff sind explodiert. Die Crew konnte sich aus der Kapsel retten.`
      : `${Math.round(crash.fuelBurned)} kg Treibstoff sind explodiert.`}`;
  const f1 = (n) => n.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const rows = [
    ['Aufsetzen', `${f1(s.touch.vy)} m/s · ${S.GRADES[s.touch.grades.vy].name}`],
    ['Drift', `${f1(s.touch.vx)} m/s · ${S.GRADES[s.touch.grades.vx].name}`],
    ['Neigung', `${f1(s.touch.tilt)}° · ${S.GRADES[s.touch.grades.tilt].name}`],
    ['Treibstoff übrig', `${Math.round(S.fuel(s))} kg (${Math.round((S.fuel(s) / s.fuel0) * 100)} %)`],
    ['Max. G-Last', `${f1(s.maxG)} g`],
    ['Fallschirm', { burned: 'verglüht', stowed: 'nicht benutzt', open: s.planet.rho > 0 ? 'offen gelandet' : 'nutzlos (keine Luft)', cut: 'abgeworfen', torn: 'gerissen' }[s.chute]],
    ['Crew', !ok ? (s.touch.crash.crew ? 'überlebt' : 'Kein Kontakt mehr') : s.crew.some((c) => c.fainted) ? s.crew.filter((c) => c.fainted).map((c) => `${c.name} ${c.fainted}× ohnmächtig`).join(', ') : 'alle bei Bewusstsein'],
    ['Hitzeschäden', Object.keys(s.lost).length ? S.COMPONENTS.filter((c) => s.lost[c.id]).map((c) => c.name).join(', ') + ' verglüht' : 'keine'],
    ['Batterie', `${Math.round(s.battery)} %`],
    ['Flugzeit', `${f1(s.t)} s`],
  ];
  $('r-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  if (ok) {
    const prev = best(bestKey(planet.id));
    if (!prev || score > prev.score) saveBest(bestKey(planet.id), { stars, score });
  }
  // don't pop up: offer a button so the scene can be looked at first
  $('result-open').innerHTML = `<b style="color:${$('r-title').style.color}">${$('r-title').textContent}</b>${ok ? ` ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : ''} · Ergebnis ansehen`;
  $('result-open').hidden = false;
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
  if (e.code === 'KeyV') toggleView();
  const digit = /^(Digit|Numpad)(\d)$/.exec(e.code);
  if (digit) s.limit = digit[2] === '0' ? 1 : +digit[2] / 10;
  if (e.code === 'KeyP') S.toggleChute(s);
  if (e.code === 'KeyE') S.togglePanels(s);
  if (e.code === 'KeyC') toggleCom();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

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
function cycleSas() { s.sas = { hold: 'retro', retro: 'retro2', retro2: 'up', up: false }[s.sas] ?? 'hold'; s.holdA = s.a; s.holdB = s.b; }
function toggleCom() { showCom = !showCom; ship.helpers.visible = showCom; $('c-com').classList.toggle('on', showCom); }
$('c-sas').addEventListener('click', cycleSas);
$('c-chute').addEventListener('click', () => S.toggleChute(s));
$('c-view').addEventListener('click', toggleView);
$('c-panels').addEventListener('click', () => S.togglePanels(s));
$('c-com').addEventListener('click', toggleCom);
$('c-com').classList.add('on');
$('r-again').addEventListener('click', () => start(planet));
$('result-open').addEventListener('click', () => { $('result').hidden = false; $('result-open').hidden = true; $('r-again').focus(); });
$('r-close').addEventListener('click', () => { $('result').hidden = true; $('result-open').hidden = false; });
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
  const dt = Math.min(raw, 0.05);
  time += dt;

  if (mode === 'flight') {
    readInput(dt);
    acc += dt;
    while (acc >= STEP) { S.step(s, input, STEP); acc -= STEP; }
    for (const ev of s.events.splice(0)) {
      if (ev.type === 'lost') {
        const pos = ship.blowOff(ev.id, s);
        if (pos) { debris.burst(pos); cam.shake = Math.max(cam.shake, 0.35); }
      }
    }
    if (s.status !== 'flying') finish();
  } else if (mode === 'end' && endTimer > 0) {
    endTimer -= raw;
    if (endTimer <= 0) showResult();
  }
  if (mode === 'menu') cam.yaw += dt * 0.12;

  ship.update(s, time);
  debris.update(dt);
  if (mode !== 'menu') hud.update(s, input, cam.yaw);

  updateMarkers();
  focus.set(s.x, s.y + 2.5, s.z);
  const dist = mode === 'menu' ? 22 : cam.dist * (camera.aspect < 0.8 ? 1.25 : 1);
  const top = cam.view === 'top' && mode !== 'menu';
  if (top) {
    // overhead: straight down onto the lander, screen-up = the camera's forward direction (matches the tilt pad)
    const alt = Math.max(0, S.altitude(s));
    camera.position.set(focus.x, focus.y + dist * 1.8, focus.z);
    camera.up.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    scene.fog.far = fogBase + alt * 1.5 + dist * 2;
  } else {
    camera.up.set(0, 1, 0);
    camera.position.set(focus.x + Math.sin(cam.yaw) * dist, focus.y + dist * 0.16, focus.z + Math.cos(cam.yaw) * dist);
    if (scene.fog) scene.fog.far = fogBase;
  }
  const minY = S.terrainHeight(camera.position.x, camera.position.z) + 1.5;
  if (camera.position.y < minY) camera.position.y = minY;
  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt);
    camera.position.add(new THREE.Vector3().randomDirection().multiplyScalar(cam.shake * 0.8));
  }
  if (top) camera.lookAt(focus.x, focus.y - 10, focus.z); else camera.lookAt(focus);
  world.update(camera, focus, time, mode === 'menu' ? { x: 0, z: 0 } : { x: s.windX, z: s.windZ }, dt);
  renderer.render(scene, camera);
});

world.setPlanet(planet); world.ready = true; fogBase = scene.fog.far;
showMenu();

// handle for automated tests
window.__crashland = { get state() { return s; }, start: (i) => start(S.PLANETS[i]), input, S, get mode() { return mode; }, setAutopilot(f) { autopilot = f; } };
