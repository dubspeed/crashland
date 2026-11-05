// Pure 2D flight model (x = horizontal, y = up, angle a = tilt, CCW positive).
// No three.js here so it can be tuned and tested in node.

export const G0 = 9.81;
export const F_MAX = 185000;      // N, main engine
export const ISP = 290;           // s
export const RCS_TORQUE = 14000;  // N·m
export const G_LIMIT = 3.2;       // pilot limit (sustained); see CREW
// Crew: each member tolerates a different sustained g-load. Stress builds above the limit;
// at 1.0 they pass out and wake up again once it has dropped below WAKE.
export const CREW = [
  { id: 'kira', name: 'Kira', role: 'Pilotin', limit: 3.2, pilot: true },
  { id: 'bo', name: 'Bo', role: 'Ingenieur', limit: 2.9 },
  { id: 'ines', name: 'Ines', role: 'Wissenschaftlerin', limit: 2.6 },
];
export const WAKE = 0.55;
export const BAT_CAP = 100;       // %
export const FUEL_MAX = 600;     // kg capacity per tank (each mission loads planet.fuel in total)
export const FOOT_X = 2.0;        // m, half span of landing legs
// Touchdown window: upper bounds for grade 0 (sanft), 1 (hart), 2 (Fahrwerk beschädigt); above = crash.
// Atmosphere & parachute
export const BODY_CDA = 11;        // m², lander broadside drag area × Cd
export const CHUTE_CDA = 110;      // m², fully inflated canopy
export const CHUTE_INFLATE = 2.2;  // s to full inflation
export const CHUTE_QMAX = 5500;    // Pa, canopy tears above this dynamic pressure
export const CHUTE_FMAX = 70000;   // N, reefing limits the riser load
export const CHUTE_ARM = 3.5;      // m, riser attachment above the centre of mass (righting torque)

// Aerodynamic heating (game-scaled Sutton–Graves): flux ∝ sqrt(rho) · v³
export const HEAT_K = 55;           // K/s at rho = 1, v = 100 m/s, exposure 1
export const HEAT_COOL = 0.12;      // 1/s, cooling towards ambient
export const T_AMB = 20;

export const LAND = { vy: [2.5, 5, 8], vx: [1, 2.5, 4], tilt: [5, 10, 18] };
export const GRADES = [
  { id: 'soft', name: 'Sanft', color: 'var(--ok)' },
  { id: 'hard', name: 'Hart', color: 'var(--warn)' },
  { id: 'damage', name: 'Fahrwerk beschädigt', color: 'var(--amber)' },
  { id: 'crash', name: 'Crash', color: 'var(--bad)' },
];
/** 0..3 for a value against one LAND table */
export function grade(value, limits) {
  const i = limits.findIndex((l) => value <= l);
  return i < 0 ? 3 : i;
}

export const PLANETS = [
  { id: 'luna', name: 'Luna', g: 1.62, alt: 900, vy: -60, vx: 3, tilt: 2, solar: 1.0, fuel: 175, rho: 0, H: 1, atmo: 'keine',
    text: 'Geringe Schwerkraft. Viel Zeit, wenig Risiko. Gut zum Üben.',
    sky: 0x05060c, fog: 0x05060c, ground: 0x9b9a96, ground2: 0x6c6b68, sun: 0xffffff, stars: true },
  { id: 'mars', name: 'Mars', g: 3.71, alt: 1500, vy: -110, vx: -4, tilt: -3, solar: 0.45, fuel: 305, rho: 0.02, H: 11000, atmo: 'sehr dünn',
    text: 'Mittlere Schwerkraft, schwache Sonne. Auf die Batterie achten.',
    sky: 0xd4a27c, fog: 0xc89670, ground: 0xb4552f, ground2: 0x7d3a22, sun: 0xffe2c4 },
  { id: 'terra', name: 'Terra', g: 9.81, alt: 1800, vy: -165, vx: 5, tilt: 4, solar: 0.75, fuel: 200, rho: 1.225, H: 8500, atmo: 'normal',
    text: 'Volle Erdschwerkraft. Der Burn muss sitzen, die G-Last steigt schnell.',
    sky: 0x8ec5ff, fog: 0xa9d2ff, ground: 0x5f9a4c, ground2: 0x7a6145, sun: 0xffffff },
  { id: 'brontes', name: 'Brontes', g: 15.2, alt: 2400, vy: -90, vx: -3, tilt: -2, solar: 0.3, fuel: 230, rho: 2.8, H: 7000, atmo: 'dicht',
    text: 'Supererde. Kaum Schubreserve, wenig Licht. Nur für Profis.',
    sky: 0x3b2f5c, fog: 0x463868, ground: 0x2f6e6a, ground2: 0x1f4442, sun: 0xd8c8ff },
];

// Ship components: local position (m) relative to the foot plane centre; mass in kg.
export const COMPONENTS = [
  { id: 'capsule',  name: 'Kommandokapsel',   model: 'capsule',  mass: 1500, pos: [0, 4.5, 0], heat: [0.1, 2000] },
  { id: 'frame',    name: 'Rahmen',           model: 'frame',    mass: 350,  pos: [0, 2.9, 0], heat: [0.5, 1300] },
  { id: 'engine',   name: 'Antrieb',          model: 'engine',   mass: 950,  pos: [0, 1.5, 0], heat: [1.0, 1800] },
  { id: 'tankL',    name: 'Treibstofftank L', model: 'tank',     mass: 200,  pos: [-1.15, 2.9, 0], fuel: 'fuelL', heat: [0.6, 640] },
  { id: 'tankR',    name: 'Treibstofftank R', model: 'tank',     mass: 200,  pos: [1.15, 2.9, 0], fuel: 'fuelR', heat: [0.6, 640] },
  { id: 'solarL',   name: 'Solarpaneel L',    model: 'solar',    mass: 110,  pos: [-2.5, 4.25, 0], mirror: true, heat: [1.0, 560] },
  { id: 'solarR',   name: 'Solarpaneel R',    model: 'solar',    mass: 110,  pos: [2.5, 4.25, 0], heat: [1.0, 560] },
  { id: 'computer', name: 'Bordcomputer',     model: 'computer', mass: 150,  pos: [0.35, 2.85, 0.8], heat: [0.12, 330] },
  { id: 'battery',  name: 'Batterien',        model: 'battery',  mass: 420,  pos: [-0.3, 2.85, -0.8], heat: [0.12, 300] },
  { id: 'chute',    name: 'Fallschirm',       model: 'chutepack', mass: 120, pos: [0, 5.55, 0], heat: [0.28, 260] },
  { id: 'legs',     name: 'Landebeine',       model: 'legs',     mass: 380,  pos: [0, 0, 0], com: [0, 0.9], heat: [0.9, 950] },
];

// ---------- terrain ----------
const PAD_R = 45;
function noise(x, z) {
  return Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017) * 14
       + Math.sin(x * 0.067 + z * 0.041) * 5
       + Math.sin(x * 0.13 - z * 0.11 + 2.1) * 2;
}
export function terrainHeight(x, z = 0) {
  const r = Math.hypot(x, z);
  const t = Math.min(1, Math.max(0, (r - PAD_R) / 60));
  const blend = t * t * (3 - 2 * t);
  return (noise(x, z) + 6) * blend;
}

// ---------- state ----------
export function createState(planet) {
  return {
    planet, t: 0,
    x: 0, y: planet.alt, vx: planet.vx, vy: planet.vy,
    a: (planet.tilt * Math.PI) / 180, w: 0,
    fuel0: planet.fuel, fuelL: planet.fuel / 2, fuelR: planet.fuel / 2, battery: BAT_CAP,
    limit: 1, throttle: 0, sas: 'retro',
    gNow: 0, maxG: 0, gStress: 0, gOverTime: 0, powered: true, blackout: false,
    crew: CREW.map((c) => ({ ...c, stress: 0, out: false, fainted: 0 })),
    torqueCom: 0, sasTorque: 0, temp: Object.fromEntries(COMPONENTS.map((c) => [c.id, T_AMB])), lost: {}, events: [],
    chute: 'stowed', chuteT: 0, chuteInflate: 0, chuteOpen: 0, q: 0, maxQ: 0, drag: 0,
    status: 'flying', reason: '', touch: null, log: [],
  };
}

export function massProps(s) {
  let m = 0, mx = 0, my = 0;
  const parts = COMPONENTS.filter((c) => !s.lost?.[c.id]).map((c) => {
    const mass = c.mass + (c.fuel ? s[c.fuel] : 0);
    const [px, py] = c.com || c.pos;
    m += mass; mx += mass * px; my += mass * py;
    return [mass, px, py];
  });
  const cx = mx / m, cy = my / m;
  let I = 0;
  for (const [mass, px, py] of parts) I += mass * ((px - cx) ** 2 + (py - cy) ** 2 + 0.4);
  return { m, cx, cy, I };
}

/** Air density at the lander's height. */
export function density(s) { return s.planet.rho * Math.exp(-Math.max(0, s.y) / s.planet.H); }

/** P key / button: deploy the stowed chute, or cut an open one. Returns what happened. */
export function toggleChute(s) {
  if (s.status !== 'flying') return null;
  if (s.chute === 'stowed' && !s.lost.chute) {
    s.chute = 'open'; s.chuteT = 0;
    return s.planet.rho > 0 ? 'open' : 'useless';
  }
  if (s.chute === 'open') { s.chute = 'cut'; return 'cut'; }
  return null;
}

export function fuel(s) { return s.fuelL + s.fuelR; }

/** Bordcomputer: stopping distance at the current throttle limit (m), Infinity if impossible. */
export function stoppingDistance(s) {
  const { m } = massProps(s);
  const maxFrac = s.powered ? 1 : 0.6;
  const acc = (F_MAX * Math.min(s.limit, maxFrac) / m) * Math.cos(s.a) - s.planet.g;
  if (s.vy >= 0) return 0;
  if (acc <= 0) return Infinity;
  return (s.vy * s.vy) / (2 * acc);
}

export function altitude(s) {
  const c = Math.cos(s.a), sn = Math.sin(s.a);
  let min = Infinity;
  for (const fx of [-FOOT_X, FOOT_X]) {
    const wx = s.x + fx * c, wy = s.y + fx * sn;
    min = Math.min(min, wy - terrainHeight(wx));
  }
  return min;
}

/** A component overheated: it explodes and breaks off, with consequences. */
export function destroy(s, id) {
  if (s.lost[id]) return;
  s.lost[id] = true;
  s.events.push({ type: 'lost', id, t: s.t });
  if (id === 'tankL') s.fuelL = 0;
  if (id === 'tankR') s.fuelR = 0;
  if (id === 'battery') s.battery = 0;
  if (id === 'chute') s.chute = s.chute === 'open' ? 'torn' : 'burned';
}

/** input: { thrust: bool, rcs: -1..1 } */
export function step(s, input, dt) {
  if (s.status !== 'flying') return;
  const p = s.planet;
  s.t += dt;
  s.powered = s.battery > 0 && !s.lost.battery;
  s.computerOK = s.powered && !s.lost.computer;
  s.blackout = s.crew[0].out;

  // --- engine ---
  let thr = input.thrust && !s.blackout ? s.limit : 0;
  if (!s.powered) thr = Math.min(thr, 0.6); // pumps off -> pressure-fed only
  if (fuel(s) <= 0) thr = 0;
  const mdot = (thr * F_MAX) / (ISP * G0);
  // both tanks feed the engine evenly; if one runs dry the other takes over
  const need = mdot * dt;
  const takeL = Math.min(s.fuelL, need / 2 + Math.max(0, need / 2 - s.fuelR));
  const takeR = Math.min(s.fuelR, need - takeL);
  s.fuelL = Math.max(0, s.fuelL - takeL);
  s.fuelR = Math.max(0, s.fuelR - takeR);
  s.throttle = thr;

  const { m, cx, I } = massProps(s);
  const F = thr * F_MAX;
  const ux = -Math.sin(s.a), uy = Math.cos(s.a);

  // --- attitude ---
  s.torqueCom = -cx * F; // thrust through the engine axis, CoM off-axis -> torque
  let tau = s.torqueCom;
  let rcsUse = 0;
  s.sasTorque = 0;
  if (!s.blackout && input.rcs) {
    tau += input.rcs * RCS_TORQUE; rcsUse = Math.abs(input.rcs);
  } else if (s.sas && s.computerOK && !s.blackout) {
    // 'up' holds vertical, 'retro' leans against horizontal drift (max 15°)
    const target = s.sas === 'retro' && thr > 0 ? Math.max(-0.26, Math.min(0.26, s.vx * 0.06)) : 0;
    const want = -(2.2 * (s.a - target) + 2.6 * s.w) * I - s.torqueCom;
    s.sasTorque = Math.max(-RCS_TORQUE, Math.min(RCS_TORQUE, want));
    tau += s.sasTorque; rcsUse = Math.abs(s.sasTorque) / RCS_TORQUE;
  }
  s.w += (tau / I) * dt;
  s.a += s.w * dt;

  // --- aerodynamics: body drag + parachute ---
  const v = Math.hypot(s.vx, s.vy);
  s.q = 0.5 * density(s) * v * v;
  s.maxQ = Math.max(s.maxQ, s.q);
  if (s.chute === 'open') {
    s.chuteT += dt;
    const k = Math.min(1, s.chuteT / CHUTE_INFLATE);
    s.chuteInflate = k * k * (3 - 2 * k);
    if (s.planet.rho > 0 && s.q > CHUTE_QMAX && s.chuteInflate > 0.2) s.chute = 'torn';
  } else s.chuteInflate = Math.max(0, s.chuteInflate - dt * 2);
  // reefed canopy: opens only as far as the riser load allows
  const chuteCda = s.chute === 'open' && s.planet.rho > 0 ? Math.min(CHUTE_CDA * s.chuteInflate, CHUTE_FMAX / Math.max(s.q, 1)) : 0;
  s.chuteOpen = chuteCda / CHUTE_CDA; // 0..1 how far the canopy is actually open
  const cda = BODY_CDA + chuteCda;
  const Fd = s.q * cda;
  s.drag = Fd;
  const dx = v > 0.01 ? (-Fd * s.vx) / v : 0, dy = v > 0.01 ? (-Fd * s.vy) / v : 0;
  if (s.chute === 'open' && s.planet.rho > 0 && s.chuteInflate > 0.05) {
    // canopy hangs above the CoM and pulls the lander upright
    const pull = s.q * CHUTE_CDA * Math.min(s.chuteInflate, CHUTE_FMAX / Math.max(s.q, 1) / CHUTE_CDA) * CHUTE_ARM;
    s.w += ((-Math.sin(s.a) * pull - s.w * pull * 0.6) / I) * dt;
  }

  // --- translation ---
  s.vx += ((F * ux + dx) / m) * dt;
  s.vy += ((F * uy + dy) / m - p.g) * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;

  // --- crew g-load ---
  // felt load = all non-gravitational acceleration (engine + air)
  s.gNow = Math.hypot(F * ux + dx, F * uy + dy) / m / G0;
  s.maxG = Math.max(s.maxG, s.gNow);
  for (const c of s.crew) {
    if (s.gNow > c.limit) c.stress += (s.gNow - c.limit) * 0.35 * dt;
    else c.stress = Math.max(0, c.stress - (s.gNow < 1.2 ? 0.15 : 0.06) * dt);
    if (!c.out && c.stress >= 1) { c.out = true; c.fainted++; c.stress = 1; }
    else if (c.out && c.stress < WAKE) c.out = false;
  }
  if (s.gNow > G_LIMIT) s.gOverTime += dt;
  s.gStress = s.crew[0].stress;

  // --- power ---
  const use = 1.0 + (s.sas ? 0.4 : 0) + 2.2 * rcsUse + 1.2 * thr;
  const panels = (s.lost.solarL ? 0 : 1) + (s.lost.solarR ? 0 : 1);
  const gain = 1.6 * p.solar * (panels / 2);
  s.battery = Math.max(0, Math.min(BAT_CAP, s.battery + (gain - use) * dt));

  // --- aerodynamic heating: hot parts glow, overheated parts blow off ---
  const flux = Math.sqrt(density(s)) * (v / 100) ** 3 * HEAT_K;
  s.heatFlux = flux;
  const sideways = Math.sin(s.a); // tilt exposes one side more
  for (const c of COMPONENTS) {
    if (s.lost[c.id] || !c.heat) continue;
    const side = Math.sign(c.pos[0]);
    const exp = Math.max(0, c.heat[0] * (1 + side * sideways * 2.5));
    s.temp[c.id] += (flux * exp - HEAT_COOL * (s.temp[c.id] - T_AMB)) * dt;
    if (s.temp[c.id] > c.heat[1]) destroy(s, c.id);
  }

  // --- touchdown ---
  const alt = altitude(s);
  if (alt <= 0) {
    const tilt = Math.abs((s.a * 180) / Math.PI);
    const hL = terrainHeight(s.x - FOOT_X), hR = terrainHeight(s.x + FOOT_X);
    const sink = -s.vy, drift = Math.abs(s.vx);
    const g = { vy: grade(sink, LAND.vy), vx: grade(drift, LAND.vx), tilt: grade(tilt, LAND.tilt) };
    const why = [];
    if (g.vy === 3) why.push(`zu schnell (${sink.toFixed(1)} m/s, max ${LAND.vy[2]})`);
    if (g.vx === 3) why.push(`seitliche Drift (${drift.toFixed(1)} m/s, max ${LAND.vx[2]})`);
    if (g.tilt === 3) why.push(`zu schräg (${tilt.toFixed(0)}°, max ${LAND.tilt[2]}°)`);
    if (Math.abs(hL - hR) > 0.8) why.push('Gelände zu uneben');
    if (s.lost.legs) why.push('Landebeine verglüht');
    const overall = why.length ? 3 : Math.max(g.vy, g.vx, g.tilt);
    // crash energy 0..1: how violent the impact was (drives the explosion size)
    const energy = Math.min(1, Math.max(0, (sink - LAND.vy[2]) / 18 + (drift - LAND.vx[2]) / 25 + 0.1));
    s.touch = { vy: sink, vx: drift, tilt, grades: g, grade: overall, energy };
    s.status = overall === 3 ? 'crashed' : 'landed';
    s.reason = why.join(', ');
    s.y -= alt; // snap to ground
  }
}
