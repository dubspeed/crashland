// Pure 2D flight model (x = horizontal, y = up, angle a = tilt, CCW positive).
// No three.js here so it can be tuned and tested in node.

export const G0 = 9.81;
export const F_MAX = 185000;      // N, main engine
export const ISP = 290;           // s
export const RCS_TORQUE = 14000;  // N·m
export const G_LIMIT = 3.0;       // crew limit (sustained)
export const BAT_CAP = 100;       // %
export const FUEL_MAX = 600;     // kg per tank
export const FOOT_X = 2.0;        // m, half span of landing legs
export const LAND = { vy: 3.5, vx: 2.0, tilt: 10 }; // touchdown limits (m/s, m/s, deg)

export const PLANETS = [
  { id: 'luna', name: 'Luna', g: 1.62, alt: 900, vy: -60, vx: 3, tilt: 2, solar: 1.0,
    text: 'Geringe Schwerkraft. Viel Zeit, wenig Risiko. Gut zum Üben.',
    sky: 0x05060c, fog: 0x05060c, ground: 0x9b9a96, ground2: 0x6c6b68, sun: 0xffffff, stars: true },
  { id: 'mars', name: 'Mars', g: 3.71, alt: 1200, vy: -95, vx: -4, tilt: -3, solar: 0.45,
    text: 'Mittlere Schwerkraft, schwache Sonne. Auf die Batterie achten.',
    sky: 0xd4a27c, fog: 0xc89670, ground: 0xb4552f, ground2: 0x7d3a22, sun: 0xffe2c4 },
  { id: 'terra', name: 'Terra', g: 9.81, alt: 1600, vy: -140, vx: 5, tilt: 4, solar: 0.75,
    text: 'Volle Erdschwerkraft. Der Burn muss sitzen, die G-Last steigt schnell.',
    sky: 0x8ec5ff, fog: 0xa9d2ff, ground: 0x5f9a4c, ground2: 0x7a6145, sun: 0xffffff },
  { id: 'brontes', name: 'Brontes', g: 15.2, alt: 1800, vy: -120, vx: -3, tilt: -2, solar: 0.3,
    text: 'Supererde. Kaum Schubreserve, wenig Licht. Nur für Profis.',
    sky: 0x3b2f5c, fog: 0x463868, ground: 0x2f6e6a, ground2: 0x1f4442, sun: 0xd8c8ff },
];

// Ship components: local position (m) relative to the foot plane centre; mass in kg.
export const COMPONENTS = [
  { id: 'capsule',  name: 'Kommandokapsel',   model: 'capsule',  mass: 1500, pos: [0, 4.5, 0] },
  { id: 'frame',    name: 'Rahmen',           model: 'frame',    mass: 350,  pos: [0, 2.9, 0] },
  { id: 'engine',   name: 'Antrieb',          model: 'engine',   mass: 950,  pos: [0, 1.5, 0] },
  { id: 'tankL',    name: 'Treibstofftank L', model: 'tank',     mass: 200,  pos: [-1.15, 2.9, 0], fuel: 'fuelL' },
  { id: 'tankR',    name: 'Treibstofftank R', model: 'tank',     mass: 200,  pos: [1.15, 2.9, 0], fuel: 'fuelR' },
  { id: 'solarL',   name: 'Solarpaneel L',    model: 'solar',    mass: 110,  pos: [-2.5, 4.25, 0], mirror: true },
  { id: 'solarR',   name: 'Solarpaneel R',    model: 'solar',    mass: 110,  pos: [2.5, 4.25, 0] },
  { id: 'computer', name: 'Bordcomputer',     model: 'computer', mass: 150,  pos: [0.35, 2.85, 0.8] },
  { id: 'battery',  name: 'Batterien',        model: 'battery',  mass: 420,  pos: [-0.3, 2.85, -0.8] },
  { id: 'legs',     name: 'Landebeine',       model: 'legs',     mass: 380,  pos: [0, 0, 0], com: [0, 0.9] },
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
    fuelL: FUEL_MAX, fuelR: FUEL_MAX, battery: BAT_CAP,
    limit: 1, throttle: 0, sas: 'retro', feed: 'LR',
    gNow: 0, maxG: 0, gStress: 0, gOverTime: 0, powered: true, blackout: false,
    torqueCom: 0, sasTorque: 0,
    status: 'flying', reason: '', touch: null, log: [],
  };
}

export function massProps(s) {
  let m = 0, mx = 0, my = 0;
  const parts = COMPONENTS.map((c) => {
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

/** input: { thrust: bool, rcs: -1..1 } */
export function step(s, input, dt) {
  if (s.status !== 'flying') return;
  const p = s.planet;
  s.t += dt;
  s.powered = s.battery > 0;
  s.blackout = s.gStress >= 1;

  // --- engine ---
  let thr = input.thrust && !s.blackout ? s.limit : 0;
  if (!s.powered) thr = Math.min(thr, 0.6); // pumps off -> pressure-fed only
  if (fuel(s) <= 0) thr = 0;
  const mdot = (thr * F_MAX) / (ISP * G0);
  let need = mdot * dt;
  let shareL = s.feed === 'L' ? 1 : s.feed === 'R' ? 0 : 0.56; // valve R sticks a little
  const takeL = Math.min(s.fuelL, need * shareL);
  const takeR = Math.min(s.fuelR, need - takeL);
  const rest = need - takeL - takeR;
  s.fuelL -= takeL + Math.min(s.fuelL - takeL, rest);
  s.fuelR -= takeR;
  s.fuelL = Math.max(0, s.fuelL); s.fuelR = Math.max(0, s.fuelR);
  if (s.feed === 'R' && s.fuelR <= 0) s.feed = 'LR';
  if (s.feed === 'L' && s.fuelL <= 0) s.feed = 'LR';
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
  } else if (s.sas && s.powered && !s.blackout) {
    // 'up' holds vertical, 'retro' leans against horizontal drift (max 15°)
    const target = s.sas === 'retro' ? Math.max(-0.26, Math.min(0.26, s.vx * 0.06)) : 0;
    const want = -(2.2 * (s.a - target) + 2.6 * s.w) * I - s.torqueCom;
    s.sasTorque = Math.max(-RCS_TORQUE, Math.min(RCS_TORQUE, want));
    tau += s.sasTorque; rcsUse = Math.abs(s.sasTorque) / RCS_TORQUE;
  }
  s.w += (tau / I) * dt;
  s.a += s.w * dt;

  // --- translation ---
  s.vx += (F / m) * ux * dt;
  s.vy += ((F / m) * uy - p.g) * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;

  // --- crew g-load ---
  s.gNow = F / m / G0;
  s.maxG = Math.max(s.maxG, s.gNow);
  if (s.gNow > G_LIMIT) { s.gStress += (s.gNow - G_LIMIT) * 0.35 * dt; s.gOverTime += dt; }
  else s.gStress = Math.max(0, s.gStress - 0.06 * dt);

  // --- power ---
  const use = 1.0 + (s.sas ? 0.4 : 0) + 2.2 * rcsUse + 1.2 * thr;
  const gain = 1.6 * p.solar;
  s.battery = Math.max(0, Math.min(BAT_CAP, s.battery + (gain - use) * dt));

  // --- touchdown ---
  const alt = altitude(s);
  if (alt <= 0) {
    const tilt = Math.abs((s.a * 180) / Math.PI);
    const hL = terrainHeight(s.x - FOOT_X), hR = terrainHeight(s.x + FOOT_X);
    s.touch = { vy: -s.vy, vx: Math.abs(s.vx), tilt, impactG: Math.abs(s.vy) / (G0 * 0.15) };
    const why = [];
    if (-s.vy > LAND.vy) why.push(`zu schnell (${(-s.vy).toFixed(1)} m/s)`);
    if (Math.abs(s.vx) > LAND.vx) why.push(`seitliche Drift (${Math.abs(s.vx).toFixed(1)} m/s)`);
    if (tilt > LAND.tilt) why.push(`zu schräg (${tilt.toFixed(0)}°)`);
    if (Math.abs(hL - hR) > 0.8) why.push('Gelände zu uneben');
    s.status = why.length ? 'crashed' : 'landed';
    s.reason = why.join(', ');
    s.y -= alt; // snap to ground
  }
}
