import * as THREE from 'three';
import * as S from './sim.js';
import { loadModels } from './models.js';
import { createWorld } from './world.js';
import { createShip } from './ship.js';
import { createDebris } from './debris.js';
import { createHud, setLabel, ICONS } from './hud.js';
import { createOrbitMap } from './orbitmap.js';
import { createReentry } from './reentry.js';
import { createBuilder } from './builder.js';
import { cargoModel } from './cargo.js';
import * as E from './economy.js';
import * as B from './base.js';
import * as RS from './rescue.js';
import { createNavball, padToTilt } from './navball.js';

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
// the predicted touchdown point: one cross (dark outline, bright bars, a dashed ring) plus a thin light beam
// standing up from it, so it can be seen from the side too; orange, green when it is on the pad
const impact = new THREE.Group();
const impactMat = new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.98, depthWrite: false, depthTest: false });
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });
for (const r of [0, Math.PI / 2]) {
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 1.25).rotateX(-Math.PI / 2).rotateY(r + Math.PI / 4), outlineMat);
  shadow.renderOrder = 19.5;
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.75).rotateX(-Math.PI / 2).rotateY(r + Math.PI / 4), impactMat);
  bar.renderOrder = 20;
  impact.add(shadow, bar);
}
const impactRing = new THREE.Mesh(new THREE.RingGeometry(3.3, 3.65, 40).rotateX(-Math.PI / 2), impactMat);
impactRing.renderOrder = 20;
const beamMat = new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
const impactBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 6, 1, true).translate(0, 0.5, 0), beamMat);
impact.add(impactRing, impactBeam);
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
  // size: never smaller than ~44 px on screen (far below a high lander), grows with height as before
  let k = Math.min(6, 1 + alt / 120);
  if (pred) {
    const depth = impact.position.distanceTo(camera.position);
    const minK = (44 / innerHeight) * 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / 7.5;
    k = Math.max(k, Math.min(minK, 400));
    // green only when it really is on the pad
    const onPad = Math.hypot(pred.x, pred.z) <= PAD_RADIUS;
    impactMat.color.set(onPad ? 0x5fe0a0 : 0xffb547); beamMat.color.copy(impactMat.color);
    // the beam reaches up to the lander's height (in the cross's own scale)
    impactBeam.scale.set(1, Math.max(5, alt + 20) / k, 1);
  }
  impact.scale.setScalar(k); belowRing.scale.setScalar(Math.min(4, 1 + alt / 200));
}
// the predicted touchdown point as a screen marker of fixed size when the 3D cross is only a few pixels
// (from orbit the ground is kilometres away); it turns green when the cross sits on the pad
const predMark = document.getElementById('pred-mark');
const predV = new THREE.Vector3();
function placePredMark() {
  let show = mode === 'flight' && s.status === 'flying' && impact.visible;
  if (show) {
    camera.updateMatrixWorld(); // this frame's camera, not the last one
    predV.copy(impact.position);
    predV.project(camera);
    let nx = predV.x, ny = predV.y;
    if (predV.z > 1) { nx = -nx; ny = -ny; } // behind the camera: the direction flips
    const inside = predV.z < 1 && Math.abs(nx) < 0.92 && Math.abs(ny) < 0.92;
    show = !inside; // on screen the 3D cross itself is big enough now; the marker is only the edge arrow
    if (show) {
      // on screen: the cross itself; off screen: an arrow at the edge pointing to it
      let x = (nx * 0.5 + 0.5) * innerWidth, y = (-ny * 0.5 + 0.5) * innerHeight;
      if (!inside) {
        // the edge of the free area: not under the controls at the bottom
        const L = 34, R = innerWidth - 34, T = 48, B = innerHeight - (innerWidth < 560 ? 250 : 150);
        const cx = (L + R) / 2, cy = (T + B) / 2, dx = x - cx, dy = y - cy;
        const k = Math.min((R - cx) / Math.abs(dx || 1e-6), (B - cy) / Math.abs(dy || 1e-6));
        x = cx + dx * k; y = cy + dy * k;
        predMark.style.setProperty('--rot', `${Math.atan2(dy, dx)}rad`);
      }
      predMark.classList.toggle('edge', !inside);
      predMark.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      predMark.classList.toggle('on-pad', Math.hypot(s.pred.x, s.pred.z) <= PAD_RADIUS);
    }
  }
  if (predMark.hidden === show) predMark.hidden = !show;
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
// centre-of-mass marker and thrust axis: off by default, C (desktop) switches it, remembered
let showCom = false;
try { showCom = localStorage.getItem('crashland.com') === '1'; } catch { /* default */ }
let cam = { yaw: 0.35, pitch: 0, dist: 28, shake: 0, view: 'chase' };
const VIEWS = { chase: 'Lander', target: 'Ziel' }; // (the oblique and top views are still in the camera code)
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
  setLabel(b, VIEWS[cam.view], 'V', `Kamera: ${VIEWS[cam.view]} (umschalten)`, cam.view === 'target' ? 'Ziel' : '');
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
  row('auto-select', [[false, 'Von Hand', 'nach dem Hinweis'], [true, 'Automatisch', `Computer · ${x(S.AUTO_FINE_BONUS)}`]], settings.autoFine, 'autoFine');
}
// ---------- lander builder ----------
let build = { ...S.DEFAULT_BUILD };
try { build = S.normalizeBuild(JSON.parse(localStorage.getItem('crashland.build') || '{}')); } catch { /* defaults */ }
const optName = (slot, id) => S.BUILD_SLOTS.find((x) => x.id === slot).options.find((o) => o.id === id)?.name ?? id;
function buildSummary() {
  const diff = S.BUILD_SLOTS.filter((sl) => build[sl.id] !== S.DEFAULT_BUILD[sl.id]).map((sl) => `${sl.name}: ${optName(sl.id, build[sl.id])}`);
  return diff.length ? diff.join(' · ') : 'Standard';
}
// mission briefing: the lander for one cargo, remembered per cargo type
let editMission = null, missionBuild = null;
function missionBuildFor(type, fresh = false) {
  let b = { ...build };
  if (!fresh) try { const saved = JSON.parse(localStorage.getItem(`crashland.mbuild.${type}`)); if (saved) b = saved; } catch { /* default: the free build */ }
  if (fresh) b = { ...S.DEFAULT_BUILD };
  b = S.normalizeBuild(b); delete b.payload;
  return S.CARGO[type].crew ? { ...b, capsule: 'hab' } : { ...b, payload: type };
}
// short chips with icons instead of sentences (cards and briefing)
const chip = (icon, txt, cls = '', title = '') => `<span class="ch ${cls}"${title ? ` title="${title}"` : ''}><i>${icon}</i>${txt}</span>`;
const cargoChips = (c) => (c.crew ? chip('👩‍🚀', '4 Crew') : chip('⚖', `${c.mass} kg`, '', 'Masse') + chip('⇊', `${c.g} g`, '', 'verträgt höchstens') + chip('⤓', `${c.touch} m/s`, '', 'Aufsetzen höchstens'));
const bonusChips = (bon) => [bon.fuel > 1 ? chip('⛽', `+${Math.round((bon.fuel - 1) * 100)} %`, 'ok', 'Treibstoff') : '', bon.solar > 1 ? chip('☀', `+${Math.round((bon.solar - 1) * 100)} %`, 'ok', 'Solar') : '', bon.score > 1 ? chip('★', `+${Math.round((bon.score - 1) * 100)} %`, 'ok', 'Punkte') : ''].join('');
function openMissionBuilder(p, type, ring, contract = null) {
  const base = loadBase(p.id);
  if (!type || (!contract && base.modules.some((m) => m.type === type))) return;
  const c = S.CARGO[type], bon = S.baseBonus(base.modules), built = builtTypes();
  // where it goes: the beacon in the centre, everything else on the near (bonus) or far ring
  ring = contract ? null : type === 'beacon' ? 'center' : ring ?? (B.freeSlot(base, 'near') !== null ? 'near' : 'far');
  const pay = E.PLANET_PAY[p.id] ?? 1;
  const pick = { ring }; // survives the briefing closing (Start)
  editMission = { planet: p, type, pick, fuel: bon.fuel };
  missionBuild = missionBuildFor(type);
  if (career()) missionBuild = B.allowedBuild(missionBuild, built); // parts the bases have not unlocked yet
  $('menu').hidden = true; cam.pitch = 0;
  parkShip();
  const sub = `<span class="chips-row">${chip('🪐', p.name.replace(' Orbit', ''))}${cargoChips(c)}${bonusChips(bon)}${contract ? chip('📍', `neben ${S.CARGO[contract.near].name}`) : ''}</span>`;
  const ringRow = () => (type === 'beacon' || contract ? ''
    : `<span class="ring-seg">${['near', 'far'].map((r) => { const free = B.freeSlot(base, r) !== null; return `<button class="ringsel${pick.ring === r ? ' on' : ''}" data-ring="${r}"${free ? '' : ' disabled'} title="${B.RINGS[r].note}">${B.RINGS[r].name}${free ? (r === 'near' ? ' <small>+20 %</small>' : '') : ' <small>voll</small>'}</button>`; }).join('')}</span>`);
  builder.open({
    title: contract ? `Versorgung · ${c.name}` : c.name,
    sub,
    planets: [p], ref: missionBuildFor(type, true), hideSlots: ['capsule'],
    onStart: () => start(p, { type, ring: pick.ring, contract }),
    locked: career() ? (slot, opt) => { const m = B.unlockedBy(slot, opt); return m && !built.has(m) ? S.CARGO[m].name : null; } : null,
    // the line under the title: limits, the slot choice, and in the career what it costs
    status: (b) => {
      if (!career()) return { sub: `${sub}<span class="chips-row">${ringRow()}</span>`, canStart: true, startLabel: 'Start ▶' };
      const cc = loadCareer(), econ = E.baseEconomy(base.modules), fk = (S.FUEL_LEVELS[settings.fuel]?.k ?? 1) * bon.fuel;
      const cost = E.flightCost(b, p, fk, econ.fuelPrice), ok = cc.money >= cost.total;
      const broke = cc.money < E.cheapestCost(type, p, fk, econ.fuelPrice);
      const fee = E.FEES[type] * (B.RINGS[pick.ring]?.bonus ?? 1) * pay;
      return {
        sub: `${sub}<span class="chips-row">${ringRow()}${chip('−', E.cr(cost.total).replace(' Cr', ''), ok ? 'cost' : 'bad', `Kosten: Teile ${E.cr(cost.parts)}, Treibstoff ${E.cr(cost.fuel)}`)}${chip('+', E.cr(fee).replace(' Cr', ''), 'ok', 'Prämie bei Lieferung')}${chip('💰', E.cr(cc.money).replace(' Cr', ''), '', 'Konto')}`
          + (broke ? `<button class="link loan">Notkredit +${E.cr(E.LOAN)}</button>` : '') + '</span>',
        canStart: ok, startLabel: ok ? 'Start ▶' : 'Zu teuer',
      };
    },
    badge: career() ? (b, alt) => { const d = E.partsPrice(alt) - E.partsPrice(b); return Math.abs(d) >= 100 ? `<em class="${d < 0 ? 'b-up' : 'b-down'}">${d > 0 ? '+' : '−'}${E.cr(Math.abs(d))}</em>` : ''; } : null,
  });
}
function setBuild(slot, id) {
  if (editMission) {
    missionBuild[slot] = id;
    const save = { ...missionBuild }; delete save.payload;
    try { localStorage.setItem(`crashland.mbuild.${editMission.type}`, JSON.stringify(save)); } catch { /* storage unavailable */ }
    parkShip();
    return;
  }
  build[slot] = id;
  try { localStorage.setItem('crashland.build', JSON.stringify(build)); } catch { /* storage unavailable */ }
  if (mode === 'menu') parkShip();
  updateBuildBtn();
}
const updateBuildBtn = () => { $('build-btn').innerHTML = `Lander bauen<small>${buildSummary() === 'Standard' ? 'Standard' : 'Eigener Lander'}</small>`; };
// fullscreen 3D editor (src/builder.js); the start menu steps aside while it is open
const builder = createBuilder({
  S, ship, camera, canvas: renderer.domElement,
  getBuild: () => (editMission ? missionBuild : build),
  setBuild,
  resetBuild: () => { if (editMission) { missionBuild = missionBuildFor(editMission.type, true); setBuild('engine', missionBuild.engine); } else { build = { ...S.DEFAULT_BUILD }; setBuild('engine', 'std'); } },
  getFuelK: () => (S.FUEL_LEVELS[settings.fuel]?.k ?? 1) * (editMission?.fuel ?? 1),
  onClose: (starting) => { editMission = null; if (!starting) { $('menu').hidden = false; buildMenu(); } },
});
// free building: only the planets of the chosen start mode in the figures
$('build-btn').addEventListener('click', () => { $('menu').hidden = true; cam.pitch = 0; builder.open({ planets: startMode === '0' ? S.PLANETS : S.ORBIT_PLANETS }); });
// settings: reset the game state while testing (money, bases, or everything incl. mission landers and best scores)
function resetGame(what) {
  const label = { money: 'Geld und Kredit zurücksetzen?', bases: 'Alle Basen zurücksetzen?', all: 'Alles zurücksetzen (Geld, Basen, Missions-Lander, Bestwerte)?' }[what];
  if (!confirm(label)) return;
  try {
    if (what !== 'bases') localStorage.removeItem('crashland.career');
    if (what !== 'money') for (const p of [...S.PLANETS, ...S.ORBIT_PLANETS]) localStorage.removeItem(baseKey(p.id));
    if (what === 'all') for (const k of Object.keys(localStorage)) if (k.startsWith('crashland.mbuild.') || k.startsWith('crashland.best.')) localStorage.removeItem(k);
  } catch { /* storage unavailable */ }
  buildMenu();
}
$('reset-toggle').addEventListener('click', () => { const r = $('reset-row'); r.hidden = !r.hidden; });
$('reset-money').addEventListener('click', () => resetGame('money'));
$('reset-bases').addEventListener('click', () => resetGame('bases'));
$('reset-all').addEventListener('click', () => resetGame('all'));
// emergency credit in the briefing (only offered when even the cheapest lander is too expensive)
$('build-sub').addEventListener('click', (e) => {
  const rs = e.target.closest('.ringsel');
  if (rs && editMission) { editMission.pick.ring = rs.dataset.ring; builder.refresh(); return; }
  if (!e.target.closest('.loan')) return;
  const c = loadCareer(); c.money += E.LOAN; c.debt += E.LOAN; saveCareer(c);
  builder.refresh();
});

/** score multiplier of the chosen settings (wind is applied separately, only where there is air) */
const settingsBonus = (set) => (S.FUEL_LEVELS[set.fuel]?.bonus ?? 1) * (set.hints ? 1 : S.HINTS_OFF_BONUS) * (set.autoFine ? S.AUTO_FINE_BONUS : 1);
// wind only counts where there is air to blow
const bestKey = (id) => `${id}${windLevel && [...S.PLANETS, ...S.ORBIT_PLANETS].find((p) => p.id === id)?.rho > 0 ? `.wind${windLevel}` : ''}${settings.fuel !== 1 ? `.fuel${settings.fuel}` : ''}${settings.hints ? '' : '.nohints'}${settings.autoFine ? '.auto' : ''}${buildSummary() === 'Standard' ? '' : '.b' + S.BUILD_SLOTS.map((sl) => build[sl.id]).join('-')}`;
function best(id) { try { return JSON.parse(localStorage.getItem(`crashland.best.${id}`)); } catch { return null; } }
function saveBest(id, v) { try { localStorage.setItem(`crashland.best.${id}`, JSON.stringify(v)); } catch { /* storage unavailable */ } }

// start: from the approach (normal levels) or from orbit; remembered
let startMode = '0'; // '0' approach, '1' from orbit, 'base' base building
try { startMode = localStorage.getItem('crashland.orbit') ?? '0'; } catch { /* default */ }
$('start-select').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  startMode = b.dataset.orbit;
  try { localStorage.setItem('crashland.orbit', startMode); } catch { /* storage unavailable */ }
  buildMenu();
});

// ---------- base building (prototype): one base per planet, missions in a fixed order ----------
const baseKey = (id) => `crashland.base.${id}`;
function loadBase(id) { try { return B.migrate(JSON.parse(localStorage.getItem(baseKey(id)))); } catch { return { modules: [] }; } }
/** every module type built in any base: the career's unlocked parts */
const builtTypes = () => new Set(S.ORBIT_PLANETS.flatMap((p) => loadBase(p.id).modules.map((m) => m.type)));
function saveBase(id, b) { try { localStorage.setItem(baseKey(id), JSON.stringify(b)); } catch { /* storage unavailable */ } }
// career money (prototype): one account for all bases; "sandbox" = everything free
let economy = 'career';
try { economy = localStorage.getItem('crashland.economy') ?? 'career'; } catch { /* default */ }
function loadCareer() { try { return { money: E.START_MONEY, debt: 0, ...JSON.parse(localStorage.getItem('crashland.career') ?? '{}') }; } catch { return { money: E.START_MONEY, debt: 0 }; } }
function saveCareer(c) { try { localStorage.setItem('crashland.career', JSON.stringify(c)); } catch { /* storage unavailable */ } }
const career = () => economy === 'career';
let mission = null; // the base mission being flown: { planetId, step, type, target: [x, z] }
// rescue mission: { sc (scenario), planetId, target, result, pay }; each planet has a scenario counter
let rescue = null;
const rescueKey = (id) => `crashland.rescue.${id}`;
function rescueN(id) { try { return +(localStorage.getItem(rescueKey(id)) ?? 0) || 0; } catch { return 0; } }
function nextRescue(id) { try { localStorage.setItem(rescueKey(id), String(rescueN(id) + 1)); } catch { /* storage unavailable */ } }
const RESCUE_FEE = 15000;
const rescueFee = (p, sc) => Math.round((RESCUE_FEE * sc.pay * (E.PLANET_PAY[p.id] ?? 1)) / 500) * 500;
const baseGroup = new THREE.Group(); scene.add(baseGroup);
/** the modules of a base around the current target (the target is the origin of the flight) */
const slotMat = new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.35, depthWrite: false });
function showBase(base, target) {
  baseGroup.clear();
  $('base-labels').innerHTML = '';
  if (!base) return;
  const add = (o, x, z, lift, rot, label) => {
    o.userData.sim = { x, z, lift, rot };
    baseGroup.add(o);
    if (label) {
      const el = document.createElement('div');
      el.className = `blabel ${label.cls ?? ''}`; el.innerHTML = label.html;
      $('base-labels').append(el); o.userData.label = el;
    }
  };
  for (const m of base.modules) {
    const o = cargoModel(m.type, true), c = S.CARGO[m.type];
    if (m.damaged) o.traverse((k) => { if (k.isMesh) { k.material = k.material.clone(); k.material.color.multiplyScalar(0.55); } });
    add(o, m.x - target[0], m.z - target[1], o.userData.h / 2, m.rot ?? 0,
      { html: `<b>${c.name}</b><small>${m.damaged ? '⚠ beschädigt · kein Bonus' : c.bonus}</small>`, cls: m.damaged ? 'dmg' : '' });
  }
  // free slots: faint numbered rings where later modules can go (the target is the pad itself)
  for (let i = 1; i < 13; i++) {
    if (base.modules.some((m) => m.slot === i) || (mission && i === mission.slot)) continue;
    const [sx, sz] = B.slotPos(i);
    add(new THREE.Mesh(new THREE.RingGeometry(2.6, 3.0, 28).rotateX(-Math.PI / 2), slotMat), sx - target[0], sz - target[1], 0.12, 0, null);
  }
}
const _bq = new THREE.Quaternion(), _by = new THREE.Quaternion(), _bv = new THREE.Vector3();
const FLY_T = 7; // s per shot of the briefing (base, then lander)
/** keep the base on the (curved, turning) planet and its labels on screen */
function placeBase() {
  if (!baseGroup.children.length) return;
  camera.updateMatrixWorld();
  for (const o of baseGroup.children) {
    const u = o.userData.sim;
    world.toRender(u.x, S.terrainHeight(u.x, u.z) + u.lift, u.z, o.position, _bq);
    o.quaternion.copy(_bq).multiply(_by.setFromAxisAngle(_bv.set(0, 1, 0), u.rot));
    const el = o.userData.label;
    if (!el) continue;
    _bv.copy(o.position); _bv.y += (o.userData.h ?? 2) * 0.6 + 1.5;
    const d = _bv.distanceTo(camera.position);
    _bv.project(camera);
    const vis = mode !== 'menu' && _bv.z < 1 && Math.abs(_bv.x) < 1 && Math.abs(_bv.y) < 1 && d < 2500;
    el.hidden = !vis;
    if (vis) {
      el.style.transform = `translate(${((_bv.x * 0.5 + 0.5) * innerWidth).toFixed(0)}px, ${((-_bv.y * 0.5 + 0.5) * innerHeight).toFixed(0)}px)`;
      el.style.opacity = String(Math.max(0.35, Math.min(1, 1.6 - d / 600)));
    }
  }
}
// difficulty: one summary button, the options fold out below it
$('diff-btn').addEventListener('click', () => { const d = $('diff'); d.hidden = !d.hidden; $('diff-btn').setAttribute('aria-expanded', String(!d.hidden)); });

function buildMenu() {
  const wrap = $('planets');
  wrap.innerHTML = '';
  buildWindSelect();
  buildSettings();
  updateBuildBtn();
  for (const b of $('start-select').querySelectorAll('button')) {
    const on = b.dataset.orbit === startMode;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
  }
  const bonus = (windLevel ? S.WIND_LEVELS[windLevel].bonus : 1) * settingsBonus(settings);
  const diff = [windLevel ? `Wind ${S.WIND_LEVELS[windLevel].name.toLowerCase()}` : '', settings.fuel !== 1 ? `Treibstoff ${S.FUEL_LEVELS[settings.fuel].name.toLowerCase()}` : '',
    settings.hints ? '' : 'ohne Hinweise', settings.autoFine ? 'Computer an' : ''].filter(Boolean);
  $('diff-btn').innerHTML = `Schwierigkeit${Math.abs(bonus - 1) > 0.001 ? ` <em>×${bonus.toLocaleString('de-DE', { maximumFractionDigits: 2 })}</em>` : ''}<small>${diff.length ? diff.join(' · ') : 'Standard'}</small>`;
  $('base-info').hidden = startMode !== 'base' && startMode !== 'rescue';
  $('build-btn').hidden = startMode === 'rescue'; // the lander is given
  if (startMode === 'base' || startMode === 'rescue') {
    const c = loadCareer();
    $('base-info').innerHTML = `<span class="eco-row"><span class="eco-seg"><button data-eco="career" class="${career() ? 'on' : ''}">Karriere</button><button data-eco="sandbox" class="${career() ? '' : 'on'}">Sandbox</button></span>`
      + (career() ? `<b class="money">💰 ${E.cr(c.money)}</b>${c.debt > 0 ? ` <small class="debt">Kredit ${E.cr(c.debt)}</small>` : ''}` : '<small>alles kostenlos</small>') + '</span>';
    $('base-info').querySelectorAll('[data-eco]').forEach((b) => b.addEventListener('click', () => { economy = b.dataset.eco; try { localStorage.setItem('crashland.economy', economy); } catch { /* storage unavailable */ } buildMenu(); }));
  }
  // base missions start from orbit (deorbit, re-entry, then down to the base)
  for (const p of startMode === '0' ? S.PLANETS : S.ORBIT_PLANETS) {
    const b = document.createElement('button');
    b.className = 'planet';
    const rec = best(bestKey(p.id));
    if (startMode === 'rescue') {
      // rescue card: who needs help, in what lander, from which orbit; 🎲 swaps the call
      const sc = RS.scenario(p, rescueN(p.id)), lv = RS.LEVELS[sc.level];
      const sky = '#' + new THREE.Color(p.ground).getHexString(), sky2 = '#' + new THREE.Color(p.ground2).getHexString();
      const card = document.createElement('div');
      card.className = 'planet rescue-card'; card.tabIndex = 0; card.setAttribute('role', 'button');
      card.innerHTML = `<span class="orb" style="background: radial-gradient(circle at 35% 30%, ${sky}, ${sky2} 70%)"></span>
        <span class="pname"><b>${p.name.replace(' Orbit', '')}</b><span class="g ${lv.cls}">${lv.name}</span></span>
        <p><b>🆘 ${sc.title}</b>${sc.L.agency ? ` · ${sc.L.agency}` : ''}</p>
        <span class="chips-row">${chip(sc.L.icon, sc.L.name, '', sc.L.note)}${chip('◎', sc.where, '', 'Start')}${sc.fuelK < 1 ? chip('⛽', `${Math.round(sc.fuelK * 100)} %`, 'warn', 'Treibstoff') : ''}${career() ? chip('💰', E.cr(rescueFee(p, sc)), 'ok', 'Rettungsprämie') : ''}<button class="ch reroll" title="anderer Notruf" aria-label="anderer Notruf">🎲</button></span>`;
      card.querySelector('.reroll').addEventListener('click', (e) => { e.stopPropagation(); nextRescue(p.id); buildMenu(); });
      card.addEventListener('click', () => start(p));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(p); });
      wrap.append(card);
      continue;
    }
    if (startMode === 'base') {
      // base card: progress, the missions the base can fly now (tech tree), what is still locked
      const base = loadBase(p.id), ms = B.missions(base), card = document.createElement('div');
      card.className = 'planet base-card';
      const locked = career() && !B.planetOpen(p.id, loadBase), complete = B.isComplete(base);
      const offers = complete ? B.contracts(base) : [], pay = E.PLANET_PAY[p.id] ?? 1;
      const bon = S.baseBonus(base.modules), chips = [bon.fuel > 1 ? `Treibstoff +${Math.round((bon.fuel - 1) * 100)} %` : '', bon.solar > 1 ? `Solar +${Math.round((bon.solar - 1) * 100)} %` : '', bon.score > 1 ? `Punkte +${Math.round((bon.score - 1) * 100)} %` : ''].filter(Boolean);
      const sky = '#' + new THREE.Color(p.ground).getHexString(), sky2 = '#' + new THREE.Color(p.ground2).getHexString();
      const built = new Map(base.modules.map((m) => [m.type, m]));
      card.innerHTML = `<span class="orb" style="background: radial-gradient(circle at 35% 30%, ${sky}, ${sky2} 70%)"></span>
        <span class="pname"><b>${p.name.replace(' Orbit', '')}</b><span class="g">${ms.done}/${ms.total}</span></span>
        <span class="dots">${S.MISSIONS.map((m) => `<i class="${built.has(m) ? (built.get(m).damaged ? 'dmg' : 'done') : ms.open.some((o) => o.type === m) ? 'next' : ''}" title="${S.CARGO[m].name}${ms.locked.find((l) => l.type === m) ? ` – braucht ${ms.locked.find((l) => l.type === m).need.map((n) => S.CARGO[n].name).join(' + ')}` : ''}"></i>`).join('')}</span>
        <span class="mlist">${locked ? `<small class="plock">🔒 erst ${S.ORBIT_PLANETS.find((x) => x.id === B.PLANET_NEEDS[p.id]).name.replace(' Orbit', '')}-Basis fertig bauen</small>`
          : complete ? offers.map((o, i) => `<button class="mbtn sup" data-c="${i}" title="neben ${S.CARGO[o.near].name}">${S.CARGO[o.type].name}<small>+${E.cr(E.FEES[o.type] * pay).replace(' Cr', '')}</small></button>`).join('')
          : ms.open.map((o) => `<button class="mbtn" data-type="${o.type}" title="${S.CARGO[o.type].crew ? '4 Crew' : `${S.CARGO[o.type].mass} kg · ${S.CARGO[o.type].g} g`}">${S.CARGO[o.type].name}</button>`).join('')}</span>
        ${complete ? `<span class="chips-row">${chip('📦', `${base.supplies ?? 0} geliefert`, '', 'Versorgungsflüge')}${pay > 1 ? chip('×', pay.toLocaleString('de-DE'), 'ok', 'Prämien auf diesem Planeten') : ''}</span>` : pay > 1 && !locked ? `<span class="chips-row">${chip('×', pay.toLocaleString('de-DE'), 'ok', 'Prämien auf diesem Planeten')}</span>` : ''}
        <span class="chips-row">${bonusChips(bon)}</span>`;
      if (locked) card.classList.add('locked');
      card.querySelectorAll('.mbtn').forEach((mb) => mb.addEventListener('click', () => (mb.dataset.c !== undefined ? openMissionBuilder(p, offers[+mb.dataset.c].type, null, offers[+mb.dataset.c]) : openMissionBuilder(p, mb.dataset.type))));
      wrap.append(card);
      continue;
    }
    const sky = '#' + new THREE.Color(p.ground).getHexString(), sky2 = '#' + new THREE.Color(p.ground2).getHexString();
    b.innerHTML = `<span class="orb" style="background: radial-gradient(circle at 35% 30%, ${sky}, ${sky2} 70%)"></span>
      <span class="pname"><b>${p.name.replace(' Orbit', '')}</b><span class="g">${(p.g / S.G0).toLocaleString('de-DE', { maximumFractionDigits: 2 })} g</span></span>
      <p>${p.text}</p>
      <span class="chips-row">${chip('🌫', p.rho > 0 ? p.atmo : 'keine Luft', '', 'Atmosphäre')}${rec ? chip('★', `${rec.stars} · ${rec.score.toLocaleString('de-DE')}`, 'ok', 'Bestwert') : ''}</span>`;
    b.addEventListener('click', () => start(p));
    wrap.append(b);
  }
}

function buildWindowInfo() {
  const L = S.LAND, f = (n) => n.toLocaleString('de-DE');
  $('window-info').innerHTML = `<h3>Landefenster (Standardbeine, ↓ · ↔ · ∠)</h3>
    <span><b class="ok">Sanft</b> ${f(L.vy[0])} m/s · ${f(L.vx[0])} m/s · ${L.tilt[0]}°</span>
    <span><b class="warn">Hart</b> ${f(L.vy[1])} · ${f(L.vx[1])} · ${L.tilt[1]}°</span>
    <span><b style="color: var(--amber)">Fahrwerk</b> ${f(L.vy[2])} · ${f(L.vx[2])} · ${L.tilt[2]}° <small>(breite / gefederte Beine mehr)</small></span>
    <span><b class="bad">Bruchlandung</b> darüber: Lander Schrott, Crew überlebt bis ${S.CAPSULE_V} m/s</span>
    <span><b class="bad">Explosion</b> ab ${f(S.WRECK_V)} m/s mit Treibstoff im Tank</span>`;
}

function openHelp() { $('help').hidden = false; $('help-close').focus(); }
function closeHelp() { $('help').hidden = true; }
$('help-btn').addEventListener('click', openHelp);
// help tabs
$('help').querySelector('.help-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  for (const x of $('help').querySelectorAll('[data-tab]')) x.classList.toggle('on', x === b);
  for (const p of $('help').querySelectorAll('.help-pane')) p.hidden = p.dataset.pane !== b.dataset.tab;
  $('help').querySelector('.help-sheet').scrollTop = 0;
});
$('help-close').addEventListener('click', closeHelp);
$('help').addEventListener('click', (e) => { if (e.target === $('help')) closeHelp(); });

function showMenu() {
  buildWindowInfo();
  mode = 'menu';
  $('menu').hidden = false; $('result').hidden = true; $('result-open').hidden = true; $('hud').hidden = true;
  buildMenu();
  debris.clear();
  showBase(null); mission = null; rescue = null;
  S.setSite('plain'); world.setSite(0);
  parkShip();
}
/** ship parked on the pad as a backdrop (menu and builder) */
function parkShip() {
  s = S.createState(planet, { build: editMission ? missionBuild : build });
  ship.reset(s.spec); ship.helpers.visible = showCom; s.x = 0; s.z = 0; s.y = 0; s.vy = 0; s.vx = 0; s.vz = 0; s.a = 0; s.b = 0; s.status = 'parked';
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

function start(p, ms) {
  // base mission: from the menu (ms) or "next mission" from the result (mission set, same planet)
  if (!ms && mission && mission.planetId === p.id && startMode === 'base') ms = { type: mission.type, ring: mission.ring, contract: mission.contract }; // again
  if (ms?.contract) {
    // supply contract: the drop point next to a module (nothing stays there)
    mission = { planetId: p.id, type: ms.type, contract: ms.contract, slot: null, target: [ms.contract.x, ms.contract.z] };
  } else if (ms) {
    const base = loadBase(p.id), slot = B.freeSlot(base, ms.type === 'beacon' ? 'center' : ms.ring ?? 'near') ?? B.freeSlot(base, 'far');
    mission = !base.modules.some((m) => m.type === ms.type) && slot !== null ? { planetId: p.id, type: ms.type, ring: ms.ring, slot, target: B.slotPos(slot) } : null;
  } else mission = null;
  // rescue: the planet's current scenario; it lands next to the base (a free far slot), or on the empty pad
  rescue = null;
  if (!ms && startMode === 'rescue' && p.orbit) {
    const base = loadBase(p.id), slot = B.freeSlot(base, 'far') ?? B.freeSlot(base, 'near');
    rescue = { sc: RS.scenario(p, rescueN(p.id)), planetId: p.id, target: base.modules.length ? (slot !== null ? B.slotPos(slot) : [44, 0]) : [0, 0] };
  }
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
  let flightBuild = build, flightSettings = settings;
  if (mission) {
    // cargo flight: the payload replaces the capsule; the crew mission flies the habitat capsule
    const base = loadBase(p.id), bon = S.baseBonus(base.modules), c = S.CARGO[mission.type];
    flightBuild = missionBuildFor(mission.type); // the lander set up in the mission briefing
    const obstacles = base.modules.map((m) => ({ x: +(m.x - mission.target[0]).toFixed(2), z: +(m.z - mission.target[1]).toFixed(2), r: S.CARGO[m.type].r, name: S.CARGO[m.type].name }));
    // the orbit runs past the base: a sideways burn (Seite) first
    flightSettings = { ...settings, orbit: S.missOrbit(p, seed % 2 ? 1 : -1, 14), base: { fuel: bon.fuel, solar: bon.solar, score: bon.score, obstacles } };
    // career: the lander and its fuel are paid at the start
    if (career()) {
      const econ = E.baseEconomy(base.modules), cost = E.flightCost(flightBuild, p, (S.FUEL_LEVELS[settings.fuel]?.k ?? 1) * bon.fuel, econ.fuelPrice);
      const cc = loadCareer(); cc.money -= cost.total; saveCareer(cc);
      Object.assign(mission, { career: true, cost, econ });
    }
    showBase(base, mission.target);
  } else if (rescue) {
    // someone else's lander, someone else's orbit: no base bonus, the base modules are obstacles
    const base = loadBase(p.id), sc = rescue.sc;
    flightBuild = sc.build;
    const obstacles = base.modules.map((m) => ({ x: +(m.x - rescue.target[0]).toFixed(2), z: +(m.z - rescue.target[1]).toFixed(2), r: S.CARGO[m.type].r, name: S.CARGO[m.type].name }));
    flightSettings = { ...settings, orbit: sc.orbitSet, fuelMult: sc.fuelK, base: { obstacles } };
    showBase(base, rescue.target);
  } else showBase(null);
  // landing site: a base keeps its own, free flights get one from the seed (it is in the settings, so replays have it)
  const site = mission || rescue ? B.BASE_SITES[p.id] ?? 'plain' : S.SITE_IDS[seed % S.SITE_IDS.length];
  flightSettings = { ...flightSettings, site };
  s = S.newRound(planet, windLevel, seed, flightSettings, flightBuild);
  world.setSite(S.SITE_IDS.indexOf(site));
  ship.reset(s.spec);
  rec = { v: 1, planet: planet.id, wind: windLevel, seed, settings: { ...flightSettings }, build: { ...flightBuild }, ev: [] };
  lastRec = { thrust: false, rcs: 0, rcsZ: 0, limit: s.limit };
  hud.reset();
  cam.tgtD = 0; cam.intro = 0; cam.tgt = null; cam.pitch = 0;
  mode = 'flight';
  // base mission: a short fly-over of the base and the new target before the flight (tap or key skips it)
  cam.fly = mission || rescue ? 0 : null; cam.flyGo = false; // the briefing waits for its start button
  setWarp(1);
  $('flyover').classList.remove('rescue');
  if (mission) {
    const c = S.CARGO[mission.type], n = loadBase(p.id).modules.length;
    $('flyover').innerHTML = `<b>Basis ${p.name.replace(' Orbit', '')}</b><span>${n ? `${n} Modul${n > 1 ? 'e' : ''} · ` : ''}Ziel: ${c.name}${mission.contract ? ` · neben ${S.CARGO[mission.contract.near].name}` : mission.ring && mission.ring !== 'center' ? ` · ${B.RINGS[mission.ring].name}` : ''}</span><span>↔ Bahn ${(Math.abs(flightSettings.orbit.miss) / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km neben der Basis – erst Seite (S), dann Bremsen</span><button id="fly-go" class="fly-go">Start <kbd>⏎</kbd></button>`;
  }
  if (rescue) {
    const sc = rescue.sc, lv = RS.LEVELS[sc.level];
    $('flyover').classList.add('rescue');
    $('flyover').innerHTML = `<b>🆘 ${sc.title}</b><span class="story">${sc.story}</span><span>${sc.L.icon} ${sc.L.name} · ${sc.L.note} · ${lv.name}</span>${sc.orbitSet.miss ? `<span>↔ Bahn ${(Math.abs(sc.orbitSet.miss) / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km neben der Basis – erst Seite (S)</span>` : ''}<button id="fly-go" class="fly-go">Start <kbd>⏎</kbd></button>`;
  }
  $('c-map').hidden = !p.orbit; toggleMap(false);
  $('menu').hidden = true; $('result').hidden = true; $('result-open').hidden = true; $('hud').hidden = false;
  ship.helpers.visible = showCom;
}

const PAD_RADIUS = 12;
const CONTRACT_REACH = 25; // m: a supply drop has to land next to its module
const BASE_REACH = 60; // m from the target: closer, the base can use the cargo
function precision(st) {
  const d = Math.hypot(st.x, st.z);
  const [label, tone] = d <= 3 ? ['Volltreffer', 'ok'] : d <= PAD_RADIUS ? ['auf dem Pad', 'ok'] : d <= 40 ? ['knapp daneben', 'warn']
    : d <= 200 ? ['nah dran', 'warn'] : d <= 1000 ? ['daneben', 'amber'] : ['weit daneben', 'bad'];
  return { d, label, tone };
}
/** 300 for a bullseye, 150 on the pad, then fading with the distance (~70 at 100 m, ~35 at 200 m) */
function precisionBonus(st) { const { d } = precision(st); return d <= 3 ? 300 : d <= PAD_RADIUS ? 150 : 120 * Math.exp(-(d - PAD_RADIUS) / 160); }

function rate(st) {
  const mult = (st.planet.rho > 0 ? st.wind.bonus : 1) * settingsBonus(st.settings ?? settings) * (st.settings?.base?.score ?? 1);
  if (st.status !== 'landed' && st.spec.payload) return { stars: 0, score: 0, parts: [], mult: 1 }; // cargo lost
  if (st.status !== 'landed') {
    // crashed, but the crew got out: no stars, but the crew, the aim and the planet still count
    // only a wreck without fire still counts (crew, aim, planet); an explosion scores nothing
    if (!st.touch?.crash?.crew || st.touch.crash.kind !== 'wreck') return { stars: 0, score: 0, parts: [], mult: 1 };
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
    ['Fracht', st.spec.payload ? (st.cargo === 'intact' ? 500 : 150) : 0],
    ['Rettung', rescue?.result === 'saved' ? 300 + rescue.sc.d * 200 : 0],
  ];
  const base = parts.reduce((a, p) => a + p[1], 0);
  const score = Math.max(0, Math.round(base * mult));
  return { stars, score, parts: parts.filter((p) => Math.round(p[1]) !== 0), mult };
}

function finish() {
  mode = 'end';
  const ok = s.status === 'landed';
  // base: a landed cargo close enough to the target becomes a module (damaged ones give no bonus)
  if (mission) {
    mission.result = !ok ? 'lost' : Math.hypot(s.x, s.z) > (mission.contract ? CONTRACT_REACH : BASE_REACH) ? 'far' : s.cargo === 'damaged' ? 'damaged' : 'intact';
    if (mission.contract && (mission.result === 'intact' || mission.result === 'damaged')) {
      const base = loadBase(mission.planetId);
      base.supplies = (base.supplies ?? 0) + 1; base.cseed = (base.cseed ?? 0) + 1; // new offers
      saveBase(mission.planetId, base);
    } else if (mission.result === 'intact' || mission.result === 'damaged') {
      const base = loadBase(mission.planetId);
      base.modules.push({ type: mission.type, slot: mission.slot, x: +(s.x + mission.target[0]).toFixed(2), z: +(s.z + mission.target[1]).toFixed(2), rot: +(((rec?.seed ?? 0) % 628) / 100).toFixed(2), damaged: mission.result === 'damaged' });
      saveBase(mission.planetId, base);
    }
    if (mission.career) {
      // income: fee, aim, unburnt fuel, recovered lander, base income; half of it pays back a credit
      const pay = E.payout(s, mission.type, mission.result, mission.cost, mission.econ, (B.RINGS[mission.ring]?.bonus ?? 1) * (E.PLANET_PAY[mission.planetId] ?? 1));
      const cc = loadCareer(), repay = Math.min(cc.debt, Math.round(pay.total / 2));
      cc.money += pay.total - repay; cc.debt -= repay; saveCareer(cc);
      mission.pay = { ...pay, repay, money: cc.money };
    }
  }
  if (rescue) {
    rescue.result = !ok ? 'lost' : Math.hypot(s.x, s.z) > BASE_REACH ? 'far' : 'saved';
    if (rescue.result === 'saved') {
      nextRescue(rescue.planetId); // the next call
      if (career()) {
        const fee = rescueFee(planet, rescue.sc), cc = loadCareer(), repay = Math.min(cc.debt, Math.round(fee / 2));
        cc.money += fee - repay; cc.debt -= repay; saveCareer(cc);
        rescue.pay = { fee, repay, money: cc.money };
      }
    }
  }
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
  const siteInfo = S.SITES[s.settings?.site ?? 'plain'];
  $('r-kicker').textContent = `${planet.name} · ${siteInfo.icon} ${siteInfo.name}${s.wind.speed && planet.rho > 0 ? ` · Wind ${s.wind.name}` : ''}${Math.abs(bonus - 1) > 0.001 ? ` · Bonus ×${bonus.toLocaleString('de-DE', { maximumFractionDigits: 2 })}` : ''}`;
  const g = s.touch.grade, crash = s.touch.crash;
  $('r-title').textContent = rescue && ok ? (rescue.result === 'saved' ? (rescue.sc.L.agency ? 'Lander geborgen' : 'Crew gerettet') : 'Basis verfehlt')
    : mission && !S.CARGO[mission.type].crew
    ? { intact: 'Fracht abgesetzt', damaged: 'Fracht beschädigt', far: 'Zu weit weg', lost: 'Fracht verloren' }[mission.result]
    : ok ? ['Butterweich gelandet', 'Gelandet', 'Harte Landung'][g]
      : !crash.crew ? 'Totalverlust' : crash.kind === 'wreck' ? 'Bruchlandung' : 'Explosion';
  $('r-title').style.color = ok ? S.GRADES[g].color : crash.kind === 'wreck' && crash.crew ? 'var(--amber)' : 'var(--bad)';
  // stars and points, with the best so far
  // (base flights carry cargo: their scores don't mix with the free levels)
  const prev = mission || rescue ? null : best(bestKey(planet.id));
  const record = !mission && !rescue && score > 0 && (!prev || score > prev.score);
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
  if (mission) {
    // base mode counts money, not points: the result shows the balance (career) or just what was built (sandbox)
    $('r-score').innerHTML = mission.pay ? '<span id="r-money-slot"></span>' : `<span class="r-stars">${'<i class="on">★</i>'.repeat(stars)}${'<i>★</i>'.repeat(3 - stars)}</span>`;
  }
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
    tile('Max. G', `${f1(s.maxG)}<u>g</u>`, s.spec.payload ? `Fracht max ${s.spec.payload.g} g` : s.maxG > S.G_LIMIT ? 'zu hoch' : 'Crew ok', s.maxG > S.gLimitOf(s) ? 'bad' : '');
  // notes only for what went wrong (or the crash's outcome); base missions: what happened to the cargo
  const notes = [];
  if (mission) {
    const base = loadBase(mission.planetId), c = S.CARGO[mission.type];
    const unl = Object.entries(B.UNLOCKS[mission.type] ?? {}).flatMap(([sl, os]) => os.map((o) => S.BUILD_SLOTS.find((x) => x.id === sl).options.find((x) => x.id === o).name + ' ' + S.BUILD_SLOTS.find((x) => x.id === sl).short));
    if (mission.result === 'intact') notes.push([mission.contract ? `✓ ${c.name} geliefert · 📦 ${base.supplies ?? 0}` : `✓ ${c.name} · ${base.modules.length}/${S.MISSIONS.length}`, 'ok']);
    if ((mission.result === 'intact' || mission.result === 'damaged') && career() && unl.length) notes.push([`🔓 ${unl.join(', ')}`, 'ok']);
    if (mission.result === 'damaged') notes.push([`⚠ ${c.name} beschädigt (${s.cargoDamaged}) · ${base.modules.length}/${S.MISSIONS.length}`, 'warn']);
    if (mission.result === 'far') notes.push([`⚠ mehr als ${mission.contract ? CONTRACT_REACH : BASE_REACH} m vom Ziel – nicht geliefert`, 'warn']);
    if (mission.result === 'lost' && !c.crew) notes.push([`${c.name} verloren`, 'bad']);
  }
  if (rescue) {
    const sc = rescue.sc;
    if (rescue.result === 'saved') notes.push([`✓ ${sc.title} · ${RS.LEVELS[sc.level].name}`, 'ok']);
    if (rescue.pay) notes.push([`💰 +${E.cr(rescue.pay.fee)} Rettungsprämie${rescue.pay.repay ? ` (−${E.cr(rescue.pay.repay)} Kredit)` : ''} · ${E.cr(rescue.pay.money)}`, 'ok']);
    if (rescue.result === 'far') notes.push([`⚠ mehr als ${BASE_REACH} m von der Basis`, 'warn']);
  }
  // money: one figure on the result, the breakdown in its own window
  let money = '';
  if (mission?.pay) {
    const P = mission.pay, net = P.total - mission.cost.total;
    money = `<button id="r-money" class="r-money ${net >= 0 ? 'ok' : 'bad'}">${net >= 0 ? '+' : '−'}${E.cr(Math.abs(net))} <small>💰 ${E.cr(P.money)} · Details</small></button>`;
    const row = (k, v, cls) => `<tr class="${cls}"><td>${k}</td><td>${v >= 0 ? '+' : '−'}${E.cr(Math.abs(v))}</td></tr>`;
    $('money-rows').innerHTML = P.lines.map(([k, v]) => row(k, v, 'ok')).join('')
      + row(`Kosten (Teile ${E.cr(mission.cost.parts)}, Treibstoff ${E.cr(mission.cost.fuel)})`, -mission.cost.total, 'bad')
      + (P.repay ? row('Kredit getilgt', -P.repay, 'warn') : '')
      + `<tr class="sum ${net >= 0 ? 'ok' : 'bad'}"><td>Saldo</td><td>${net >= 0 ? '+' : '−'}${E.cr(Math.abs(net))}</td></tr><tr class="sum"><td>Konto</td><td>${E.cr(P.money)}</td></tr>`;
  }
  const delivered = mission && (mission.result === 'intact' || mission.result === 'damaged');
  $('r-again').innerHTML = delivered ? 'Zur Basis <kbd>R</kbd>' : rescue?.result === 'saved' ? 'Nächster Notruf <kbd>R</kbd>' : 'Nochmal <kbd>R</kbd>';
  if (!ok && s.crew.length) notes.push(crash.crew ? ['Crew gerettet', 'ok'] : ['Crew verloren', 'bad']);
  if (ok && s.unevenDamage) notes.push([`Boden uneben (${s.unevenDamage.toFixed(1).replace('.', ',')} m): Fahrwerk beschädigt`, 'warn']);
  if (!ok && crash.kind === 'explosion') notes.push([`${Math.round(crash.fuelBurned)} kg Treibstoff explodiert`, 'bad']);
  for (const c of s.crew) if (c.fainted) notes.push([`${c.name} ${c.fainted}× ohnmächtig`, 'warn']);
  for (const c of s.spec.comps) if (s.lost[c.id]) notes.push([`${c.name} verglüht`, 'bad']);
  if (s.chute === 'torn' || s.chute === 'burned') notes.push([`Fallschirm ${s.chute === 'torn' ? 'gerissen' : 'verglüht'}`, 'warn']);
  if ($('r-money-slot')) { $('r-money-slot').outerHTML = money.replace('class="r-money', 'class="r-money big'); money = ''; }
  $('r-notes').innerHTML = money + notes.map(([t, c]) => `<em class="${c}">${t}</em>`).join('');
  $('r-money')?.addEventListener('click', () => { $('money-detail').hidden = false; });
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
  if (e.code === 'KeyR' && mode !== 'menu') { if (mission && (mission.result === 'intact' || mission.result === 'damaged')) showMenu(); else start(planet); }
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
  if (e.code === 'Period' || e.code === 'Comma') stepWarp(e.code === 'Period' ? (warp === 10 ? 0 : 1) : -1);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// any tap or key skips the base fly-over
// the briefing ends with its start button (or Enter / Space)
for (const ev of ['pointerdown', 'click']) $('flyover').addEventListener(ev, (e) => { if (e.target.closest('#fly-go')) { e.preventDefault(); e.stopPropagation(); cam.flyGo = true; } });
addEventListener('keydown', (e) => { if (cam.fly !== null && cam.fly !== undefined && cam.fly > 0.3 && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space')) cam.flyGo = true; }, true);
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
const navball = createNavball($('c-rcs'));
function cycleSas() { doAct('sas'); }
// ---------- time warp (2×, 3×, 10×): only while nothing needs the pilot ----------
const WARPS = [1, 2, 3, 10];
let warp = 1;
/** a reason to leave the time warp, or null */
function warpStop(w = warp) {
  if (input.thrust || keys.has('Space')) return 'Schub';
  const tm = S.trackMiss(s);
  if (tm && Math.abs(tm.miss) > 40 && tm.ahead * s.planet.R > 2500 && tm.best < 6 * w && tm.best > -10) return 'Seitenmanöver';
  if (s.sas === 'side') return 'Seite';
  const og = S.aeroState(s) ? null : S.orbitGuide(s); // aerobraking: the pad passes every lap, no reason to stop
  if (og && og.brakeIn < 6 * w) return og.deorbit ? 'Deorbit-Punkt' : 'Bremspunkt';
  if (s.pred && s.pred.t < 8 * w) return 'Bodennähe';
  if (s.planet.rho > 0 && s.chute === 'stowed' && S.hasPart(s, 'chute') && S.chuteSafe(s) && S.altitude(s) < S.CHUTE_MAX_ALT(s.planet)) return 'Fallschirm';
  if (s.heatFlux > 15) return 'Hitze';
  if (s.crew.some((c) => c.fainted > 0) || !s.powered) return 'Notfall';
  return null;
}
function setWarp(k, why = '') {
  warp = k;
  const b = $('c-warp');
  setLabel(b, `${k}×`, '.', `Zeitraffer ${k}× (antippen: schneller)`);
  b.classList.toggle('on', k > 1);
  if (why && s) s.uiMsg = { text: `ZEITRAFFER ${k > 1 ? `${k}×` : 'AUS'}: ${why.toUpperCase()}`, until: s.t + 2 }; // shown by the HUD (not part of the flight model)
}
/** the fastest warp up to k that nothing objects to */
function safeWarp(k) { let w = k; while (w > 1 && warpStop(w)) w = WARPS[WARPS.indexOf(w) - 1]; return w; }
/** next warp step; refused (stays 1×, with the reason) when something needs the pilot */
function stepWarp(dir) {
  if (mode !== 'flight' || s.status !== 'flying' || (cam.fly !== null && cam.fly !== undefined)) return;
  const i = WARPS.indexOf(warp) + dir, k = dir > 0 ? WARPS[i % WARPS.length] : WARPS[Math.max(0, i)];
  const ok = safeWarp(k);
  setWarp(ok, ok < k ? warpStop(k) : '');
}
tap($('c-warp'), () => stepWarp(1));
function toggleCom() { showCom = !showCom; ship.helpers.visible = showCom; $('c-com').classList.toggle('on', showCom); try { localStorage.setItem('crashland.com', showCom ? '1' : '0'); } catch { /* storage unavailable */ } }
// switches fire on touch-down (iOS: the HUD swallows touches so nothing gets selected, see below);
// a click without a pointer (keyboard: Enter / Space on a focused button) still works
function tap(el, fn) {
  el.addEventListener('pointerdown', (e) => { if (e.button > 0 || el.disabled) return; e.preventDefault(); fn(); });
  el.addEventListener('click', (e) => { if (e.detail === 0) fn(); });
}
tap($('c-sas'), cycleSas);
tap($('c-chute'), () => doAct('chute'));
tap($('c-view'), toggleView);
tap($('c-panels'), () => doAct('panels'));
tap($('c-shield'), () => doAct('shield'));
tap($('c-com'), toggleCom);
// iOS: a long press or double tap in the flight HUD or on the 3D view would start a text selection or the
// copy / look-up menu. Swallowing the touches there stops that (pointer events still arrive).
const swallow = (e) => { if (!editable(e)) e.preventDefault(); };
$('hud').addEventListener('touchstart', swallow, { passive: false });
renderer.domElement.addEventListener('touchstart', swallow, { passive: false });
$('hud').addEventListener('touchend', swallow, { passive: false });
$('c-com').classList.toggle('on', showCom);
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
tap($('c-map'), () => toggleMap());
setLabel($('c-map'), 'Karte', 'K', 'Bahnkarte');
// help: the switches are icons only, this says what they do
$('icon-legend').innerHTML = [
  ['chute', '<b>Fallschirm</b> öffnen, offen: abwerfen · leuchtet orange, wenn er jetzt geht', 'P'],
  ['panels', '<b>Solarpaneele</b> ein-/ausklappen · rot, wenn sie zu heiß werden', 'E'],
  ['shield', '<b>Hitzeschild</b> abwerfen (nur wenn verbaut) · leuchtet, wenn die Hitze vorbei ist', 'J'],
  ['sas', '<b>Lageregler</b> wechseln (Modi siehe unten)', 'T'],
  ['view', '<b>Kamera</b>: hinter dem Lander oder Ziel-Ansicht', 'V'],
  ['map', '<b>Bahnkarte</b> (nur aus dem Orbit)', 'K'],
  ['warp', '<b>Zeitraffer</b> 1× → 2× → 3× → 10×; geht von selbst zurück vor Bremspunkt, Boden, Hitze und Schirm', '. ,'],
].map(([ic, txt, key]) => `<dt><svg viewBox="0 0 24 24">${ICONS[ic]}</svg></dt><dd>${txt} <kbd class="key-only">${key}</kbd></dd>`).join('');
setLabel($('c-com'), 'SP', 'C', 'Schwerpunkt anzeigen');
// buttons never take keyboard focus: otherwise Space (thrust) or Enter would also "press" the last clicked button
for (const b of document.querySelectorAll('#controls .tog')) b.addEventListener('mousedown', (e) => e.preventDefault());
$('r-again').addEventListener('click', () => {
  // base: after a delivered module the next mission starts with its briefing (the lander for that cargo)
  // base: after a delivered module back to the base cards (choose the next one)
  if (mission && (mission.result === 'intact' || mission.result === 'damaged')) { showMenu(); return; }
  start(planet);
});
$('result-open').addEventListener('click', () => { $('result').hidden = false; $('result-open').hidden = true; $('r-again').focus(); });
$('money-close').addEventListener('click', () => { $('money-detail').hidden = true; });
$('money-detail').addEventListener('click', (e) => { if (e.target === $('money-detail')) $('money-detail').hidden = true; });
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
// touch: the browser's double tap is swallowed (see above), so count it here
let lastTap = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; const now = performance.now(); if (now - lastTap < 320) cam.pitch = 0; lastTap = now; });
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
  // "Landen": the pad says where to fly (on the ground plane); otherwise it tilts the nose the way the navball
  // shows (the same as the ground plane while upright, and it stays right when the lander lies on its side)
  if ((s.sasPending ?? s.sas) === 'retro2') {
    const dxw = px * Math.cos(cam.yaw) - py * Math.sin(cam.yaw);
    const dzw = -px * Math.sin(cam.yaw) - py * Math.cos(cam.yaw);
    input.rcs = -dxw;  // roll: + tips the top to -x
    input.rcsZ = dzw;  // pitch: + tips the top to +z
  } else {
    const tl = padToTilt(s, cam.yaw, px, py);
    input.rcs = tl.rcs; input.rcsZ = tl.rcsZ;
  }
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
    // the flight waits while the base fly-over / rescue briefing runs
    // time warp: more fixed steps per frame (the physics stays the same); it drops back to 1× by itself
    if (warp > 1 && s.status === 'flying') { const why = warpStop(); if (why) setWarp(safeWarp(warp), why); }
    const k = timeScale * warp;
    if (cam.fly === null || cam.fly === undefined) acc += (k > 1 ? Math.min(raw, 0.25) : dt) * k; // fast-forward (tests): more steps per frame
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
      if (ev.type === 'sideDone') s.uiMsg = { text: 'BAHN ÜBER DER BASIS · LAGEREGLER: BREMSEN', until: s.t + 3 };
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
  if (mode !== 'menu') { hud.update(s, input, cam.yaw); navball.draw(s, cam.yaw); }

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
  // flight on a phone: the controls cover the lower part, so the picture is centred on the free area above them
  // (the lander and the touchdown cross are not hidden behind the buttons)
  else if (mode !== 'menu' && innerWidth < 560) {
    const tg = document.querySelector('#controls .toggles')?.getBoundingClientRect();
    const free = tg?.height ? tg.top : innerHeight, dy = Math.round((innerHeight - free) / 2 * 0.6);
    if (camera.view?.offsetY !== dy) camera.setViewOffset(innerWidth, innerHeight, 0, dy, innerWidth, innerHeight);
  } else if (camera.view?.enabled && !builder.active) camera.clearViewOffset();
  if (cam.fly !== null && cam.fly !== undefined && mode === 'flight') {
    // briefing: the camera circles the base, then the lander up in its orbit, and again, until Start
    cam.fly += dt;
    const done = cam.flyGo;
    $('flyover').hidden = done; document.body.classList.toggle('flyover', !done);
    if (done) cam.fly = null;
    else {
      const ph = cam.fly % (2 * FLY_T), onShip = ph >= FLY_T, u = onShip ? ph - FLY_T : ph;
      if (onShip) world.toRender(s.x, s.y + 2.5, s.z, _bv, _bq); else world.toRender(0, S.terrainHeight(0, 0), 0, _bv, _bq);
      const ang = 0.7 + u * 0.32 + (onShip ? 2 : 0), r = onShip ? 24 - u : 62 - u * 3;
      const off = new THREE.Vector3(Math.cos(ang) * r, onShip ? 4 + u * 0.5 : 30 + u * 2, Math.sin(ang) * r).applyQuaternion(_bq);
      camera.position.copy(_bv).add(off);
      camera.up.set(0, 1, 0).applyQuaternion(_bq);
      lookAt.copy(_bv);
    }
  }
  camera.lookAt(lookAt);
  placeShipMark(); placePredMark(); placeBase();
  if (mode === 'flight') orbitMap.draw(s);
  world.update(camera, focus, time, mode === 'menu' ? { x: 0, z: 0 } : { x: s.windX, z: s.windZ }, dt);
  renderer.render(scene, camera);
  debugFrame(raw, typeof stepsThisFrame === 'number' ? stepsThisFrame : 0);
});

world.setPlanet(planet); world.ready = true; fogBase = scene.fog.far;
showMenu();

// handle for automated tests
window.__crashland = { renderer, camera, cam, get state() { return s; }, exportFlight: flightRecord, act: doAct,
  go() { cam.flyGo = true; }, setWarp(k) { setWarp(k); }, get warp() { return warp; },
  setTimeScale(k) { timeScale = Math.max(1, Math.min(50, k)); }, setWind(i) { setWind(i); }, setSettings(o) { Object.assign(settings, o); }, get record() { return rec; }, startSeed(p, seed) { forceSeed = seed; start(p); }, start: (i) => start(i === 'orbit' ? S.ORBIT_PLANETS[0] : typeof i === 'string' ? S.ORBIT_PLANETS.find((p) => p.id === i) : S.PLANETS[i]), input, S, get mode() { return mode; }, setAutopilot(f) { autopilot = f; }, get world() { return world; }, builder, ship };
