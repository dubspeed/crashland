import { moonRelief } from './moon.js';
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
// orbit levels: the sun's direction in the planet's frame (pad at +y, track along +x): the pad in morning light
// (~53° high), the approach lit, the far side of the orbit in the night
export const SUN = (() => { const v = [-0.45, 0.75, 0.35], l = Math.hypot(...v); return v.map((c) => c / l); })();
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

// orbit level (experimental): a small moon, start on a circular orbit, deorbit and land on the target
export const ORBIT = { R: 10000, alt: 1500, downrange: 6000, edge: 1250 };
export const ORBIT_PLANETS = [
  { id: 'luna-orbit', name: 'Luna Orbit', orbit: true, R: ORBIT.R, edge: ORBIT.edge, g: 1.62, alt: ORBIT.alt, downrange: ORBIT.downrange, vy: 0, vx: 0, tilt: 0, solar: 1.0, fuel: 430,
    rho: 0, H: 1, atmo: 'keine', drift: 0, text: 'Bahngeschwindigkeit abbauen, dann landen.',
    sky: 0x05060c, fog: 0x05060c, ground: 0x9b9a96, ground2: 0x6c6b68, sun: 0xffffff, stars: true },
  // Mars: the thin air is squeezed into a short scale height so it fits the small planet. High up the
  // orbit barely decays; lower down the air brakes (and warms) the lander and the chute helps a bit.
  { id: 'mars-orbit', name: 'Mars Orbit', orbit: true, R: ORBIT.R, edge: ORBIT.edge, g: 3.71, alt: 2500, downrange: 9000, cueLead: 2, vy: 0, vx: 0, tilt: 0, solar: 0.45, fuel: 650, aero: { pe: 4300, top: 4700, land: 5000 },
    rho: 0.02, H: 1100, atmo: 'sehr dünn', drift: 4, text: 'Dünne Luft bremst mit, Schirm hilft etwas.',
    sky: 0xd4a27c, fog: 0xc89670, ground: 0xb4552f, ground2: 0x7d3a22, sun: 0xffe2c4 },
  // Terra and Brontes: thick air squeezed into a thin shell so the orbit sits above it. Only a short
  // deorbit burn is needed (until the cross is on the pad), then the air brakes: heat, then parachute.
  { id: 'terra-orbit', name: 'Terra Orbit', orbit: true, R: ORBIT.R, edge: ORBIT.edge, g: 9.81, alt: 8000, downrange: 20000, deorbitAt: 13000, vy: 0, vx: 0, tilt: 0, solar: 0.75, fuel: 330, aero: { pe: 7000, top: 7600, land: 10400 },
    rho: 1.225, H: 1000, heatK: 0.6, atmo: 'normal', drift: 17, text: 'Wiedereintritt: Hitze, dann Schirm.',
    sky: 0x8ec5ff, fog: 0xa9d2ff, ground: 0x5f9a4c, ground2: 0x7a6145, sun: 0xffffff },
  { id: 'brontes-orbit', name: 'Brontes Orbit', orbit: true, R: ORBIT.R, edge: ORBIT.edge, g: 15.2, alt: 9000, downrange: 26000, deorbitAt: 18500, limit0: 0.75, vy: 0, vx: 0, tilt: 0, solar: 0.3, fuel: 420, aero: { pe: 8200, top: 8800, land: 11700 },
    rho: 2.8, H: 1000, heatK: 0.6, atmo: 'dicht', drift: 20, text: 'Glühender Eintritt, Schirm erst spät.',
    sky: 0x3b2f5c, fog: 0x463868, ground: 0x2f6e6a, ground2: 0x1f4442, sun: 0xd8c8ff },
];
export const ORBIT_PLANET = ORBIT_PLANETS[0];
/** radius of the sphere a planet is drawn on (orbit levels: their R; normal levels: the shared moon size,
 *  rendering only - their flight model stays flat) and the layout of its surface features */
export function surfaceR(p) { return p.R || (p.surface ? ORBIT.R : 0); }
export function surfaceId(p) { return p.surface ?? p.id; }
export function surfaceEdge(p) { return p.edge ?? ORBIT.edge; }

/** Keplerian orbit from the current state (vacuum, point mass; planar: arc x and height y). Angles are
 *  measured on the planet from the pad (theta = x / R), positive in the direction of +x.
 *  Returns heights above the mean surface for apoapsis/periapsis, times to them, period, and the
 *  geometry for drawing the ellipse (p, e, omega = theta of periapsis, dir = +1/-1 sense of motion). */
export function orbitInfo(s) {
  const p = s.planet;
  if (!p.R) return null;
  const R = p.R, mu = p.g * R * R, r = R + s.y;
  const vt = Math.sign(s.vx || 1) * Math.hypot(s.vx, s.vz || 0), vr = s.vy, v2 = vt * vt + vr * vr; // (an inclined orbit: the whole horizontal speed)
  const h = r * vt, H = Math.abs(h) || 1e-9;
  const energy = v2 / 2 - mu / r;
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * H * H) / (mu * mu)));
  const pp = (H * H) / mu;
  const nu = Math.atan2((H * vr) / mu, pp / r - 1); // true anomaly now
  const dir = h >= 0 ? 1 : -1, theta = s.x / R;
  const out = { R, mu, e, p: pp, nu, dir, theta, omega: theta - dir * nu, speed: Math.sqrt(v2), escape: e >= 1 };
  out.pe = pp / (1 + e) - R;
  if (e < 1) {
    const a = pp / (1 - e * e), n = Math.sqrt(mu / (a * a * a));
    out.a = a; out.ap = a * (1 + e) - R; out.period = (2 * Math.PI) / n;
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    const M = E - e * Math.sin(E), TAU = 2 * Math.PI;
    out.tPe = (((TAU - M) % TAU) + TAU) % TAU / n;
    out.tAp = (((Math.PI - M) % TAU) + TAU) % TAU / n;
  } else { out.ap = Infinity; out.period = Infinity; }
  return out;
}

/** small seeded random generator (mulberry32): a round is fully determined by its seed and the inputs */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** set up the terrain the flight model uses for a planet (the renderer draws the same) */
export function setupTerrain(p) {
  const sr = surfaceR(p);
  setTerrainEdge(sr ? surfaceEdge(p) : null, sr, surfaceId(p));
}
/** a new round: everything random comes from the seed */
// difficulty settings (start menu); defaults: normal fuel, hints on, no automatic fine control
export const FUEL_LEVELS = [
  { id: 'low', name: 'Knapp', k: 0.75, bonus: 1.25 },
  { id: 'normal', name: 'Normal', k: 1, bonus: 1 },
  { id: 'high', name: 'Reichlich', k: 1.25, bonus: 0.85 },
];
export const HINTS_OFF_BONUS = 1.15; // score multiplier without hints
export const AUTO_FINE_BONUS = 0.9;  // score multiplier with the automatic deorbit fine control
export const DEFAULT_SETTINGS = { fuel: 1, hints: true, autoFine: false };

export function newRound(planet, wind = 0, seed = 1, settings = {}, build = {}) {
  const rnd = seededRandom(seed);
  setupTerrain(planet);
  const set = { ...DEFAULT_SETTINGS, ...settings };
  // rescue missions: another orbit (height, distance to the pad, speed factor), part of the settings for replays
  if (set.orbit && planet.orbit) planet = { ...planet, ...set.orbit };
  setSite(set.site ?? 'plain'); // landing site (part of the settings, so replays get it)
  const s = createState(planet, { wind, rnd, windHeading: rnd() * Math.PI * 2, fuelK: (FUEL_LEVELS[set.fuel]?.k ?? 1) * (set.base?.fuel ?? 1) * (set.fuelMult ?? 1), build });
  s.settings = set;
  if (set.target && planet.orbit) s.target = makeTarget(s, set.target);
  // base flights: the modules already there (obstacles) and what they give
  if (set.base) { s.obstacles = set.base.obstacles ?? []; s.spec.solarK *= set.base.solar ?? 1; }
  return s;
}
export const STEP = 1 / 120;
export const SAS_DELAY = 1.5;
export const SIDE_DONE = 0.1; // m/s: the orbit plane runs over the base (Seite is done)
export const UNEVEN_TIP = 2.5; // ground height difference under the feet (in units of the legs' range) that tips the lander over
/** how uneven the ground is under the feet if the lander stood upright at (x, z): height spread of the four feet */
export function groundSpread(s, x, z) {
  const f = s.spec?.footX ?? FOOT_X, h = [[f, 0], [-f, 0], [0, f], [0, -f]].map(([dx, dz]) => terrainHeight(x + dx, z + dz));
  return Math.max(...h) - Math.min(...h);
} // s the attitude switch has to rest before the chosen mode takes over
/** player / autopilot actions between steps (recorded for replays) */
export function act(s, name) {
  if (name === 'chute') return toggleChute(s);
  if (name === 'panels') return togglePanels(s);
  if (name === 'shield') return jettison(s, 'shield');
  if (name === 'sas') {
    // the next mode only takes over once the switch rests for SAS_DELAY (cycling past "Senkrecht" to get to
    // "Aus" must not flip the lander); before the flight really starts it switches at once
    const from = s.sasPending !== undefined ? s.sasPending : s.sas;
    // Halten → Bremsen (retro) → Landen (retro2) → Aus → Halten ('up', vertical, is no longer offered)
    // orbit levels: Bremsen → Seite (swing the orbit plane over the base) → Landen
    const tgt = s.target?.dock && !s.target.docked; // a module to fetch: Bremsen → Ziel → Seite
    const next = (s.planet.orbit ? { hold: 'retro', retro: tgt ? 'target' : 'side', target: 'side', side: 'retro2', retro2: false, up: false } : { hold: 'retro', retro: 'retro2', retro2: false, up: false })[from] ?? 'hold';
    if (s.t < 0.5) { s.sas = next; s.sasPending = undefined; s.holdA = s.a; s.holdB = s.b; }
    else { s.sasPending = next; s.sasAt = s.t + SAS_DELAY; }
  }
}
/** one fixed simulation step, including the touchdown prediction the flight computer uses (refreshed every
 *  0.1 s of sim time, independent of the frame rate, so a round replays exactly) */
export function advance(s, input) {
  s.stepN = s.stepN ?? 0;
  if (s.sasPending !== undefined && s.t >= s.sasAt) { s.sas = s.sasPending; s.sasPending = undefined; s.holdA = s.a; s.holdB = s.b; }
  // during the deorbit fine control the cross moves hundreds of metres per m/s: refresh it 4x as often
  const fine = s.planet.deorbitAt && s.throttle > 0 && s.pred && Math.hypot(s.pred.x, s.pred.z) < 3000 && s.y > 4000;
  if (s.status === 'flying' && s.stepN % (fine ? 3 : 12) === 0) s.pred = predictImpact(s);
  step(s, input, STEP);
  s.stepN++;
}

/** orbit levels: how far the pad lies ahead along the track (0 .. one circumference: a pad just passed is a
 *  whole lap away); other levels: the plain distance along the flight direction */
export function padAhead(s) {
  const vh = Math.hypot(s.vx, s.vz) || 1, along = -(s.x * s.vx + s.z * s.vz) / vh;
  if (!s.planet.orbit || !s.planet.R) return along;
  const C = 2 * Math.PI * s.planet.R;
  return ((along % C) + C) % C;
}
/** aerobraking (planets with air, planet.aero): 'high' = the orbit is too high to land from, its low point
 *  stays above the air; 'braking' = the low point dips into the air, each pass takes speed off; null = low
 *  enough to land from (or no air). pe: the low point that brakes in a few passes, land: the high point to
 *  land from, top: where the air starts to brake noticeably. */
export function aeroState(s) {
  const A = s.planet.aero;
  if (!A || !s.planet.orbit || s.status !== 'flying') return null;
  const o = orbitInfo(s);
  if (!o || o.escape || o.ap <= A.land) return null;
  return { phase: o.pe <= A.top ? 'braking' : 'high', ap: o.ap, pe: o.pe, target: A.pe, land: A.land, top: A.top };
}
/** circular orbit speed at height y above the surface */
export function orbitSpeed(p, y) { const r = p.R + y; return Math.sqrt((p.g * p.R * p.R) / r); }
/** curvature terms for the flat sim frame (x, z = arc length on the surface, y = height): gravity falls off
 *  with height, horizontal speed gives centrifugal lift, and the arc rate shrinks with height. */
// The frame is longitude / latitude on the sphere around the pad: x = R·longitude along the pad's "equator"
// (the normal ground track), z = R·latitude, y = height; vx, vz, vy = east, north, up. These are the exact
// equations of motion in that frame (non-rotating planet); on the track (z = 0) the latitude terms vanish.
function curvature(p, y, vx, vy, vz, z = 0) {
  if (!p.orbit || !p.R) return null;
  const r = p.R + y, tb = Math.tan(z / p.R), k = p.R / r;
  return { gy: p.g * (p.R / r) ** 2 - (vx * vx + vz * vz) / r, ax: (-vx * vy + vx * vz * tb) / r, az: (-vz * vy - vx * vx * tb) / r, k, kx: k / Math.cos(z / p.R) };
}
/** an orbit that misses the base (base and rescue missions): the sideways miss that costs about `dv` m/s to
 *  fix at the cheapest point, and a start far enough back that this point (a quarter orbit before the pad)
 *  is still ahead. sign: +1 / -1 (north / south). Returned as an orbit override (settings.orbit). */
export function missOrbit(planet, sign = 1, dv = 18) {
  const v = orbitSpeed(planet, planet.alt), miss = Math.round(((dv / v) * planet.R) / 10) * 10;
  return { miss: sign * miss, downrange: Math.round(Math.max(planet.R * Math.PI * 0.62, (planet.deorbitAt ?? 0) + 6000)) };
}
/** orbit levels: daylight at a point (1 = sun, 0 = in the planet's shadow; a soft edge), from the cylinder of
 *  shadow behind the planet. Default: the lander now. */
export function daylight(s, x = s.x, y = s.y, z = s.z) {
  if (!s.planet.orbit || !s.planet.R) return 1;
  const { r } = inertial(s, x, y, z), d = r[0] * SUN[0] + r[1] * SUN[1] + r[2] * SUN[2];
  if (d >= 0) return 1;
  const perp = Math.hypot(r[0] - d * SUN[0], r[1] - d * SUN[1], r[2] - d * SUN[2]), R = s.planet.R;
  const t = Math.min(1, Math.max(0, (perp - R * 0.985) / (R * 0.03)));
  return t * t * (3 - 2 * t);
}
/** the sun in the lander's local frame (east, up, north) */
export function sunLocal(s) {
  if (!s.planet.orbit || !s.planet.R) return null;
  const { E, U, N } = inertial(s), dot = (a) => a[0] * SUN[0] + a[1] * SUN[1] + a[2] * SUN[2];
  return { x: dot(E), y: dot(U), z: dot(N) };
}
/** orbit levels: night ahead? on the current orbit (circular at this height and angular rate): in = in the
 *  shadow now, change = seconds until that changes, night = how long the next / current night lasts */
export function shadowInfo(s) {
  if (!s.planet.orbit || !s.planet.R || s.status !== 'flying') return null;
  if (s._si && s._si.n === s.stepN) return s._si.v; // asked several times per frame (HUD, time warp)
  const v = shadowCalc(s);
  s._si = { n: s.stepN, v };
  return v;
}
function shadowCalc(s) {
  const { r, v, U } = inertial(s), rl = Math.hypot(...r);
  const vr = v[0] * U[0] + v[1] * U[1] + v[2] * U[2], vh = v.map((c, i) => c - vr * U[i]), vhl = Math.hypot(...vh);
  if (vhl < 20) return null;
  const T = vh.map((c) => c / vhl), om = vhl / rl, R = s.planet.R;
  const lit = (th) => { const p = U.map((c, i) => (c * Math.cos(th) + T[i] * Math.sin(th)) * rl), d = p[0] * SUN[0] + p[1] * SUN[1] + p[2] * SUN[2];
    return d >= 0 || Math.hypot(p[0] - d * SUN[0], p[1] - d * SUN[1], p[2] - d * SUN[2]) > R; };
  const now = lit(0), st = (2 * Math.PI) / 360;
  let i = 1; while (i < 360 && lit(i * st) === now) i++;
  if (i >= 360) return { in: !now, change: Infinity, night: now ? 0 : Infinity };
  let j = i + 1; while (j < i + 360 && lit(j * st) === lit(i * st)) j++;
  return { in: !now, change: (i * st) / om, night: ((now ? j - i : i) * st) / om };
}
// ---------- objects in orbit: a station (you undock from it) or a module to dock and bring down ----------
export const ORBIT_OBJECTS = { station: { name: 'Station', dock: false, size: 14 }, module: { name: 'Versorgungsmodul', dock: true, mass: 400, size: 3 } };
// docking: the lander's port sits on top of the capsule (PORT_Y above the feet, along the nose), the module's
// port faces the lander; they latch when the ports are close, slow and the nose points at the module
export const PORT_Y = 6.4, DOCK_DIST = 1.2, DOCK_SPEED = 0.5, DOCK_ANGLE = 20, NEAR = 120; // m, m/s, °, m (Ziel holds the nose on the module)
/** a free-flying object `ahead` m along the lander's track, `up` m higher, on its own circular orbit */
function makeTarget(s, t) {
  const p = s.planet, hv = Math.hypot(s.vx, s.vz) || 1, ex = s.vx / hv, ez = s.vz / hv, k = p.R / (p.R + s.y);
  const v = orbitSpeed(p, s.y + (t.up ?? 0));
  const o = ORBIT_OBJECTS[t.type];
  return { type: t.type, name: t.name ?? o.name, dock: o.dock, mass: o.mass ?? 0, size: o.size,
    x: s.x + ex * (t.ahead ?? 0) * k, z: s.z + ez * (t.ahead ?? 0) * k, y: s.y + (t.up ?? 0), vx: ex * v, vy: 0, vz: ez * v };
}
/** the object coasts (no air: it stays above it) with the same equations as the lander */
function coast(p, o, dt) {
  const cv = curvature(p, o.y, o.vx, o.vy, o.vz, o.z);
  o.vx += cv.ax * dt; o.vy -= cv.gy * dt; o.vz += cv.az * dt;
  o.x += o.vx * cv.kx * dt; o.y += o.vy * dt; o.z += o.vz * cv.k * dt;
  if (Math.abs(o.x) > Math.PI * p.R) o.x -= Math.sign(o.x) * 2 * Math.PI * p.R;
}
/** the target seen from the lander (local east / up / north): rel = where it is, d = distance, vrel = how fast
 *  the lander moves relative to it, closing = speed toward it, dv = the speed change that brings the lander
 *  to it (approach speed falls with the distance), dvMag */
export function targetRel(s) {
  const o = s.target;
  if (!o || o.docked || !s.planet.orbit) return null;
  const L = inertial(s), T = inertial(s, o.x, o.y, o.z, o.vx, o.vy, o.vz);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const dr = T.r.map((c, i) => c - L.r[i]), d = Math.hypot(...dr);
  // relative speed in the frame that turns with the orbit (two objects on one orbit are at rest there)
  const rl2 = dot(L.r, L.r), om = [(L.r[1] * L.v[2] - L.r[2] * L.v[1]) / rl2, (L.r[2] * L.v[0] - L.r[0] * L.v[2]) / rl2, (L.r[0] * L.v[1] - L.r[1] * L.v[0]) / rl2];
  const wx = [om[1] * dr[2] - om[2] * dr[1], om[2] * dr[0] - om[0] * dr[2], om[0] * dr[1] - om[1] * dr[0]];
  const dvv = L.v.map((c, i) => c - T.v[i] + wx[i]);
  const loc = (a) => ({ x: dot(a, L.E), y: dot(a, L.U), z: dot(a, L.N) });
  const rel = loc(dr), vrel = loc(dvv), u = { x: rel.x / d, y: rel.y / d, z: rel.z / d };
  // far: the main-engine approach (the speed falls with the distance, to ~2 m/s at NEAR); near: RCS
  const sp = Math.min(6, 0.3 + d / 60);
  const dv = { x: u.x * sp - vrel.x, y: u.y * sp - vrel.y, z: u.z * sp - vrel.z };
  // ports: ours on the nose, the module's facing us (half its size from its centre)
  const N = upVector(s), pr = { x: rel.x - N.x * PORT_Y, y: rel.y - N.y * PORT_Y, z: rel.z - N.z * PORT_Y };
  const pl = Math.hypot(pr.x, pr.y, pr.z) || 1, half = (o.size ?? 3) / 2;
  const port = { x: pr.x - (pr.x / pl) * half, y: pr.y - (pr.y / pl) * half, z: pr.z - (pr.z / pl) * half }; // our port -> theirs
  const along = port.x * N.x + port.y * N.y + port.z * N.z;
  const off = { x: port.x - N.x * along, y: port.y - N.y * along, z: port.z - N.z * along }; // sideways offset from our nose axis
  const aim = Math.acos(Math.max(-1, Math.min(1, (pr.x * N.x + pr.y * N.y + pr.z * N.z) / pl))) * 180 / Math.PI;
  return { rel, d, vrel, u, speed: Math.hypot(vrel.x, vrel.y, vrel.z), closing: vrel.x * u.x + vrel.y * u.y + vrel.z * u.z, dv, dvMag: Math.hypot(dv.x, dv.y, dv.z),
    port, portDist: Math.max(0, pl - half), along, off, offDist: Math.hypot(off.x, off.y, off.z), aim, near: d < NEAR };
}
/** attitude angles (a, b) that put the nose along unit vector D, the solution nearest the current attitude
 *  (two solutions, plus full turns: picking the near one keeps the lander from spinning round) */
function attTarget(s, D) {
  const a1 = Math.asin(Math.max(-1, Math.min(1, -D.x))), b1 = Math.atan2(D.z, D.y);
  let best = null, bd = Infinity;
  for (const [a0, b0] of [[a1, b1], [Math.PI - a1, b1 + Math.PI]]) {
    const a = a0 + 2 * Math.PI * Math.round((s.a - a0) / (2 * Math.PI)), b = b0 + 2 * Math.PI * Math.round((s.b - b0) / (2 * Math.PI));
    const dd = Math.abs(a - s.a) + Math.abs(b - s.b);
    if (dd < bd) { bd = dd; best = [a, b]; }
  }
  return best;
}
/** Seite / Ziel: the speed change the computer steers for (local east / up / north), or null */
function maneuver(s) {
  if (s.sas === 'side') { const tm = trackMiss(s); return tm ? { dv: tm.dv, mag: tm.dvMag, done: SIDE_DONE } : null; }
  if (s.sas === 'target') { const tr = targetRel(s); return tr && !tr.near ? { dv: tr.dv, mag: tr.dvMag, done: 0.15 } : null; }
  return null;
}
/** orbit levels: does the orbit pass over the base? miss = distance of the pad from the orbit plane (m, signed:
 *  + = the pad lies north, +z), dv = the sideways speed change (local east / up / north) that turns the plane
 *  through the pad here, ahead = angle along the orbit to the pad, best = seconds to the cheapest point to do it
 *  (a quarter orbit before the pad), dvBest = what it costs there. null if not an orbit level or no real orbit. */
export function trackMiss(s) {
  const p = s.planet;
  if (!p.orbit || !p.R || s.status !== 'flying') return null;
  const { r, v, U, E, N } = inertial(s), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(...a); return l > 1e-9 ? a.map((c) => c / l) : null; };
  const h = unit(cross(r, v)), vr = dot(v, U), vh = v.map((c, i) => c - vr * U[i]), vhl = Math.hypot(...vh);
  if (!h || vhl < 20) return null;
  const P = [0, 1, 0], sinMiss = dot(h, P);
  // pad projected into the orbit plane, and how far ahead along the orbit it lies
  const Pp = unit(P.map((c, i) => c - sinMiss * h[i]));
  let ahead = Pp ? Math.atan2(dot(cross(U, Pp), h), dot(U, Pp)) : 0;
  if (ahead < 0) ahead += 2 * Math.PI;
  // the plane through here and the pad: turn the horizontal velocity into it (same speed)
  let nt = unit(cross(U, P));
  let dv = [0, 0, 0];
  if (nt) {
    if (dot(nt, h) < 0) nt = nt.map((c) => -c);
    const tdir = cross(nt, U); // along the new track, in the sense of motion
    dv = vh.map((c, i) => vhl * tdir[i] - c);
  }
  const om = vhl / (p.R + s.y), miss = Math.asin(Math.max(-1, Math.min(1, sinMiss)));
  // cheapest a quarter orbit before the pad; with a deorbit point further out (thick air), just before that
  const at = Math.max(Math.PI / 2, p.deorbitAt ? (p.deorbitAt + 2500) / p.R : 0);
  let best = (ahead - at) / om;
  if (best < -8) best += (2 * Math.PI) / om;
  const tilt = Math.asin(Math.min(1, Math.abs(sinMiss) / Math.max(1e-6, Math.sin(Math.min(at, Math.PI - 1e-3)))));
  return { miss: -miss * p.R, ahead, best, dvBest: 2 * vhl * Math.sin(tilt / 2),
    dv: { x: dot(dv, E), y: dot(dv, U), z: dot(dv, N) }, dvMag: Math.hypot(...dv) };
}
/** orbit levels: position and velocity in the planet's frame (centre at the origin, pad at +y, track along +x) */
export function inertial(s, x = s.x, y = s.y, z = s.z, vx = s.vx, vy = s.vy, vz = s.vz) {
  const R = s.planet.R, l = x / R, b = z / R, cl = Math.cos(l), sl = Math.sin(l), cb = Math.cos(b), sb = Math.sin(b);
  const U = [cb * sl, cb * cl, sb], E = [cl, -sl, 0], N = [-sb * sl, -sb * cl, cb], r = R + y;
  return { r: U.map((c) => c * r), v: [0, 1, 2].map((i) => vx * E[i] + vz * N[i] + vy * U[i]), U, E, N };
}

/** orbit level: when to start the braking burn so the lander stops (horizontally) about over the pad.
 *  Returns null once the orbital speed is mostly gone. */
export function orbitGuide(s) {
  if (!s.planet.orbit) return null;
  const vh = Math.hypot(s.vx, s.vz);
  if (vh < 15) return null;
  const { m } = massProps(s);
  const acc = (s.spec.fMax * Math.max(s.limit, 0.05)) / m;
  const k = s.planet.R / (s.planet.R + s.y);
  const dist = ((vh * vh) / (2 * acc)) * k;
  const along = padAhead(s); // pad distance ahead along the track
  if (s.planet.deorbitAt) {
    // thick air: a short deorbit burn at a fixed distance, then the cross guides; done once the burn
    // has put the touchdown point on the track (the air does the braking from there)
    if (s.deorbited || (s.pred && Math.hypot(s.pred.x, s.pred.z) < 3000)) { s.deorbited = true; return null; }
    return { vh, dist: 0, brakeIn: (along - s.planet.deorbitAt) / (vh * k), deorbit: true };
  }
  return { vh, dist, brakeIn: (along - dist) / (vh * k) + 1 - (s.planet.cueLead ?? 0) }; // a little early: early is forgiving, late overshoots
}

export const PLANETS = [
  { id: 'luna', surface: 'luna-orbit', name: 'Luna', g: 1.62, alt: 900, vy: -60, vx: 3, tilt: 2, solar: 1.0, fuel: 175, rho: 0, H: 1, atmo: 'keine', drift: 0,
    text: 'Wenig Schwerkraft. Zum Üben.',
    sky: 0x05060c, fog: 0x05060c, ground: 0x9b9a96, ground2: 0x6c6b68, sun: 0xffffff, stars: true },
  { id: 'mars', surface: 'mars-orbit', name: 'Mars', g: 3.71, alt: 1500, vy: -110, vx: -4, tilt: -3, solar: 0.45, fuel: 305, rho: 0.02, H: 11000, atmo: 'sehr dünn', drift: 4,
    text: 'Schwache Sonne, Schirm hilft wenig.',
    sky: 0xd4a27c, fog: 0xc89670, ground: 0xb4552f, ground2: 0x7d3a22, sun: 0xffe2c4 },
  { id: 'terra', surface: 'terra-orbit', name: 'Terra', g: 9.81, alt: 1800, vy: -165, vx: 5, tilt: 4, solar: 0.75, fuel: 200, rho: 1.225, H: 8500, atmo: 'normal', drift: 17,
    text: 'Hitze beim Eintritt, Schirm hilft.',
    sky: 0x8ec5ff, fog: 0xa9d2ff, ground: 0x5f9a4c, ground2: 0x7a6145, sun: 0xffffff },
  { id: 'brontes', surface: 'brontes-orbit', name: 'Brontes', g: 15.2, alt: 1800, vy: -90, vx: -3, tilt: -2, solar: 0.3, fuel: 230, rho: 2.8, H: 7000, atmo: 'dicht', drift: 20,
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

// ---------- lander builder: six slots, each option changes parts, masses and performance ----------
export const BUILD_SLOTS = [
  { id: 'capsule', name: 'Kapsel', short: 'Kapsel', options: [
    { id: 'duo', name: 'Zweisitzer', desc: '2 Crew · −500 kg' },
    { id: 'std', name: 'Standard', desc: '3 Crew' },
    { id: 'armored', name: 'Gepanzert', desc: '3 Crew · hält viel mehr Hitze aus · +350 kg' },
    { id: 'hab', name: 'Habitat', desc: '4 Crew · +700 kg' }] },
  { id: 'engine', name: 'Triebwerk', short: 'Antrieb', options: [
    { id: 'mini', name: 'Mini', desc: '90 kN · Isp 300 s · −250 kg' },
    { id: 'eco', name: 'Effizient', desc: '140 kN · Isp 320 s · −70 kg' },
    { id: 'std', name: 'Standard', desc: '185 kN · Isp 290 s' },
    { id: 'strong', name: 'Stark', desc: '240 kN · Isp 280 s · Generator: Strom beim Brennen · +150 kg' },
    { id: 'cluster', name: 'Bündel', desc: '3 Düsen · 330 kN · Isp 275 s · Generator · +420 kg' }] },
  { id: 'tanks', name: 'Tanks', short: 'Tanks', options: [
    { id: 'mini', name: 'Mini', desc: '45 % Treibstoff · −180 kg' },
    { id: 'small', name: 'Klein', desc: '70 % Treibstoff · −100 kg' },
    { id: 'std', name: 'Standard', desc: '100 % Treibstoff' },
    { id: 'large', name: 'Groß', desc: '135 % Treibstoff · +120 kg' },
    { id: 'huge', name: 'Riesig', desc: '180 % Treibstoff · +260 kg' }] },
  { id: 'solar', name: 'Solarpaneele', short: 'Solar', options: [
    { id: 'none', name: 'Keine', desc: 'nur Batterie · −220 kg' },
    { id: 'small', name: 'Klein', desc: '55 % Leistung · −100 kg' },
    { id: 'std', name: 'Standard', desc: 'laden, aber hitzeempfindlich' },
    { id: 'large', name: 'Groß', desc: '170 % Leistung · glühen schneller · +120 kg' }] },
  { id: 'battery', name: 'Batterie', short: 'Akku', options: [
    { id: 'small', name: 'Klein', desc: '50 % Kapazität · −200 kg' },
    { id: 'std', name: 'Standard', desc: '' },
    { id: 'large', name: 'Groß', desc: '2,2× Kapazität · +250 kg' }] },
  { id: 'chute', name: 'Fallschirm', short: 'Schirm', options: [
    { id: 'none', name: 'Keiner', desc: '−120 kg' },
    { id: 'small', name: 'Klein', desc: '70 m² · 50 kN · −50 kg' },
    { id: 'std', name: 'Standard', desc: '110 m² · 70 kN' },
    { id: 'large', name: 'Groß', desc: '170 m² · 95 kN · +80 kg' }] },
  { id: 'shield', name: 'Hitzeschild', short: 'Schild', options: [
    { id: 'none', name: 'Keiner', desc: '' },
    { id: 'light', name: 'Leicht', desc: 'schützt halb so gut · +120 kg' },
    { id: 'shield', name: 'Standard', desc: 'schützt, wenn das Triebwerk vorn ist · +240 kg' }] },
  { id: 'legs', name: 'Landebeine', short: 'Beine', options: [
    { id: 'light', name: 'Leicht', desc: 'weniger Toleranz · −120 kg' },
    { id: 'std', name: 'Standard', desc: '' },
    { id: 'wide', name: 'Breit', desc: 'mehr Drift & Neigung · +120 kg' },
    { id: 'heavy', name: 'Gefedert', desc: '30 % mehr Sinkrate · +220 kg' }] },
];
export const DEFAULT_BUILD = { capsule: 'std', engine: 'std', tanks: 'std', solar: 'std', battery: 'std', chute: 'std', shield: 'none', legs: 'std' };
export const SHIELD = { id: 'shield', name: 'Hitzeschild', model: 'shield', mass: 240, pos: [0, 0.95, 0], heat: [1.2, 3000, 6] };
// the fourth seat of the habitat capsule
export const CREW_EXTRA = { id: 'juno', name: 'Juno', role: 'Ärztin', limit: 3.0 };

// ---------- base building: cargo instead of crew ----------
// A cargo flight has no capsule: an uncrewed core flies the lander and the payload sits on the frame where the
// capsule was (bottom at 3.65 m). h / r: size (the centre of mass goes up with h, r is its footprint at the
// base), g: the most it takes (longer than 0.3 s and it is damaged), touch: the sink rate it survives.
export const CARGO = {
  beacon: { name: 'Funkbake', mass: 150, h: 2.2, r: 0.9, g: 12, touch: 12, bonus: 'Basis gegründet' },
  solar: { name: 'Solarfarm', mass: 600, h: 1.0, r: 2.2, g: 6, touch: 8, bonus: '+50 % Solarleistung', solar: 1.5 },
  depot: { name: 'Treibstoffdepot', mass: 1400, h: 1.9, r: 1.4, g: 8, touch: 9, bonus: '+15 % Treibstoff', fuel: 1.15 },
  lab: { name: 'Forschungsstation', mass: 900, h: 1.6, r: 1.6, g: 3, touch: 3, bonus: '+20 % Punkte', score: 1.2 },
  rover: { name: 'Rover', mass: 700, h: 1.5, r: 1.5, g: 5, touch: 5, bonus: '+10 % Punkte', score: 1.1 },
  refinery: { name: 'Raffinerie', mass: 1800, h: 2.6, r: 1.6, g: 6, touch: 6, bonus: '+25 % Treibstoff', fuel: 1.25 },
  rocket: { name: 'Rückkehrrakete', mass: 1600, h: 5.5, r: 0.8, g: 5, touch: 5, bonus: 'Crew-Mission frei' },
  crew: { name: 'Crew-Habitat', crew: true, r: 2.6, bonus: 'Basis bemannt' },
  // supply contracts for a finished base (unloaded at the base, they don't stay as modules)
  fuel: { name: 'Treibstoff-Nachschub', mass: 2000, h: 1.8, r: 1.4, g: 9, touch: 9, supply: true },
  parts: { name: 'Ersatzteile', mass: 800, h: 1.3, r: 1.2, g: 6, touch: 6, supply: true },
  science: { name: 'Messgeräte', mass: 600, h: 1.2, r: 1.1, g: 3, touch: 2.5, supply: true },
  crewswap: { name: 'Crew-Wechsel', crew: true, r: 2.6, supply: true },
};
export const MISSIONS = ['beacon', 'solar', 'depot', 'lab', 'rover', 'refinery', 'rocket', 'crew'];
/** where mission k puts its module, in base coordinates (the beacon is the centre; the rest on rings) */
export function baseSlot(k) {
  if (k === 0) return [0, 0];
  const ring = k <= 6 ? 16 : 30, a = ((k - 1) % 6) * (Math.PI / 3) + (k <= 6 ? 0.5 : 0.9);
  return [Math.round(Math.cos(a) * ring * 10) / 10, Math.round(Math.sin(a) * ring * 10) / 10];
}
/** what the intact modules of a base give the following flights there */
export function baseBonus(modules = []) {
  const b = { fuel: 1, solar: 1, score: 1 };
  for (const m of modules) {
    if (m.damaged) continue;
    const c = CARGO[m.type];
    if (c?.fuel) b.fuel *= c.fuel;
    if (c?.solar) b.solar *= c.solar;
    if (c?.score) b.score *= c.score;
  }
  return b;
}
/** builds saved before solar and battery were separate slots ("power") */
export function normalizeBuild(build = {}) {
  const b = { ...build };
  if (b.power) {
    const m = { panels: ['std', 'std'], battery: ['none', 'large'], both: ['std', 'large'] }[b.power] ?? ['std', 'std'];
    b.solar ??= m[0]; b.battery ??= m[1];
    delete b.power;
  }
  const out = { ...DEFAULT_BUILD, ...b };
  for (const sl of BUILD_SLOTS) if (!sl.options.some((o) => o.id === out[sl.id])) out[sl.id] = DEFAULT_BUILD[sl.id];
  return out;
}

// ---------- attachment points ----------
// Parts sit on nodes of the part they are attached to, so a bigger variant moves what hangs on it: tanks sit
// against the frame's side (x = FRAME_SIDE + their radius), the engine hangs from the frame's mount, the heat
// shield wraps the nozzle exit, the chute pack sits on the capsule's docking port, the legs carry the feet.
// Heights in m above the foot plane (= the part positions in COMPONENTS).
export const NODES = { frameSide: 0.6, engineMount: 2.5, capsuleY: 4.5 };
export const PART_VARIANTS = {
  // capsule: top = docking port seat above the capsule origin; crew; heat = [exposure, limit]
  capsule: { duo: { model: 'capsule_duo', top: 0.73, mass: 1000, crew: 2 }, std: { model: 'capsule', top: 0.88, mass: 1500, crew: 3 },
    armored: { model: 'capsule_armored', top: 0.88, mass: 1850, crew: 3, heat: [0.06, 3200] }, hab: { model: 'capsule_hab', top: 1.33, mass: 2200, crew: 4 } },
  // nozzle: exit below the part origin; exitR: exit radius (shield size, flame width); comDy: centre of mass shift
  engine: { mini: { model: 'engine_mini', top: 1.0, nozzle: -0.6, exitR: 0.5, f: 90000, isp: 300, mass: 700 },
    eco: { model: 'engine_eco', top: 1.0, nozzle: -1.15, exitR: 0.66, comDy: -0.12, f: 140000, isp: 320, mass: 880 },
    std: { model: 'engine', top: 1.0, nozzle: -0.8, exitR: 0.78, f: F_MAX, isp: ISP, mass: 950 },
    // gen: gas-generator engines drive an alternator on the turbopump (%/s of the standard battery at full thrust)
    strong: { model: 'engine_strong', top: 1.0, nozzle: -0.7, exitR: 0.98, f: 240000, isp: 280, mass: 1100, gen: 1.8 },
    cluster: { model: 'engine_cluster', top: 1.0, nozzle: -0.75, exitR: 0.95, f: 330000, isp: 275, mass: 1370, gen: 2.6 } },
  tanks: { mini: { model: 'tank_mini', r: 0.45, k: 0.45, mass: 110 }, small: { model: 'tank_small', r: 0.5, k: 0.7, mass: 150 },
    std: { model: 'tank', r: 0.55, k: 1, mass: 200 }, large: { model: 'tank_large', r: 0.66, k: 1.35, mass: 260 }, huge: { model: 'tank_huge', r: 0.75, k: 1.8, mass: 330 } },
  // solar: k = power, heat = exposure of each wing
  solar: { none: null, small: { model: 'solar_small', k: 0.55, mass: 60, heat: 1.3 }, std: { model: 'solar', k: 1, mass: 110, heat: 2.2 },
    large: { model: 'solar_large', k: 1.7, mass: 170, heat: 3.0 } },
  battery: { small: { model: 'battery_small', k: 0.5, mass: 220 }, std: { model: 'battery', k: 1, mass: 420 }, large: { model: 'battery_big', k: 2.2, mass: 670 } },
  chute: { none: { model: 'chutepack', half: 0.17 }, small: { model: 'chutepack_small', half: 0.13, cda: 70, fmax: 50000, mass: 70 },
    std: { model: 'chutepack', half: 0.17, cda: CHUTE_CDA, fmax: CHUTE_FMAX, mass: 120 }, large: { model: 'chutepack_large', half: 0.22, cda: 170, fmax: 95000, mass: 200 } },
  // shield: prot = how much of the standard shield's protection
  shield: { none: null, light: { mass: 120, prot: 0.5, heat: [1.2, 1800, 4], color: 0x8a6a48 }, shield: { mass: 240, prot: 1, heat: [1.2, 3000, 6] } },
  // legs: mass, sink / drift / tilt tolerance factors, uneven ground, foot span
  legs: { light: { model: 'legs_light', foot: 1.8, l: [260, 0.8, 1, 1, 0.65] }, std: { model: 'legs', foot: 2.0, l: [380, 1, 1, 1, 0.8] },
    wide: { model: 'legs_wide', foot: 2.5, l: [500, 1, 1.4, 1.3, 1.1] }, heavy: { model: 'legs_heavy', foot: 2.1, l: [600, 1.3, 1.1, 1.1, 0.9] } },
};
const r3 = (v) => Math.round(v * 1000) / 1000;
/** where every part of a build goes (positions, centre-of-mass overrides, models) and the render nodes */
export function layout(build = {}) {
  const b = normalizeBuild(build);
  const V = (slot) => PART_VARIANTS[slot][b[slot]];
  const cap = V('capsule'), eng = V('engine'), tank = V('tanks'), sol = V('solar') ?? PART_VARIANTS.solar.std, bat = V('battery'), ch = V('chute'), lg = V('legs');
  const engY = r3(NODES.engineMount - eng.top), nozzleY = r3(engY + eng.nozzle);
  const cargo = b.payload ? CARGO[b.payload] : null;
  const capTop = cargo ? r3(3.65 + cargo.h + 0.05) : r3(NODES.capsuleY + cap.top);
  const tx = r3(NODES.frameSide + tank.r), chY = r3(capTop + ch.half);
  return {
    pos: { payload: cargo ? [0, r3(3.65 + cargo.h / 2), 0] : [0, 0, 0], engine: [0, engY, 0], tankL: [-tx, 2.9, 0], tankR: [tx, 2.9, 0], chute: [0, chY, 0], shield: [0, r3(nozzleY + 0.25), 0] },
    com: eng.comDy ? { engine: [0, r3(engY + eng.comDy)] } : {},
    models: { capsule: cap.model, engine: eng.model, tankL: tank.model, tankR: tank.model, solarL: sol.model, solarR: sol.model, battery: bat.model, chute: ch.model, legs: lg.model },
    nodes: { flameY: r3(nozzleY + 0.02), flameK: eng.exitR / 0.78, shieldR: eng.exitR, shieldColor: PART_VARIANTS.shield[b.shield]?.color, chuteTop: r3(chY + ch.half), footX: lg.foot },
  };
}

/** the lander as built: parts (masses, which exist) and performance figures. The default build gives
 *  exactly the original constants, so its flights are unchanged. */
export function makeSpec(build = {}) {
  const b = normalizeBuild(build);
  const V = (slot) => PART_VARIANTS[slot][b[slot]];
  const cap = V('capsule'), eng = V('engine'), tank = V('tanks'), sol = V('solar'), bat = V('battery'), ch = V('chute'), sh = V('shield'), legs = V('legs').l;
  const cargo = b.payload ? CARGO[b.payload] : null;
  const comps = [];
  for (const c0 of COMPONENTS) {
    if ((c0.id === 'solarL' || c0.id === 'solarR') && !sol) continue;
    if (c0.id === 'chute' && b.chute === 'none') continue;
    if (c0.id === 'capsule' && cargo) continue; // cargo flight: no capsule, no crew
    const c = { ...c0 };
    if (c.id === 'capsule') { c.mass = cap.mass; if (cap.heat) c.heat = [...cap.heat]; }
    if (c.id === 'engine') c.mass = eng.mass;
    if (c.id === 'tankL' || c.id === 'tankR') c.mass = tank.mass;
    if (c.id === 'solarL' || c.id === 'solarR') { c.mass = sol.mass; if (sol.heat !== c.heat[0]) c.heat = [sol.heat, c.heat[1], c.heat[2]]; }
    if (c.id === 'battery') c.mass = bat.mass;
    if (c.id === 'chute') c.mass = ch.mass;
    if (c.id === 'legs') c.mass = legs[0];
    comps.push(c);
  }
  if (sh) comps.push({ ...SHIELD, mass: sh.mass, heat: [...sh.heat], prot: sh.prot });
  if (cargo) comps.push({ id: 'payload', name: cargo.name, model: 'payload', mass: cargo.mass, pos: [0, 0, 0], heat: [0.1, 2000] }); // in a fairing, like the capsule
  const lay = layout(b);
  for (const c of comps) {
    if (lay.pos[c.id]) c.pos = lay.pos[c.id];
    if (lay.com[c.id]) c.com = lay.com[c.id];
    c.model = lay.models[c.id] ?? c.model;
  }
  const crew = cargo ? [] : [...CREW, CREW_EXTRA].slice(0, cap.crew).map((c) => c.id);
  return {
    build: b, comps, ids: new Set(comps.map((c) => c.id)), crew, payload: cargo ? { id: b.payload, g: cargo.g, touch: cargo.touch } : null,
    fMax: eng.f, isp: eng.isp, engineGen: eng.gen ?? 0, tankK: tank.k, batK: bat.k, solarK: sol?.k ?? 0,
    chuteCda: ch.cda ?? CHUTE_CDA, chuteFmax: ch.fmax ?? CHUTE_FMAX,
    land: { vy: LAND.vy.map((v) => v * legs[1]), vx: LAND.vx.map((v) => v * legs[2]), tilt: LAND.tilt.map((v) => v * legs[3]) },
    uneven: legs[4], footX: lay.nodes.footX, nodes: lay.nodes,
  };
}

/** what a build can't do (or only barely), per planet and overall, for the builder's warnings.
 *  Built lander, full tanks: twr < 1 means it cannot stop a fall at all there. */
export function buildWarnings(build, planets, fuelK = 1, ref = DEFAULT_BUILD) {
  const spec = makeSpec(build), out = [], per = {};
  const dv = (b, p) => {
    const s = createState(p, { build: b, fuelK, rnd: () => 0.5, windHeading: 0 }), sp = s.spec, m0 = massProps(s).m;
    // load per canopy area (decides the speed under the chute, and so the final burn in thick air)
    return { dv: sp.isp * G0 * Math.log(m0 / (m0 - s.fuel0)), twr: sp.fMax / (m0 * p.g), load: sp.ids.has('chute') ? (m0 - s.fuel0 * 0.5) / sp.chuteCda : Infinity };
  };
  const weak = [], short = [], heavy = [];
  for (const p of planets) {
    const now = dv(build, p), std = dv(ref, p); // ref: what "standard" means (with a cargo: the standard lander carrying it)
    const lowDv = now.dv < std.dv * 0.93, noChute = !spec.ids.has('chute') && p.rho > 0.5, noSun = !spec.solarK && p.orbit;
    const chuteLoad = p.rho > 0.5 && spec.ids.has('chute') && now.load > std.load * 1.048;
    per[p.id] = now.twr < 1 ? 'bad' : now.twr < 1.3 || lowDv || noChute || noSun || chuteLoad ? 'warn' : '';
    if (now.twr < 1) weak.push(p.name); else if (lowDv) short.push(p.name);
    if (chuteLoad) heavy.push(p.name);
  }
  const names = (l) => [...new Set(l.map((n) => n.replace(' Orbit', '')))].join(', ');
  if (weak.length) out.push({ level: 'bad', text: `Triebwerk zu schwach für ${names(weak)}` });
  if (short.length) out.push({ level: 'warn', text: `Weniger Δv als der Standard-Lander: ${names(short)} wird knapp` });
  if (heavy.length) out.push({ level: 'warn', text: `Schwer für den Schirm: auf ${names(heavy)} schneller unten, mehr Bremsen nötig` });
  const use = 0.3 + 0.15; // base load with attitude hold, %/s of the standard battery
  const mins = (BAT_CAP * spec.batK) / use / 60;
  if (!spec.solarK) out.push({ level: mins < 3 ? 'bad' : 'warn', text: `Kein Solar: Batterie reicht ~${String(Math.round(mins * 10) / 10).replace('.', ',')} min` });
  else if (spec.batK < 1 && spec.solarK < 1) out.push({ level: 'warn', text: 'Wenig Strom: kleine Batterie und kleine Paneele' });
  if (!spec.ids.has('chute')) out.push({ level: 'warn', text: 'Ohne Schirm: Terra und Brontes sehr schwer' });
  return { list: out, per };
}

/** a part is there: built in and not destroyed */
export const hasPart = (s, id) => s.spec.ids.has(id) && !s.lost[id] && !s.dropped[id];
/** the g-load the flight computer plans with: the most sensitive crew member, or the cargo */
export const gLimitOf = (s) => (s.crew.length ? Math.min(...s.crew.map((c) => c.limit)) : (s.spec.payload?.g ?? G_LIMIT) * CARGO_MARGIN);
// cargo: the computer plans below the limit (the air and the canopy's jerk overshoot by ~15 %)
export const CARGO_MARGIN = 0.87;
/** decoupler: drop a part on purpose (the heat shield). It leaves with its mass; unlike a part that burned
 *  off this is no damage. Returns true if something was dropped. */
export function jettison(s, id) {
  if (!hasPart(s, id) || s.status !== 'flying') return false;
  s.dropped[id] = true;
  s.events.push({ type: 'drop', id, t: s.t });
  return true;
}
/** how much of the heat flux a part takes: orbit levels by how well the engine end leads (shieldF), normal
 *  levels by the tilt (sa, sb); folded panels and a heat shield facing the airflow (facing) protect */
function exposure(s, c, shieldF, facing, sa, sb) {
  let exp = s.planet.orbit
    ? c.heat[0] * (c.id === 'engine' ? 1 : (1 - (c.id === 'legs' ? 0.5 : 0.85) * shieldF) * (1 + 1.5 * (1 - shieldF)))
    : Math.max(0, c.heat[0] * (1 + Math.sign(c.pos[0]) * sa * 2.5 - Math.sign(c.pos[2]) * sb * 2.5));
  if (c.id === 'solarL' || c.id === 'solarR') exp *= 1 - 0.88 * s.panelFold; // folded panels sit in the lee of the frame
  if (facing > 0 && c.id !== 'shield') exp *= 1 - (c.id === 'legs' ? 0.45 : 0.75) * facing;
  return exp;
}
/** heat shield hint: re-entry is over (or there is none to come), the shield is only dead weight now */
export function shieldDropHint(s) {
  if (!hasPart(s, 'shield') || s.status !== 'flying' || s.t < 2) return null;
  const p = s.planet;
  if (p.rho === 0) return 'vacuum';
  // worst case from here on: the speed (current or terminal) all the way down into the densest air. If no part would get
  // past 70 % of its limit without the shield (in the current attitude), the shield has done its job.
  // still falling faster? the speed can grow up to the terminal speed of the air around the lander now
  const vt = Math.sqrt((2 * massProps(s).m * p.g) / (Math.max(1e-6, density(s)) * BODY_CDA));
  const v0 = Math.hypot(s.vx - s.windX, s.vy, s.vz - s.windZ), fall = Math.sqrt(v0 * v0 + 2 * p.g * Math.max(0, altitude(s)));
  const v = Math.max(v0, Math.min(vt, fall)); // (and never more than free fall to the ground gives)
  const fMax = Math.sqrt(p.rho) * (v / 100) ** 3 * HEAT_K * (p.heatK ?? 1);
  const sa = Math.sin(s.a), sb = Math.sin(s.b);
  for (const c of s.spec.comps) {
    if (s.lost[c.id] || s.dropped[c.id] || !c.heat || c.id === 'shield') continue;
    if (T_AMB + (fMax * exposure(s, c, s.heatShield ?? 0, 0, sa, sb)) / HEAT_COOL > T_AMB + (c.heat[1] - T_AMB) * 0.7) return null;
  }
  return s.peakFlux > 8 ? 'over' : 'safe';
}

// ---------- terrain ----------
const PAD_R = 70;
function noise(x, z) {
  return Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017) * 14
       + Math.sin(x * 0.067 + z * 0.041) * 5
       + Math.sin(x * 0.13 - z * 0.11 + 2.1) * 2;
}
// orbit level: the landing-zone relief fades out to the smooth sphere beyond this radius (null = endless relief)
let terrainEdge = null, terrainR = 0, terrainId = '';
/** orbit level: landing-zone relief fades out at `r`, the planet's own relief (radius R, layout `id`) takes over */
export function setTerrainEdge(r, R = 0, id = 'luna-orbit') { terrainEdge = r; terrainR = R; terrainId = id; }
// ---------- landing sites: the shape of the land around the pad (the pad itself stays flat) ----------
export const SITES = {
  plain: { name: 'Ebene', icon: '▬' },
  crater: { name: 'Krater', icon: '◡' }, // pad on a crater floor, walls ~95 m high around it
  mesa: { name: 'Plateau', icon: '⏏' }, // pad on a mesa, a 65 m cliff beyond 150 m
  canyon: { name: 'Schlucht', icon: '⋁' }, // a 55 m deep gorge 110 m past the pad (overshoot)
};
export const SITE_IDS = Object.keys(SITES);
let terrainSite = 0;
export function setSite(id) { terrainSite = Math.max(0, SITE_IDS.indexOf(id)); }
export const currentSite = () => SITE_IDS[terrainSite];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** height the site adds at (x, z), r = distance from the pad (mirrored in moon.js GLSL siteHeight) */
function siteHeight(x, z, r) {
  if (terrainSite === 1) return r < 330 ? 95 * sstep(140, 330, r) : 95 * Math.exp(-(((r - 330) / 180) ** 2));
  if (terrainSite === 2) return -65 * sstep(150, 185, r);
  if (terrainSite === 3) { const d = (x - 110) / 28; return -55 * Math.exp(-d * d) * (1 - sstep(500, 700, Math.abs(z))); }
  return 0;
}
export function terrainHeight(x, z = 0) {
  const r = Math.hypot(x, z);
  if (terrainEdge && r > terrainEdge - 250) {
    const e = Math.min(1, (r - (terrainEdge - 250)) / 250);
    const outer = terrainR ? moonRelief(x, z, terrainR, terrainEdge, terrainId) : 0;
    if (e >= 1) return outer;
    const t = Math.min(1, Math.max(0, (r - PAD_R) / 60)), blend = t * t * (3 - 2 * t);
    return ((noise(x, z) + 6) * blend + siteHeight(x, z, r)) * (1 - e * e * (3 - 2 * e)) + outer;
  }
  const t = Math.min(1, Math.max(0, (r - PAD_R) / 60));
  const blend = t * t * (3 - 2 * t);
  return (noise(x, z) + 6) * blend + siteHeight(x, z, r);
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
  const spec = makeSpec(opts.build);
  const fuelK = (opts.fuelK ?? 1) * spec.tankK;
  if (planet.orbit) {
    // circular orbit, lying on the side with the engine pointing retrograde, burn limited to a crew-friendly 50 %
    // pe: start at the high point of an ellipse whose low point is pe above the ground (aerobraking orbits)
    const rA = planet.R + planet.alt, rP = planet.R + (planet.pe ?? planet.alt);
    const v = orbitSpeed(planet, planet.alt) * (planet.pe !== undefined ? Math.sqrt((2 * rP) / (rA + rP)) : 1);
    const s = createState({ ...planet, orbit: false }, { ...opts, wind: planet.rho > 0 ? opts.wind : 0, pitch0: 0, vz0: 0 });
    // the starting limiter: crew-friendly, and for a light cargo low enough that the burn stays below its g limit
    let limit0 = planet.limit0 ?? 0.5;
    if (spec.payload) {
      const m = spec.comps.reduce((a, c) => a + c.mass, 0) + s.fuel0;
      limit0 = Math.min(limit0, Math.floor(((spec.payload.g * CARGO_MARGIN * G0 * m) / spec.fMax) * 20) / 20);
    }
    // miss: the orbit is a great circle that passes this far to the side of the pad (+ = north of it, +z)
    let z0 = 0, vx0 = v * (planet.vK ?? 1), vz0 = 0;
    if (planet.miss) {
      const td = Math.tan(planet.miss / planet.R), l0 = -planet.downrange / planet.R, b0 = Math.atan(td * Math.cos(l0));
      const dbdl = (-td * Math.sin(l0)) / (1 + td * td * Math.cos(l0) ** 2), psi = Math.atan2(dbdl / Math.cos(b0), 1);
      z0 = b0 * planet.R; vz0 = vx0 * Math.sin(psi); vx0 *= Math.cos(psi);
    }
    return Object.assign(s, { planet, x: -planet.downrange, z: z0, y: planet.alt, vx: vx0, vy: 0, vz: vz0,
      a: Math.PI / 2, holdA: Math.PI / 2, b: 0, holdB: 0, sas: 'retro', limit: limit0, limit0 });
  }
  return {
    planet, t: 0,
    wind: { level: WIND_LEVELS.indexOf(lvl), name: lvl.name, speed: lvl.speed, gust: lvl.gust, bonus: lvl.bonus,
      heading, dir: Math.cos(heading) >= 0 ? 1 : -1, seed: opts.windSeed ?? rnd() * 100 },
    windNow: 0, windX: 0, windZ: 0, windTorque: 0, windTorqueB: 0,
    // start upwind so the wind carries the lander roughly towards the pad
    x: -Math.cos(heading) * off, z: -Math.sin(heading) * off, y: planet.alt,
    vx: planet.vx, vy: planet.vy, vz: opts.vz0 ?? side * Math.abs(planet.vx) * 0.7,
    a: t0, w: 0, b: b0, wb: 0,
    spec, fuel0: planet.fuel * fuelK, fuelL: (planet.fuel * fuelK) / 2, fuelR: (planet.fuel * fuelK) / 2, battery: BAT_CAP,
    limit: 1, throttle: 0, sas: 'hold', holdA: t0, holdB: b0, sasI: 0, sasIB: 0,
    gNow: 0, maxG: 0, gStress: 0, gOverTime: 0, powered: true, blackout: false,
    crew: [...CREW, CREW_EXTRA].filter((c) => spec.crew.includes(c.id)).map((c) => ({ ...c, stress: 0, out: false, fainted: 0 })),
    torqueCom: 0, torqueComB: 0, sasTorque: 0, temp: Object.fromEntries(spec.comps.map((c) => [c.id, T_AMB])), lost: {}, dropped: {}, peakFlux: 0, events: [], obstacles: [], cargoOver: 0, cargoDamaged: null,
    panels: 'out', panelFold: 0,
    chute: 'stowed', chuteT: 0, chuteInflate: 0, chuteOpen: 0, q: 0, maxQ: 0, drag: 0,
    status: 'flying', reason: '', touch: null, log: [],
  };
}

export function massProps(s) {
  let m = 0, mx = 0, my = 0, mz = 0;
  const parts = (s.spec?.comps ?? COMPONENTS).filter((c) => !s.lost?.[c.id] && !s.dropped?.[c.id]).map((c) => {
    const mass = c.mass + (c.fuel ? s[c.fuel] : 0);
    const [px, py, pz = 0] = c.com || c.pos;
    m += mass; mx += mass * px; my += mass * py; mz += mass * pz;
    return [mass, px, py];
  });
  if (s.docked) { // a module docked on top of the capsule
    const [px, py] = [0, s.docked.y];
    m += s.docked.mass; mx += s.docked.mass * px; my += s.docked.mass * py;
    parts.push([s.docked.mass, px, py]);
  }
  const cx = mx / m, cy = my / m, cz = mz / m;
  let I = 0; // same inertia assumed about both tilt axes
  for (const [mass, px, py] of parts) I += mass * ((px - cx) ** 2 + (py - cy) ** 2 + 0.4);
  return { m, cx, cy, cz, I };
}

/** Where the lander would touch down if nothing changes from now on (no thrust): gravity, drag with the
 *  current canopy, wind and its shear included. Returns { x, z, t } or null if it never gets there. */
export function predictImpact(s, path = null) {
  const { m } = massProps(s);
  let chuteK = s.chute === 'open' && s.planet.rho > 0 ? s.chuteInflate : 0;
  // orbit levels with thick air: assume the chute opens as soon as it is safe (that is what the HUD asks
  // for), otherwise the cross lies kilometres long and a burn "until the cross is on the pad" falls short
  const planChute = s.planet.orbit && s.planet.rho > 0.5 && s.chute === 'stowed' && hasPart(s, 'chute');
  const mustBrake = (m * s.planet.g) / BODY_CDA > CHUTE_QMAX * CHUTE_SAFE; // terminal pressure above the canopy limit
  const gSafe = gLimitOf(s) * 0.95 * G0;
  let lastQ = Infinity;
  let x = s.x, y = s.y, z = s.z, vx = s.vx, vy = s.vy, vz = s.vz, t = 0;
  const h = s.planet.orbit ? 0.2 : 0.1;
  for (let i = 0, n = s.planet.orbit ? 2000 : 1200; i < n; i++) {
    if (path && i % 5 === 0) path.push(x, y);
    const ground = s.planet.orbit && y > 600 ? -1e9 : terrainHeight(x, z);
    if (y <= ground) { if (path) path.push(x, y); return { x, z, t }; }
    const alt = ground < -1e8 ? y : y - ground;
    const w = windAt(s, alt, s.t + t);
    const rx = vx - w.x, rz = vz - w.z, v = Math.hypot(rx, vy, rz);
    const rho = s.planet.rho * Math.exp(-Math.max(0, y) / s.planet.H);
    const q = 0.5 * rho * v * v;
    const qRate = lastQ === Infinity ? 0 : (q - lastQ) / h;
    // (where the canopy is never safe at terminal speed, Brontes, the HUD asks you to brake with the engine
    // below the chute altitude until it is safe, then open it)
    if (planChute && chuteK === 0 && vy < -10 && alt < CHUTE_MAX_ALT(s.planet) && q + Math.max(0, qRate) * 3 <= CHUTE_QMAX * CHUTE_SAFE) chuteK = 1;
    lastQ = q;
    // ...and until then the braking burn the HUD asks for (current thrust limit, against the airflow)
    const Fd = q * BODY_CDA + Math.min(q * s.spec.chuteCda * chuteK, chuteK > 0 ? s.spec.chuteFmax : 0);
    // the braking burn at the thrust the HUD recommends (crew-safe together with the air drag)
    const brake = planChute && mustBrake && chuteK === 0 && vy < -10 && alt < CHUTE_MAX_ALT(s.planet)
      ? Math.max(0.05 * s.spec.fMax / m, Math.min(s.spec.fMax / m, gSafe - Fd / m)) : 0; // not the current limiter
    const k = v > 0.01 ? -Fd / v / m - brake / v : 0;
    const cv = curvature(s.planet, y, vx, vy, vz, z);
    vx += (k * rx + (cv ? cv.ax : 0)) * h; vy += (k * vy - (cv ? cv.gy : s.planet.g)) * h; vz += (k * rz + (cv ? cv.az : 0)) * h;
    x += vx * (cv ? cv.kx : 1) * h; y += vy * h; z += vz * (cv ? cv.k : 1) * h; t += h;
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
  if (s.chute === 'stowed' && hasPart(s, 'chute')) {
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
    const drag = q * BODY_CDA + Math.min(q * s.spec.chuteCda * chuteK, chuteK > 0 ? s.spec.chuteFmax : 0);
    v += (s.planet.g - drag / m) * h;
    alt -= v * h; t += h;
  }
  return t;
}
export const CHUTE_SAFE = 0.95; // deploy hint/button below this share of CHUTE_QMAX
/** highest altitude at which the HUD suggests the chute (higher on the orbit levels' compressed air) */
export const CHUTE_MAX_ALT = (p) => (p.orbit && p.rho > 0.5 ? 2500 : 1200);
/** deorbit fine control as a hint (thick-air orbit levels, while high): as the cross nears the pad, the thrust
 *  limit that keeps it from overshooting (the same law the optional automatic fine control applies) */
export function fineHint(s) {
  const p = s.planet;
  if (!p.deorbitAt || !s.pred || altitude(s) <= 4000 || Math.hypot(s.vx, s.vz) < 80) return null;
  const d = Math.hypot(s.pred.x, s.pred.z);
  if (d >= 3000) return null;
  return { d, limit: Math.max(0.05, Math.round((s.limit0 ?? p.limit0 ?? 0.5) * Math.max(0.06, d / 3000) * 100) / 100) };
}
/** thick-air orbit levels where the canopy is never safe at terminal speed: brake with the engine first */
export function brakeForChute(s) {
  const p = s.planet;
  if (!(p.orbit && p.rho > 0.5) || s.chute !== 'stowed' || !hasPart(s, 'chute')) return false;
  const { m } = massProps(s);
  return (m * p.g) / BODY_CDA > CHUTE_QMAX * CHUTE_SAFE && altitude(s) < CHUTE_MAX_ALT(p) && s.vy < -10 && !chuteSafe(s);
}
/** hint for that braking burn: the thrust limit (0..1) that keeps the felt load (engine + air) just below
 *  the most sensitive crew member's limit. Near 0 means the air alone already brakes that hard. */
export function chuteBrakeLimit(s) {
  const { m } = massProps(s);
  const gMax = gLimitOf(s) * 0.95 * G0;
  const fromAir = s.drag / m;
  return Math.max(0, Math.min(1, ((gMax - fromAir) * m) / s.spec.fMax));
}
/** safe to open the chute now: pressure low enough and not about to rise past the limit */
export function chuteSafe(s) {
  return s.q + Math.max(0, s.qRate ?? 0) * 3 <= CHUTE_QMAX * CHUTE_SAFE; // and still below the limit in 3 s
}

/** Bordcomputer: stopping distance (m) burning at the current throttle limit, including air drag
 *  and the parachute as it is right now. Infinity if the engine cannot stop the descent. */
export function stoppingDistance(s) {
  if (s.vy >= 0) return 0;
  const { m } = massProps(s);
  const maxFrac = s.powered ? 1 : 0.6;
  // orbit levels: you fly lying on the side for a long time; assume you turn (nearly) upright for the burn
  const uy = s.planet.orbit ? Math.max(0.85, upVector(s).y) : upVector(s).y;
  const aThr = ((s.spec.fMax * Math.min(s.limit, maxFrac)) / m) * uy;
  if (aThr <= s.planet.g) return Infinity;
  const rho = density(s);
  const chuteK = s.chute === 'open' && s.planet.rho > 0 ? s.chuteInflate : 0;
  let v = -s.vy, d = 0;
  const h = 0.02;
  for (let i = 0; i < 20000 && v > 0; i++) {
    const q = 0.5 * rho * v * v;
    const drag = q * BODY_CDA + Math.min(q * s.spec.chuteCda * chuteK, s.spec.chuteFmax * (chuteK > 0 ? 1 : 0));
    v -= (aThr + drag / m - s.planet.g) * h;
    d += Math.max(0, v) * h;
  }
  return d;
}

const feetAt = (f) => [[-f, 0], [f, 0], [0, -f], [0, f]];
const FEET = feetAt(FOOT_X);
/** World position of each foot pad: [x, y, z, groundHeight]. */
/** the lander turns about this body point (about its centre of mass), not about its foot plane;
 *  (s.x, s.y, s.z) stays the foot-plane centre of the upright lander, so upright nothing changes */
export const PIVOT_Y = 3.0;
export function feet(s) {
  const ca = Math.cos(s.a), sa = Math.sin(s.a), cb = Math.cos(s.b || 0), sb = Math.sin(s.b || 0);
  const F = s.spec?.footX;
  return (F && F !== FOOT_X ? feetAt(F) : FEET).map(([fx, fz]) => {
    // body point (fx, -PIVOT_Y, fz) relative to the pivot, rotated Rx(b) * Rz(a)
    const rx = fx * ca + PIVOT_Y * sa, ry = fx * sa - PIVOT_Y * ca;
    const x = s.x + rx, y = s.y + PIVOT_Y + ry * cb - fz * sb, z = (s.z || 0) + ry * sb + fz * cb;
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
  const rupture = sink > WRECK_V || (sink > s.spec.land.vy[2] + 3 && drift > 6);
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
export const VCMD = 8;
export const RCS_TRANS = 2400; // N: the side thrusters pushing sideways (Landen mode), ~0.4 m/s² on the standard lander // m/s over ground at full pad deflection (Retro 2)
function retro2Targets(s, F, m, dt, moveX = 0, moveZ = 0) {
  const steering = Math.hypot(moveX, moveZ) > 0.01;
  if (F > 0) s.r2BurnT = s.t;
  const burning = s.t - (s.r2BurnT ?? -99) < 1.5; // stay in burn mode through short throttle gaps
  let hx = 0, hz = 0; // wanted horizontal component of the thrust axis
  if (s.chute === 'open' && s.planet.rho > 0) {
    // under the canopy: hang straight, the chute does the work
  } else if (burning || (steering && F > 0)) {
    const Fe = Math.max(F, s.spec.fMax * Math.max(s.limit, 0.3));
    // lead the drift by the attitude lag (~0.4 s) so the lean is gone when the drift is
    const ax = (s.vx - (s.r2vx ?? s.vx)) / Math.max(dt, 1e-3), az = (s.vz - (s.r2vz ?? s.vz)) / Math.max(dt, 1e-3);
    const px = s.vx + ax * 0.4, pz = s.vz + az * 0.4;
    // fly at the commanded ground velocity (0 when the pad is released = stop the drift)
    // allowed sideways speed shrinks near the ground so a held stick can't drag you in sideways
    const vmax = Math.max(1, Math.min(VCMD, altitude(s) * 0.2));
    hx = (-(px - moveX * vmax) * 1.0 * m - (s.dragX || 0)) / Fe;
    hz = (-(pz - moveZ * vmax) * 1.0 * m - (s.dragZ || 0)) / Fe;
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
  if (cmd && s.sas && s.computerOK) {
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
    // big turns (Senkrecht from lying flat, Retro after an overshot burn) at a steady rate instead of a whip:
    // the error is capped, so the turn rate stays near 0.3 rad/s and the lander does not swing past
    const err = Math.max(-0.35, Math.min(0.35, A - target));
    s[tauKey] = clamp(-(2.2 * err + 2.6 * W + 1.2 * s[integKey]) * I - comTorque);
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
  s.blackout = s.crew[0]?.out ?? false;

  // --- engine ---
  let thr = input.thrust && !s.blackout ? s.limit : 0;
  if (!s.powered) thr = Math.min(thr, 0.6); // pumps off -> pressure-fed only
  // Seite / Ziel: the computer doses the thrust: only once the nose points along the speed change, and only
  // as much as is still missing (so holding the thrust button cannot overshoot)
  const mv = thr > 0 && s.computerOK && p.orbit ? maneuver(s) : null;
  if (mv) {
    const u0 = upVector(s), al = mv.mag > 1e-6 ? (u0.x * mv.dv.x + u0.y * mv.dv.y + u0.z * mv.dv.z) / mv.mag : 0;
    thr = mv.mag <= mv.done || al < 0.97 ? 0 : Math.min(thr, (mv.mag * massProps(s).m) / (s.spec.fMax * 0.6));
  }
  if (fuel(s) <= 0) thr = 0;
  // deorbit fine control (thick-air orbit levels): high up, the computer throttles down as the predicted
  // touchdown nears the pad; 1 m/s there moves the landing point by a few hundred metres
  s.fineBurn = false;
  if (p.deorbitAt && thr > 0 && s.pred && altitude(s) > 4000 && s.computerOK && s.settings?.autoFine) {
    const d = Math.hypot(s.pred.x, s.pred.z);
    if (d < 3000) { thr *= Math.max(0.06, d / 3000); s.fineBurn = true; }
  }
  const mdot = (thr * s.spec.fMax) / (s.spec.isp * G0);
  // both tanks feed the engine evenly; if one runs dry the other takes over
  const need = mdot * dt;
  const takeL = Math.min(s.fuelL, need / 2 + Math.max(0, need / 2 - s.fuelR));
  const takeR = Math.min(s.fuelR, need - takeL);
  s.fuelL = Math.max(0, s.fuelL - takeL);
  s.fuelR = Math.max(0, s.fuelR - takeR);
  s.throttle = thr;

  const { m, cx, cz, I } = massProps(s);
  const F = thr * s.spec.fMax;
  const u = upVector(s);

  // --- attitude: the same controller on both tilt axes ---
  s.torqueCom = -cx * F; // thrust through the engine axis, CoM off-axis -> torque
  s.torqueComB = cz * F;
  const aThr = F / m;
  // retro leans so the thrust's sideways part kills the drift in about a second
  const lean = (v) => Math.max(-0.17, Math.min(0.17, Math.asin(Math.max(-1, Math.min(1, (v * 0.8) / Math.max(aThr, 1))))));
  let tA = s.sas === 'retro' && thr > 0 ? lean(s.vx) : 0;
  let tB = s.sas === 'retro' && thr > 0 ? -lean(s.vz) : 0;
  if (s.sas === 'retro' && p.orbit) {
    // orbit level: point the engine against the velocity (any angle), so it can brake the orbital speed and
    // shield the lander on entry. Slow and low it becomes the normal capped retro lean again: near the end
    // of a burn the velocity direction is meaningless and would tip the lander over
    const vh = Math.hypot(s.vx, s.vz), v = Math.hypot(vh, s.vy);
    // (under an open canopy it hangs straight instead of fighting the chute)
    // only while there is real speed: when a burn overshoots, the velocity passes through zero and its direction
    // flips by up to 180° within a second, which would spin the lander around (then: the capped lean)
    if (v > 0.5 && (vh > 25 || altitude(s) > 400) && !(s.chute === 'open' && p.rho > 0)) {
      const rA = Math.atan2(s.vx, -s.vy), rB = -Math.asin(Math.max(-1, Math.min(1, s.vz / v)));
      if (v > 25 || Math.hypot(rA - s.a, rB - s.b) < 0.6) { tA = rA; tB = rB; }
    }
  }
  if (s.sas === 'target' && p.orbit) {
    // Ziel: the nose along the speed change that brings the lander to the module
    const tr = targetRel(s);
    if (tr && tr.near) [tA, tB] = attTarget(s, tr.u); // close: the nose (our port) on the module, translate with RCS
    else if (tr && tr.dvMag > 0.15) { const l = tr.dvMag; [tA, tB] = attTarget(s, { x: tr.dv.x / l, y: tr.dv.y / l, z: tr.dv.z / l }); }
    else { tA = s.a; tB = s.b; }
    if (!tr && s.sasPending === undefined) s.sas = 'retro'; // docked (or gone): back to Bremsen
  }
  if (s.sas === 'side' && p.orbit) {
    // Seite: the nose (thrust) along the sideways speed change that swings the orbit plane over the base
    const tm = trackMiss(s);
    if (tm && tm.dvMag > SIDE_DONE) {
      const l = tm.dvMag, D = { x: tm.dv.x / l, y: tm.dv.y / l, z: tm.dv.z / l };
      [tA, tB] = attTarget(s, D);
    } else { tA = s.a; tB = s.b; }
    // done (the orbit runs over the base) and the engine off: back to Bremsen by itself
    if ((!tm || tm.dvMag <= SIDE_DONE) && thr === 0 && s.sasPending === undefined) { s.sas = 'retro'; s.events.push({ type: 'sideDone', t: s.t }); }
  }
  let cmdA = input.rcs || 0, cmdB = input.rcsZ || 0;
  // under an open canopy the pad steers the parachute (pulls the risers) instead of tilting the lander
  const chuteSteer = s.chute === 'open' && s.planet.rho > 0 && s.chuteInflate > 0.5;
  s.steerX = chuteSteer ? -cmdA : 0; s.steerZ = chuteSteer ? cmdB : 0;
  if (chuteSteer) { cmdA = cmdB = 0; }
  let trans = null; // Landen: side thrusters push sideways towards the commanded ground velocity
  if (s.sas === 'retro2') {
    // velocity command: the pad says where to fly (world direction), the computer tilts to get there
    const moveX = -cmdA, moveZ = cmdB;
    [tA, tB] = retro2Targets(s, F, m, dt, moveX, moveZ);
    cmdA = cmdB = 0;
    if (s.computerOK && !s.blackout && !(s.chute === 'open' && p.rho > 0)) {
      const vmax = Math.max(1, Math.min(VCMD, altitude(s) * 0.2)), amax = RCS_TRANS / m;
      const ex = moveX * vmax - s.vx, ez = moveZ * vmax - s.vz, want = Math.hypot(ex, ez) * 1.2;
      const acc = Math.min(amax, want), k = want > 1e-6 ? acc / want * 1.2 : 0;
      trans = { ax: ex * k, az: ez * k, use: acc / amax };
    }
  }
  const ra = controlAxis(s, 'a', 'w', 'holdA', 'sasI', cmdA, tA, s.torqueCom, I, dt);
  const rb = controlAxis(s, 'b', 'wb', 'holdB', 'sasIB', cmdB, tB, s.torqueComB, I, dt);
  const rcsUse = Math.min(1, Math.max(ra, rb) + (trans ? trans.use * 0.5 : 0));
  s.w += ((s.torqueCom + s._tauA) / I) * dt;
  s.wb += ((s.torqueComB + s._tauB) / I) * dt;
  s.a += s.w * dt;
  s.b += s.wb * dt;

  // --- aerodynamics: body drag + parachute, against the airflow relative to the lander ---
  const wind = windAt(s);
  s.windNow = wind.speed; s.windX = wind.x; s.windZ = wind.z;
  const rx = s.vx - wind.x, rz = s.vz - wind.z;
  const v = Math.hypot(rx, s.vy, rz);
  const qNew = 0.5 * density(s) * v * v;
  // trend of the dynamic pressure (Pa/s, smoothed): rising means the chute would see more than it does now
  s.qRate = (s.qRate ?? 0) + (((qNew - (s.q ?? qNew)) / dt) - (s.qRate ?? 0)) * Math.min(1, dt * 2);
  s.q = qNew;
  s.maxQ = Math.max(s.maxQ, s.q);
  if (s.chute === 'open') {
    s.chuteT += dt;
    const k = Math.min(1, s.chuteT / CHUTE_INFLATE);
    s.chuteInflate = k * k * (3 - 2 * k);
    if (s.planet.rho > 0 && s.q > CHUTE_QMAX && s.chuteInflate > 0.2) s.chute = 'torn';
  } else s.chuteInflate = Math.max(0, s.chuteInflate - dt * 2);
  // reefed canopy: opens only as far as the riser load allows
  const CDA = s.spec.chuteCda, FMX = s.spec.chuteFmax;
  const chuteCda = s.chute === 'open' && s.planet.rho > 0 ? Math.min(CDA * s.chuteInflate, FMX / Math.max(s.q, 1)) : 0;
  s.chuteOpen = chuteCda / CDA; // 0..1 how far the canopy is actually open
  const Fd = s.q * (BODY_CDA + chuteCda);
  s.drag = Fd;
  const k = v > 0.01 ? -Fd / v : 0;
  const dx = k * rx, dy = k * s.vy, dz = k * rz;
  s.dragX = dx; s.dragZ = dz; // horizontal air force, used by Retro 2 as feed-forward
  // side force acts above the CoM and tips the lander downwind (body drag only, the canopy hangs free)
  const ks = v > 0.01 ? (-s.q * BODY_CDA) / v : 0;
  const arm = WIND_ARM + (WIND_ARM_PANELS - WIND_ARM) * (1 - s.panelFold) * (hasPart(s, 'solarL') || hasPart(s, 'solarR') ? 1 : 0);
  // torque = arm * u x F_perp, with F_perp the part of the body drag across the lander's axis. Upright this is
  // exactly the old side-wind model; engine first into the flow (u against the airflow) it vanishes and is
  // stable, so a lander lying in the airstream from orbit doesn't tumble
  if (!p.orbit) {
    // normal levels: the original side-wind model (horizontal airflow only), tuned and played as is
    s.windTorque = -arm * ks * rx;
    s.windTorqueB = arm * ks * rz;
  } else {
    const u0 = upVector(s), Fx = ks * rx, Fy = ks * s.vy, Fz = ks * rz;
    const along = Fx * u0.x + Fy * u0.y + Fz * u0.z;
    const px = Fx - along * u0.x, py = Fy - along * u0.y, pz = Fz - along * u0.z;
    s.windTorque = arm * (u0.x * py - u0.y * px);  // z component of u x F_perp
    s.windTorqueB = arm * (u0.y * pz - u0.z * py); // x component
  }
  s.w += (s.windTorque / I) * dt;
  s.wb += (s.windTorqueB / I) * dt;
  if (s.chute === 'open' && s.planet.rho > 0 && s.chuteInflate > 0.05) {
    // canopy hangs above the CoM and pulls the lander upright
    const pull = s.q * CDA * Math.min(s.chuteInflate, FMX / Math.max(s.q, 1) / CDA) * CHUTE_ARM;
    s.w += ((-Math.sin(s.a) * pull - s.w * pull * 0.6) / I) * dt;
    s.wb += ((-Math.sin(s.b) * pull - s.wb * pull * 0.6) / I) * dt;
  }

  // --- translation ---
  const cv = curvature(p, s.y, s.vx, s.vy, s.vz, s.z);
  s.vx += ((F * u.x + dx) / m + (cv ? cv.ax : 0)) * dt;
  s.vy += ((F * u.y + dy) / m - (cv ? cv.gy : p.g)) * dt;
  s.vz += ((F * u.z + dz) / m + (cv ? cv.az : 0)) * dt;
  if (trans) { s.vx += trans.ax * dt; s.vz += trans.az * dt; }
  // RCS translation (docking): input.tx / ty / tz in the local frame (east / up / north), from the side jets
  const tl = Math.hypot(input.tx || 0, input.ty || 0, input.tz || 0);
  if (tl > 0 && s.computerOK && !s.blackout && p.orbit) {
    const k = (RCS_TRANS / m) / Math.max(1, tl);
    s.vx += (input.tx || 0) * k * dt; s.vy += (input.ty || 0) * k * dt; s.vz += (input.tz || 0) * k * dt;
    s.rcsTrans = Math.min(1, tl);
  } else s.rcsTrans = 0;
  if (s.steerX || s.steerZ) {
    // steerable canopy: glide up to CHUTE_GLIDE m/s through the air in the commanded direction
    const sl = Math.hypot(s.steerX, s.steerZ), ex = s.steerX / sl, ez = s.steerZ / sl;
    const along = (s.vx - wind.x) * ex + (s.vz - wind.z) * ez;
    const want = CHUTE_GLIDE * Math.min(1, sl);
    if (along < want) { const acc = Math.min(1.5, (want - along) * 1.2); s.vx += ex * acc * dt; s.vz += ez * acc * dt; }
  }
  s.x += s.vx * (cv ? cv.kx : 1) * dt;
  s.y += s.vy * dt;
  s.z += s.vz * (cv ? cv.k : 1) * dt;
  // the object in orbit coasts; a module latches on when the lander is close and slow
  if (s.target && !s.target.docked) {
    coast(p, s.target, dt);
    if (s.target.dock) {
      const tr = targetRel(s);
      if (tr && tr.portDist < DOCK_DIST && tr.speed < DOCK_SPEED && tr.aim < DOCK_ANGLE) {
        s.target.docked = true;
        s.docked = { mass: s.target.mass, y: PORT_Y };
        s.events.push({ type: 'docked', t: s.t });
      } else if (tr && tr.portDist < 0.3 && tr.closing > 0) {
        // bumped into it (too fast or crooked): bounce back a little
        const k = tr.closing * 1.4;
        s.vx -= tr.u.x * k; s.vy -= tr.u.y * k; s.vz -= tr.u.z * k;
        s.events.push({ type: 'bump', t: s.t, v: tr.closing });
      }
    }
  }
  // all the way around the planet: x is the arc from the pad, so it wraps at the far side (antipode)
  if (p.orbit && p.R && Math.abs(s.x) > Math.PI * p.R) { const dir = Math.sign(s.x); s.x -= dir * 2 * Math.PI * p.R; s.laps = (s.laps ?? 0) + dir; }

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
  s.gStress = s.crew[0]?.stress ?? 0;
  // cargo: too much g for longer than 0.3 s damages it
  if (s.spec.payload && !s.cargoDamaged) {
    s.cargoOver = s.gNow > s.spec.payload.g ? s.cargoOver + dt : 0;
    if (s.cargoOver > 0.3) { s.cargoDamaged = 'G-Last'; s.events.push({ type: 'cargo', t: s.t }); }
  }

  // --- power ---
  // base load: computer, radio, sensors, and life support with a crew (the uncrewed cargo core needs less)
  const use = (s.spec.payload ? 0.15 : 0.3) + (s.sas ? 0.15 : 0) + 2.2 * rcsUse + 1.1 * (s.rcsTrans ?? 0) + 1.2 * thr;
  const gen = (s.spec.engineGen ?? 0) * thr; // alternator on the turbopump (strong engines)
  s.panelFold = Math.max(0, Math.min(1, s.panelFold + (s.panels === 'in' ? dt : -dt) / 1.2));
  const panels = (hasPart(s, 'solarL') ? 1 : 0) + (hasPart(s, 'solarR') ? 1 : 0);
  // orbit levels: above the air the sun shines fully; it dims to the planet's ground value with the air below
  let sun = p.orbit && p.rho > 0 ? p.solar + (1 - p.solar) * (1 - Math.min(1, density(s) / p.rho)) : p.solar;
  if (p.orbit) {
    // orbit levels: none in the planet's shadow; the panels face where the nose points (some light either way)
    s.daylight = daylight(s);
    const sl = sunLocal(s), un = upVector(s), face = Math.max(0, un.x * sl.x + un.y * sl.y + un.z * sl.z);
    s.sunFace = face;
    sun *= s.daylight * (0.3 + 0.7 * face);
  }
  s.solarNow = sun;
  const gain = 1.6 * sun * (panels / 2) * (1 - s.panelFold) * (s.spec.solarK ?? 1);
  s.battery = Math.max(0, Math.min(BAT_CAP, s.battery + ((gain + gen - use) / s.spec.batK) * dt)); // big pack: slower %
  s.powerIn = gain / s.spec.batK; s.powerGen = gen / s.spec.batK; s.powerUse = use / s.spec.batK; // %/s, for the HUD

  // --- aerodynamic heating: hot parts glow, overheated parts blow off ---
  const flux = Math.sqrt(density(s)) * (v / 100) ** 3 * HEAT_K * (p.heatK ?? 1);
  s.heatFlux = flux;
  s.peakFlux = Math.max(s.peakFlux, flux);
  const sa = Math.sin(s.a), sb = Math.sin(s.b); // tilt exposes one side more
  // orbit levels: engine first into the airflow works as a heat shield for the rest of the lander
  // (1 = engine leading, 0 = sideways or worse); sideways flight exposes everything more
  let shield = 0;
  if (p.orbit) {
    const ux = upVector(s), vr = Math.hypot(s.vx - wind.x, s.vy, s.vz - wind.z) || 1;
    shield = Math.max(0, -((s.vx - wind.x) * ux.x + s.vy * ux.y + (s.vz - wind.z) * ux.z) / vr);
  }
  s.heatShield = shield;
  // heat shield (if built): protects everything above it while the engine end leads into the airflow
  let facing = 0;
  if (hasPart(s, 'shield')) {
    const ux = upVector(s), vr = Math.hypot(s.vx - wind.x, s.vy, s.vz - wind.z) || 1;
    facing = Math.max(0, -((s.vx - wind.x) * ux.x + s.vy * ux.y + (s.vz - wind.z) * ux.z) / vr);
    facing *= s.spec.comps.find((c) => c.id === 'shield').prot ?? 1; // the light shield protects less
  }
  for (const c of s.spec.comps) {
    if (s.lost[c.id] || s.dropped[c.id] || !c.heat) continue;
    const exp = exposure(s, c, shield, facing, sa, sb);
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
    const L = s.spec.land;
    const g = { vy: grade(sink, L.vy), vx: grade(drift, L.vx), tilt: grade(tilt, L.tilt) };
    const why = [];
    const r1 = (v) => +v.toFixed(1);
    if (g.vy === 3) why.push(`zu schnell (${sink.toFixed(1)} m/s, max ${r1(L.vy[2])})`);
    if (g.vx === 3) why.push(`seitliche Drift (${drift.toFixed(1)} m/s, max ${r1(L.vx[2])})`);
    if (g.tilt === 3) why.push(`zu schräg (${tilt.toFixed(0)}°, max ${Math.round(L.tilt[2])}°)`);
    // uneven ground: within the legs' range fine, up to UNEVEN_TIP times it the gear takes damage, beyond it tips over
    const spread = Math.max(...hs) - Math.min(...hs), fmt1 = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
    if (spread > s.spec.uneven * UNEVEN_TIP) why.push(`Gelände zu uneben, umgekippt (${fmt1(spread)} m Höhenunterschied, max ${fmt1(s.spec.uneven * UNEVEN_TIP)})`);
    else if (spread > s.spec.uneven) { g.uneven = 2; s.unevenDamage = spread; }
    if (s.lost.legs) why.push('Landebeine verglüht');
    // base: landed on (or against) a module that is already there
    const hit = s.obstacles.find((o) => Math.hypot(s.x - o.x, s.z - o.z) < o.r + s.spec.footX * 0.85);
    if (hit) why.push(`auf ${hit.name} gelandet`);
    const overall = why.length ? 3 : Math.max(g.vy, g.vx, g.tilt, g.uneven ?? 0);
    // crash energy 0..1: how violent the impact was (drives debris and explosion size)
    const energy = Math.min(1, Math.max(0, (sink - L.vy[2]) / 18 + (drift - L.vx[2]) / 25 + 0.1));
    s.touch = { vy: sink, vx: drift, tilt, grades: g, grade: overall, energy };
    if (overall === 3) s.touch.crash = classifyCrash(s, sink, drift);
    s.status = overall === 3 ? 'crashed' : 'landed';
    if (s.spec.payload) {
      if (s.status === 'landed' && !s.cargoDamaged && sink > s.spec.payload.touch) s.cargoDamaged = 'Aufsetzen';
      s.cargo = s.status !== 'landed' ? 'lost' : s.cargoDamaged ? 'damaged' : 'intact';
    }
    s.reason = why.join(', ');
    s.y -= alt; // snap to ground
  }
}
