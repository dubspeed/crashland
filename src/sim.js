// Flight model in 3D: position x/y/z (y up), attitude as two tilts:
//   a = roll about the z axis (positive tips the top towards -x), w = its rate
//   b = pitch about the x axis (positive tips the top towards +z), wb = its rate
// Ship orientation = Rx(b) · Rz(a), so the thrust axis is u = (-sin a, cos a cos b, cos a sin b).
// No three.js here so it can be tuned and tested in node.

export const G0 = 9.81;
export const F_MAX = 185000;      // N, main engine
export const ISP = 290;           // s
export const RCS_TORQUE = 14000;  // N·m
export const MAX_RATE = 0.4;      // rad/s, turn rate at full pad deflection in attitude-hold mode
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
export const CHUTE_ARM = 3.5;
export const CHUTE_GLIDE = 5;      // m/s, steerable canopy: max glide speed through the air      // m, riser attachment above the centre of mass (righting torque)

// Aerodynamic heating (game-scaled Sutton–Graves): flux ∝ sqrt(rho) · v³
export const HEAT_K = 55;           // K/s at rho = 1, v = 100 m/s, exposure 1
export const HEAT_COOL = 0.12;      // 1/s, cooling towards ambient
export const T_AMB = 20;

// Wind: base speed at altitude per setting, gusts on top, weaker near the ground (shear)
export const WIND_LEVELS = [
  { id: 'off', name: 'Aus', speed: 0, gust: 0, bonus: 1 },
  { id: 'light', name: 'Leicht', speed: 5, gust: 0.25, bonus: 1.1 },
  { id: 'medium', name: 'Mittel', speed: 10, gust: 0.35, bonus: 1.25 },
  { id: 'strong', name: 'Stark', speed: 17, gust: 0.45, bonus: 1.5 },
  { id: 'storm', name: 'Sturm', speed: 26, gust: 0.55, bonus: 1.8 },
];
export const WIND_ARM = 0.45;       // m, side-force centre of pressure above the CoM (panels folded)
export const WIND_ARM_PANELS = 1.1; // m, with the solar wings out

/** Air velocity {x, z, speed} at the lander's position and time; W.heading = direction the wind blows to. */
export function windAt(s, alt = altitude(s), t = s.t) {
  const W = s.wind;
  if (!W || !W.speed || s.planet.rho <= 0) return { x: 0, z: 0, speed: 0 };
  const k = W.seed;
  const gust = Math.sin(t * 0.55 + k) * 0.55 + Math.sin(t * 1.37 + k * 2.1) * 0.3 + Math.sin(t * 3.1 + k * 3.7) * 0.15;
  const shear = 0.35 + 0.65 * Math.min(1, Math.max(0, alt) / 300);
  const speed = W.speed * shear * (1 + W.gust * gust);
  const h = W.heading + Math.sin(t * 0.21 + k) * 0.12; // slow veer of a few degrees
  return { x: Math.cos(h) * speed, z: Math.sin(h) * speed, speed };
}

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
  { id: 'luna', name: 'Luna', g: 1.62, alt: 900, vy: -60, vx: 3, tilt: 2, solar: 1.0, fuel: 175, rho: 0, H: 1, atmo: 'keine', drift: 0,
    text: 'Wenig Schwerkraft, keine Luft. Zum Üben.',
    sky: 0x05060c, fog: 0x05060c, ground: 0x9b9a96, ground2: 0x6c6b68, sun: 0xffffff, stars: true },
  { id: 'mars', name: 'Mars', g: 3.71, alt: 1500, vy: -110, vx: -4, tilt: -3, solar: 0.45, fuel: 305, rho: 0.02, H: 11000, atmo: 'sehr dünn', drift: 4,
    text: 'Dünne Luft, schwache Sonne.',
    sky: 0xd4a27c, fog: 0xc89670, ground: 0xb4552f, ground2: 0x7d3a22, sun: 0xffe2c4 },
  { id: 'terra', name: 'Terra', g: 9.81, alt: 1800, vy: -165, vx: 5, tilt: 4, solar: 0.75, fuel: 200, rho: 1.225, H: 8500, atmo: 'normal', drift: 17,
    text: 'Hitze beim Eintritt, Fallschirm hilft.',
    sky: 0x8ec5ff, fog: 0xa9d2ff, ground: 0x5f9a4c, ground2: 0x7a6145, sun: 0xffffff },
  { id: 'brontes', name: 'Brontes', g: 15.2, alt: 1800, vy: -90, vx: -3, tilt: -2, solar: 0.3, fuel: 230, rho: 2.8, H: 7000, atmo: 'dicht', drift: 20,
    text: 'Supererde. Erst bremsen, dann Schirm.',
    sky: 0x3b2f5c, fog: 0x463868, ground: 0x2f6e6a, ground2: 0x1f4442, sun: 0xd8c8ff },
];

// Ship components: local position (m) relative to the foot plane centre; mass in kg.
export const COMPONENTS = [
  { id: 'capsule',  name: 'Kommandokapsel',   model: 'capsule',  mass: 1500, pos: [0, 4.5, 0], heat: [0.1, 2000] },
  { id: 'frame',    name: 'Rahmen',           model: 'frame',    mass: 350,  pos: [0, 2.9, 0], heat: [0.5, 1300] },
  { id: 'engine',   name: 'Antrieb',          model: 'engine',   mass: 950,  pos: [0, 1.5, 0], heat: [1.0, 1800] },
  { id: 'tankL',    name: 'Treibstofftank L', model: 'tank',     mass: 200,  pos: [-1.15, 2.9, 0], fuel: 'fuelL', heat: [0.6, 640] },
  { id: 'tankR',    name: 'Treibstofftank R', model: 'tank',     mass: 200,  pos: [1.15, 2.9, 0], fuel: 'fuelR', heat: [0.6, 640] },
  { id: 'solarL',   name: 'Solarpaneel L',    model: 'solar',    mass: 110,  pos: [-2.5, 4.25, 0], mirror: true, heat: [2.2, 480, 4] },
  { id: 'solarR',   name: 'Solarpaneel R',    model: 'solar',    mass: 110,  pos: [2.5, 4.25, 0], heat: [2.2, 480, 4] },
  { id: 'computer', name: 'Bordcomputer',     model: 'computer', mass: 150,  pos: [0.35, 2.85, 0.8], heat: [0.12, 330] },
  { id: 'battery',  name: 'Batterien',        model: 'battery',  mass: 420,  pos: [-0.3, 2.85, -0.8], heat: [0.12, 300] },
  { id: 'chute',    name: 'Fallschirm',       model: 'chutepack', mass: 120, pos: [0, 5.55, 0], heat: [0.28, 260] },
  { id: 'legs',     name: 'Landebeine',       model: 'legs',     mass: 380,  pos: [0, 0, 0], com: [0, 0.9], heat: [0.9, 950] },
];

// ---------- terrain ----------
const PAD_R = 70;
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
export function createState(planet, opts = {}) {
  const lvl = WIND_LEVELS[opts.wind ?? 0] ?? WIND_LEVELS[0];
  // wind heading: opts.windHeading (rad), or the old ±1 along x, or random
  const heading = opts.windHeading ?? (opts.windDir === -1 ? Math.PI : opts.windDir === 1 ? 0 : Math.random() * Math.PI * 2);
  const rnd = opts.rnd ?? Math.random;
  const off = planet.rho > 0 ? lvl.speed * planet.drift : 0;
  const t0 = (planet.tilt * Math.PI) / 180, b0 = opts.pitch0 ?? (rnd() - 0.5) * 0.06;
  const side = rnd() < 0.5 ? -1 : 1;
  return {
    planet, t: 0,
    wind: { level: WIND_LEVELS.indexOf(lvl), name: lvl.name, speed: lvl.speed, gust: lvl.gust, bonus: lvl.bonus,
      heading, dir: Math.cos(heading) >= 0 ? 1 : -1, seed: opts.windSeed ?? rnd() * 100 },
    windNow: 0, windX: 0, windZ: 0, windTorque: 0, windTorqueB: 0,
    // start upwind so the wind carries the lander roughly towards the pad
    x: -Math.cos(heading) * off, z: -Math.sin(heading) * off, y: planet.alt,
    vx: planet.vx, vy: planet.vy, vz: opts.vz0 ?? side * Math.abs(planet.vx) * 0.7,
    a: t0, w: 0, b: b0, wb: 0,
    fuel0: planet.fuel, fuelL: planet.fuel / 2, fuelR: planet.fuel / 2, battery: BAT_CAP,
    limit: 1, throttle: 0, sas: 'hold', holdA: t0, holdB: b0, sasI: 0, sasIB: 0,
    gNow: 0, maxG: 0, gStress: 0, gOverTime: 0, powered: true, blackout: false,
    crew: CREW.map((c) => ({ ...c, stress: 0, out: false, fainted: 0 })),
    torqueCom: 0, torqueComB: 0, sasTorque: 0, temp: Object.fromEntries(COMPONENTS.map((c) => [c.id, T_AMB])), lost: {}, events: [],
    panels: 'out', panelFold: 0,
    chute: 'stowed', chuteT: 0, chuteInflate: 0, chuteOpen: 0, q: 0, maxQ: 0, drag: 0,
    status: 'flying', reason: '', touch: null, log: [],
  };
}

export function massProps(s) {
  let m = 0, mx = 0, my = 0, mz = 0;
  const parts = COMPONENTS.filter((c) => !s.lost?.[c.id]).map((c) => {
    const mass = c.mass + (c.fuel ? s[c.fuel] : 0);
    const [px, py, pz = 0] = c.com || c.pos;
    m += mass; mx += mass * px; my += mass * py; mz += mass * pz;
    return [mass, px, py];
  });
  const cx = mx / m, cy = my / m, cz = mz / m;
  let I = 0; // same inertia assumed about both tilt axes
  for (const [mass, px, py] of parts) I += mass * ((px - cx) ** 2 + (py - cy) ** 2 + 0.4);
  return { m, cx, cy, cz, I };
}

/** Where the lander would touch down if nothing changes from now on (no thrust): gravity, drag with the
 *  current canopy, wind and its shear included. Returns { x, z, t } or null if it never gets there. */
export function predictImpact(s) {
  const { m } = massProps(s);
  const chuteK = s.chute === 'open' && s.planet.rho > 0 ? s.chuteInflate : 0;
  let x = s.x, y = s.y, z = s.z, vx = s.vx, vy = s.vy, vz = s.vz, t = 0;
  const h = 0.1;
  for (let i = 0; i < 1200; i++) {
    const ground = terrainHeight(x, z);
    if (y <= ground) return { x, z, t };
    const alt = y - ground;
    const w = windAt(s, alt, s.t + t);
    const rx = vx - w.x, rz = vz - w.z, v = Math.hypot(rx, vy, rz);
    const rho = s.planet.rho * Math.exp(-Math.max(0, y) / s.planet.H);
    const q = 0.5 * rho * v * v;
    const Fd = q * BODY_CDA + Math.min(q * CHUTE_CDA * chuteK, chuteK > 0 ? CHUTE_FMAX : 0);
    const k = v > 0.01 ? -Fd / v / m : 0;
    vx += k * rx * h; vy += (k * vy - s.planet.g) * h; vz += k * rz * h;
    x += vx * h; y += vy * h; z += vz * h; t += h;
  }
  return null;
}

/** Thrust axis (unit vector) for the current attitude. */
export function upVector(s) {
  const ca = Math.cos(s.a);
  return { x: -Math.sin(s.a), y: ca * Math.cos(s.b || 0), z: ca * Math.sin(s.b || 0) };
}
/** Total tilt from vertical in degrees. */
export function tiltDeg(s) { return (Math.acos(Math.min(1, Math.cos(s.a) * Math.cos(s.b || 0))) * 180) / Math.PI; }
/** Horizontal speed over ground. */
export function drift(s) { return Math.hypot(s.vx, s.vz || 0); }

/** Air density at the lander's height. */
export function density(s) { return s.planet.rho * Math.exp(-Math.max(0, s.y) / s.planet.H); }

/** Fold the solar panels in (protected from heat, no charging) or out again. */
export function togglePanels(s) {
  if (s.status !== 'flying') return;
  s.panels = s.panels === 'out' ? 'in' : 'out';
}

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

/** Bordcomputer burn point: stopping distance plus a reaction reserve (≈ 1 s of descent + 15 %). */
export function burnAltitude(s) {
  const d = stoppingDistance(s);
  return isFinite(d) ? d * 1.15 + Math.max(0, -s.vy) * 0.8 + 2 : d;
}

/** Seconds of free fall (with drag) until the burn point is reached. */
export function timeToBurn(s) {
  const { m } = massProps(s);
  const rho = density(s);
  const chuteK = s.chute === 'open' && s.planet.rho > 0 ? s.chuteInflate : 0;
  let v = -s.vy, alt = altitude(s), t = 0;
  const h = 0.1;
  const probe = { ...s };
  for (let i = 0; i < 600; i++) {
    probe.vy = -v; probe.y = s.y - (altitude(s) - alt);
    if (alt <= burnAltitude(probe)) return t;
    const q = 0.5 * rho * v * v;
    const drag = q * BODY_CDA + Math.min(q * CHUTE_CDA * chuteK, chuteK > 0 ? CHUTE_FMAX : 0);
    v += (s.planet.g - drag / m) * h;
    alt -= v * h; t += h;
  }
  return t;
}
export const CHUTE_SAFE = 0.95; // deploy hint/button below this share of CHUTE_QMAX

/** Bordcomputer: stopping distance (m) burning at the current throttle limit, including air drag
 *  and the parachute as it is right now. Infinity if the engine cannot stop the descent. */
export function stoppingDistance(s) {
  if (s.vy >= 0) return 0;
  const { m } = massProps(s);
  const maxFrac = s.powered ? 1 : 0.6;
  const aThr = ((F_MAX * Math.min(s.limit, maxFrac)) / m) * upVector(s).y;
  if (aThr <= s.planet.g) return Infinity;
  const rho = density(s);
  const chuteK = s.chute === 'open' && s.planet.rho > 0 ? s.chuteInflate : 0;
  let v = -s.vy, d = 0;
  const h = 0.02;
  for (let i = 0; i < 20000 && v > 0; i++) {
    const q = 0.5 * rho * v * v;
    const drag = q * BODY_CDA + Math.min(q * CHUTE_CDA * chuteK, CHUTE_FMAX * (chuteK > 0 ? 1 : 0));
    v -= (aThr + drag / m - s.planet.g) * h;
    d += Math.max(0, v) * h;
  }
  return d;
}

const FEET = [[-FOOT_X, 0], [FOOT_X, 0], [0, -FOOT_X], [0, FOOT_X]];
/** World position of each foot pad: [x, y, z, groundHeight]. */
export function feet(s) {
  const ca = Math.cos(s.a), sa = Math.sin(s.a), cb = Math.cos(s.b || 0), sb = Math.sin(s.b || 0);
  return FEET.map(([fx, fz]) => {
    const x = s.x + fx * ca, y = s.y + fx * sa * cb - fz * sb, z = (s.z || 0) + fx * sa * sb + fz * cb;
    return [x, y, z, terrainHeight(x, z)];
  });
}
export function altitude(s) {
  let min = Infinity;
  for (const [, y, , h] of feet(s)) min = Math.min(min, y - h);
  return min;
}

/** Below WRECK_V the lander breaks up without fire; above it the tanks rupture and burn
 *  whatever fuel is left. The capsule survives up to CAPSULE_V unless a big fuel fire engulfs it. */
export const WRECK_V = 15;
export const CAPSULE_V = 24;
function classifyCrash(s, sink, drift) {
  const fuelLeft = fuel(s);
  const rupture = sink > WRECK_V || (sink > LAND.vy[2] + 3 && drift > 6);
  const fire = rupture && fuelLeft > 10;
  const crew = sink <= CAPSULE_V && !(fire && fuelLeft > 120 && sink > WRECK_V + 4);
  return { kind: fire ? 'explosion' : 'wreck', crew, fuelBurned: fire ? fuelLeft : 0 };
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

/** Retro 2: surface-retrograde with wind feed-forward. Returns [roll, pitch] targets.
 *  Free fall: thrust axis opposite the velocity over ground. Burning: lean so the thrust's sideways part
 *  kills the ground drift in ~1.25 s and holds against the current air force (wind). Capped at 20°. */
export const RETRO2_MAX = 0.35; // rad
export const VCMD = 8; // m/s over ground at full pad deflection (Retro 2)
function retro2Targets(s, F, m, dt, moveX = 0, moveZ = 0) {
  const steering = Math.hypot(moveX, moveZ) > 0.01;
  if (F > 0) s.r2BurnT = s.t;
  const burning = s.t - (s.r2BurnT ?? -99) < 1.5; // stay in burn mode through short throttle gaps
  let hx = 0, hz = 0; // wanted horizontal component of the thrust axis
  if (s.chute === 'open' && s.planet.rho > 0) {
    // under the canopy: hang straight, the chute does the work
  } else if (burning || (steering && F > 0)) {
    const Fe = Math.max(F, F_MAX * Math.max(s.limit, 0.3));
    // lead the drift by the attitude lag (~0.4 s) so the lean is gone when the drift is
    const ax = (s.vx - (s.r2vx ?? s.vx)) / Math.max(dt, 1e-3), az = (s.vz - (s.r2vz ?? s.vz)) / Math.max(dt, 1e-3);
    const px = s.vx + ax * 0.4, pz = s.vz + az * 0.4;
    // fly at the commanded ground velocity (0 when the pad is released = stop the drift)
    // allowed sideways speed shrinks near the ground so a held stick can't drag you in sideways
    const vmax = Math.max(1, Math.min(VCMD, altitude(s) * 0.2));
    hx = (-(px - moveX * vmax) * 0.6 * m - (s.dragX || 0)) / Fe;
    hz = (-(pz - moveZ * vmax) * 0.6 * m - (s.dragZ || 0)) / Fe;
  } else if (steering) {
    // free fall: lean the way the pilot wants to go, ready for the burn
    hx = moveX * 0.25; hz = moveZ * 0.25;
  } else {
    const v = Math.hypot(s.vx, s.vy, s.vz) || 1;
    hx = -s.vx / v; hz = -s.vz / v;
  }
  const h = Math.hypot(hx, hz), cap = Math.sin(RETRO2_MAX);
  if (h > cap) { hx *= cap / h; hz *= cap / h; }
  // smooth the target so mode switches don't kick the attitude (u.x = -sin a, u.z ≈ sin b)
  s.r2vx = s.vx; s.r2vz = s.vz;
  const k = Math.min(1, dt * (burning ? 8 : 2.5));
  s.r2a = (s.r2a ?? s.a) + (-Math.asin(hx) - (s.r2a ?? s.a)) * k;
  s.r2b = (s.r2b ?? s.b) + (Math.asin(hz) - (s.r2b ?? s.b)) * k;
  return [s.r2a, s.r2b];
}

/** Attitude control for one tilt axis. cmd = pilot input (-1..1, + turns the angle up), target = angle for
 *  'retro'/'up'. Stores the jet torque in s._tau{A|B} and returns how hard the jets work (0..1). */
function controlAxis(s, ang, rate, holdKey, integKey, cmd, target, comTorque, I, dt) {
  const tauKey = ang === 'a' ? '_tauA' : '_tauB';
  const clamp = (t) => Math.max(-RCS_TORQUE, Math.min(RCS_TORQUE, t));
  s[tauKey] = 0;
  if (s.blackout) return 0;
  const A = s[ang], W = s[rate];
  if (cmd && s.sas === 'hold' && s.computerOK) {
    // rate command (Apollo LM style): the pad sets a turn rate, the computer fires the jets to match it
    s[tauKey] = clamp((cmd * MAX_RATE - W) * 6 * I - comTorque);
    s[holdKey] = null; s[integKey] = 0;
  } else if (cmd) {
    s[tauKey] = cmd * RCS_TORQUE; // jets fire directly
    s[holdKey] = null; s[integKey] = 0;
    return Math.abs(cmd);
  } else if (s.sas === 'hold' && s.computerOK) {
    // attitude hold: first stop the rotation, then keep that angle (integral cancels steady wind torque)
    if (s[holdKey] === null && Math.abs(W) < 0.02) { s[holdKey] = A; s[integKey] = 0; }
    if (s[holdKey] !== null && Math.abs(A - s[holdKey]) < 0.1) s[integKey] = Math.max(-0.5, Math.min(0.5, s[integKey] + (A - s[holdKey]) * dt));
    s[tauKey] = clamp((s[holdKey] === null ? -3.0 * W : -(2.2 * (A - s[holdKey]) + 2.6 * W + 1.2 * s[integKey])) * I - comTorque);
  } else if (s.sas && s.computerOK) {
    // 'up' holds vertical, 'retro' leans against the drift; integrate only near the target (no windup)
    if (Math.abs(A - target) < 0.1) s[integKey] = Math.max(-0.5, Math.min(0.5, s[integKey] + (A - target) * dt));
    s[tauKey] = clamp(-(2.2 * (A - target) + 2.6 * W + 1.2 * s[integKey]) * I - comTorque);
  }
  return Math.abs(s[tauKey]) / RCS_TORQUE;
}

/** input: { thrust: bool, rcs: -1..1 (roll, + tips the top to -x), rcsZ: -1..1 (pitch, + tips the top to +z) } */
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

  const { m, cx, cz, I } = massProps(s);
  const F = thr * F_MAX;
  const u = upVector(s);

  // --- attitude: the same controller on both tilt axes ---
  s.torqueCom = -cx * F; // thrust through the engine axis, CoM off-axis -> torque
  s.torqueComB = cz * F;
  const aThr = F / m;
  // retro leans so the thrust's sideways part kills the drift in about a second
  const lean = (v) => Math.max(-0.17, Math.min(0.17, Math.asin(Math.max(-1, Math.min(1, (v * 0.8) / Math.max(aThr, 1))))));
  let tA = s.sas === 'retro' && thr > 0 ? lean(s.vx) : 0;
  let tB = s.sas === 'retro' && thr > 0 ? -lean(s.vz) : 0;
  let cmdA = input.rcs || 0, cmdB = input.rcsZ || 0;
  // under an open canopy the pad steers the parachute (pulls the risers) instead of tilting the lander
  const chuteSteer = s.chute === 'open' && s.planet.rho > 0 && s.chuteInflate > 0.5;
  s.steerX = chuteSteer ? -cmdA : 0; s.steerZ = chuteSteer ? cmdB : 0;
  if (chuteSteer) { cmdA = cmdB = 0; }
  if (s.sas === 'retro2') {
    // velocity command: the pad says where to fly (world direction), the computer tilts to get there
    [tA, tB] = retro2Targets(s, F, m, dt, -cmdA, cmdB);
    cmdA = cmdB = 0;
  }
  const ra = controlAxis(s, 'a', 'w', 'holdA', 'sasI', cmdA, tA, s.torqueCom, I, dt);
  const rb = controlAxis(s, 'b', 'wb', 'holdB', 'sasIB', cmdB, tB, s.torqueComB, I, dt);
  const rcsUse = Math.max(ra, rb);
  s.w += ((s.torqueCom + s._tauA) / I) * dt;
  s.wb += ((s.torqueComB + s._tauB) / I) * dt;
  s.a += s.w * dt;
  s.b += s.wb * dt;

  // --- aerodynamics: body drag + parachute, against the airflow relative to the lander ---
  const wind = windAt(s);
  s.windNow = wind.speed; s.windX = wind.x; s.windZ = wind.z;
  const rx = s.vx - wind.x, rz = s.vz - wind.z;
  const v = Math.hypot(rx, s.vy, rz);
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
  const Fd = s.q * (BODY_CDA + chuteCda);
  s.drag = Fd;
  const k = v > 0.01 ? -Fd / v : 0;
  const dx = k * rx, dy = k * s.vy, dz = k * rz;
  s.dragX = dx; s.dragZ = dz; // horizontal air force, used by Retro 2 as feed-forward
  // side force acts above the CoM and tips the lander downwind (body drag only, the canopy hangs free)
  const ks = v > 0.01 ? (-s.q * BODY_CDA) / v : 0;
  const arm = WIND_ARM + (WIND_ARM_PANELS - WIND_ARM) * (1 - s.panelFold) * ((s.lost.solarL && s.lost.solarR) ? 0 : 1);
  s.windTorque = -arm * ks * rx;
  s.windTorqueB = arm * ks * rz;
  s.w += (s.windTorque / I) * dt;
  s.wb += (s.windTorqueB / I) * dt;
  if (s.chute === 'open' && s.planet.rho > 0 && s.chuteInflate > 0.05) {
    // canopy hangs above the CoM and pulls the lander upright
    const pull = s.q * CHUTE_CDA * Math.min(s.chuteInflate, CHUTE_FMAX / Math.max(s.q, 1) / CHUTE_CDA) * CHUTE_ARM;
    s.w += ((-Math.sin(s.a) * pull - s.w * pull * 0.6) / I) * dt;
    s.wb += ((-Math.sin(s.b) * pull - s.wb * pull * 0.6) / I) * dt;
  }

  // --- translation ---
  s.vx += ((F * u.x + dx) / m) * dt;
  s.vy += ((F * u.y + dy) / m - p.g) * dt;
  s.vz += ((F * u.z + dz) / m) * dt;
  if (s.steerX || s.steerZ) {
    // steerable canopy: glide up to CHUTE_GLIDE m/s through the air in the commanded direction
    const sl = Math.hypot(s.steerX, s.steerZ), ex = s.steerX / sl, ez = s.steerZ / sl;
    const along = (s.vx - wind.x) * ex + (s.vz - wind.z) * ez;
    const want = CHUTE_GLIDE * Math.min(1, sl);
    if (along < want) { const acc = Math.min(1.5, (want - along) * 1.2); s.vx += ex * acc * dt; s.vz += ez * acc * dt; }
  }
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.z += s.vz * dt;

  // --- crew g-load ---
  // felt load = all non-gravitational acceleration (engine + air)
  s.gNow = Math.hypot(F * u.x + dx, F * u.y + dy, F * u.z + dz) / m / G0;
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
  const use = 0.55 + (s.sas ? 0.25 : 0) + 2.2 * rcsUse + 1.2 * thr;
  s.panelFold = Math.max(0, Math.min(1, s.panelFold + (s.panels === 'in' ? dt : -dt) / 1.2));
  const panels = (s.lost.solarL ? 0 : 1) + (s.lost.solarR ? 0 : 1);
  const gain = 1.6 * p.solar * (panels / 2) * (1 - s.panelFold);
  s.battery = Math.max(0, Math.min(BAT_CAP, s.battery + (gain - use) * dt));

  // --- aerodynamic heating: hot parts glow, overheated parts blow off ---
  const flux = Math.sqrt(density(s)) * (v / 100) ** 3 * HEAT_K;
  s.heatFlux = flux;
  const sa = Math.sin(s.a), sb = Math.sin(s.b); // tilt exposes one side more
  for (const c of COMPONENTS) {
    if (s.lost[c.id] || !c.heat) continue;
    let exp = Math.max(0, c.heat[0] * (1 + Math.sign(c.pos[0]) * sa * 2.5 - Math.sign(c.pos[2]) * sb * 2.5));
    if (c.model === 'solar') exp *= 1 - 0.88 * s.panelFold; // folded panels sit in the lee of the frame
    // heat[2] = heat capacity: big, thin parts like the solar wings warm up over a few seconds
    s.temp[c.id] += ((flux * exp - HEAT_COOL * (s.temp[c.id] - T_AMB)) / (c.heat[2] ?? 1)) * dt;
    if (s.temp[c.id] > c.heat[1]) destroy(s, c.id);
  }

  // --- touchdown ---
  const alt = altitude(s);
  if (alt <= 0) {
    const tilt = tiltDeg(s);
    const hs = feet(s).map((f) => f[3]);
    const sink = -s.vy, drift = Math.hypot(s.vx, s.vz);
    const g = { vy: grade(sink, LAND.vy), vx: grade(drift, LAND.vx), tilt: grade(tilt, LAND.tilt) };
    const why = [];
    if (g.vy === 3) why.push(`zu schnell (${sink.toFixed(1)} m/s, max ${LAND.vy[2]})`);
    if (g.vx === 3) why.push(`seitliche Drift (${drift.toFixed(1)} m/s, max ${LAND.vx[2]})`);
    if (g.tilt === 3) why.push(`zu schräg (${tilt.toFixed(0)}°, max ${LAND.tilt[2]}°)`);
    if (Math.max(...hs) - Math.min(...hs) > 0.8) why.push('Gelände zu uneben');
    if (s.lost.legs) why.push('Landebeine verglüht');
    const overall = why.length ? 3 : Math.max(g.vy, g.vx, g.tilt);
    // crash energy 0..1: how violent the impact was (drives debris and explosion size)
    const energy = Math.min(1, Math.max(0, (sink - LAND.vy[2]) / 18 + (drift - LAND.vx[2]) / 25 + 0.1));
    s.touch = { vy: sink, vx: drift, tilt, grades: g, grade: overall, energy };
    if (overall === 3) s.touch.crash = classifyCrash(s, sink, drift);
    s.status = overall === 3 ? 'crashed' : 'landed';
    s.reason = why.join(', ');
    s.y -= alt; // snap to ground
  }
}
