// Orbit planets: procedural relief shared by the flight model (JS) and the renderer (GLSL), and the CDLOD
// terrain mesh. Features (all outside the landing zone): rolling hills, three sizes of craters, mountain
// ranges (ridged noise), long canyons / rilles / grabens, fissures, a shield volcano (Mars), a fresh rayed
// crater (Luna), and albedo: maria, dust, basalt. Heights are computed the same way in both languages.

// ---- integer hash, bit-identical in JS and GLSL (uint math) ----
function h3(x, y, z) {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}
function mx(h) {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
const u01 = (h) => (h >>> 8) / 16777216;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** 3D value noise in [0, 1] (smooth, trilinear over hashed lattice values) */
function vn(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const X = ix + 2048, Y = iy + 2048, Z = iz + 2048;
  const L = (a, b, t) => a * (1 - t) + b * t;
  const v = (i, j, k) => u01(h3(X + i, Y + j, Z + k));
  return L(L(L(v(0, 0, 0), v(1, 0, 0), ux), L(v(0, 1, 0), v(1, 1, 0), ux), uy),
           L(L(v(0, 0, 1), v(1, 0, 1), ux), L(v(0, 1, 1), v(1, 1, 1), ux), uy), uz);
}
const ridge = (n) => { const q = 2 * n - 1, r = 1 - Math.sqrt(q * q + 0.01); return r * r; }; // rounded crest

// crater octaves: cell size (m), share of cells with a crater, depth factor
export const OCTAVES = [[1800, 0.7, 0.1], [500, 0.6, 0.15], [140, 0.55, 0.2]];

// one octave of craters at point p (metres on the sphere): 2x2x2 nearest cells are enough because a
// crater's influence (centre jitter + 1.6 radii) stays within 0.6 cells of its cell centre
function craters(px, py, pz, C, prob, dk, wob, out) {
  const fx = px / C, fy = py / C, fz = pz / C;
  const bx = Math.floor(fx), by = Math.floor(fy), bz = Math.floor(fz);
  const ox = fx - bx < 0.5 ? -1 : 0, oy = fy - by < 0.5 ? -1 : 0, oz = fz - bz < 0.5 ? -1 : 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    const cx = bx + ox + i, cy = by + oy + j, cz = bz + oz + k;
    const h = h3(cx + 1024, cy + 1024, cz + 1024);
    if (u01(h) > prob) continue;
    const a = mx(h), b = mx(a), c = mx(b), d = mx(c);
    const qx = (cx + 0.5 + (u01(a) - 0.5) * 0.3) * C, qy = (cy + 0.5 + (u01(b) - 0.5) * 0.3) * C, qz = (cz + 0.5 + (u01(c) - 0.5) * 0.3) * C;
    const s = u01(d), rc = C * (0.1 + 0.18 * s * s);
    const t = (Math.hypot(px - qx, py - qy, pz - qz) / rc) * wob; // wob: irregular rims
    if (t > 2) continue;
    // flat floor, raised rim, ejecta blanket fading out by two radii
    const bowl = t < 1 ? Math.max(t * t - 1, -0.8) : 0, e = (t - 1) / 0.22, rim = Math.exp(-e * e);
    const ej = t > 1 ? 0.22 * Math.exp(-(t - 1) * 3) * (1 - smooth(1.6, 2, t)) : 0;
    out.h += rc * dk * (bowl + 0.35 * rim + ej);
    out.s += bowl * 0.6 + rim * 0.4 + ej;
  }
}

// ---- hand-placed features per planet (flat coords: x, z = arc length from the pad; the approach runs
// along -x at z = 0) ----
const LAYOUTS = {
  'luna-orbit': {
    style: 0, mount: 170,
    // [x0, z0, x1, z1, width, depth, meander amplitude]
    arcs: [[-3650, -2900, -3250, 3100, 110, 40, 70],      // sinuous rille across the approach
           [-9500, -3800, -1800, -8800, 320, 70, 0],     // long graben to the south
           [2500, 4200, 9500, 900, 160, 45, 90],         // rille beyond the pad
           [-11000, 2600, -4200, 5600, 240, 55, 30]],    // graben to the north
    volcano: null,
    hero: [-7400, -1500, 480, 70],                       // fresh rayed crater: x, z, radius, depth
  },
  'mars-orbit': {
    style: 1, mount: 140,
    arcs: [[-8200, -3600, -2500, 3400, 430, 130, 140],   // "Valles": wide canyon across the approach
           [-13000, 1200, -6000, 7600, 170, 60, 60],
           [1500, -5200, 8000, -1200, 220, 70, 80],
           [-4200, -9000, 2600, -6800, 120, 40, 50]],
    volcano: [-7600, 3600, 1900, 380, 320, 90],          // x, z, base radius, height, caldera radius, depth
    hero: null,
  },
  'terra-orbit': {
    style: 2, mount: 300, craterK: 0.15,
    arcs: [[-12000, -2600, -5200, 3400, 210, 38, 170],   // river valley across the approach
           [-6000, -9000, 1800, -4800, 260, 45, 190],
           [2600, 3400, 11000, 6400, 180, 30, 150],
           [-15000, 5200, -9000, 9800, 240, 40, 160]],
    volcano: null, hero: null,
  },
  'brontes-orbit': {
    style: 3, mount: 230, craterK: 0.35,
    arcs: [[-14000, -4200, -6400, 3000, 520, 160, 90],   // deep rift across the approach
           [-4200, 4600, 4800, 8800, 200, 70, 60],
           [-9000, -10000, -1200, -6800, 160, 55, 70],
           [3000, -3000, 9800, -7600, 260, 80, 40]],
    volcano: [-10500, 4800, 2400, 450, 420, 120],
    hero: null,
  },
};

function flatDir(x, z, R) {
  const d = Math.hypot(x, z), phi = d / R, sn = d > 1e-6 ? Math.sin(phi) / d : 0;
  return [x * sn, Math.cos(phi), z * sn];
}
const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** turn a planet's layout into the vectors both the JS relief and the shader uniforms use */
export function moonFeatures(id, R) {
  const L = LAYOUTS[id] ?? LAYOUTS['luna-orbit'];
  const arcs = L.arcs.map(([x0, z0, x1, z1, W, D, M]) => {
    const A = flatDir(x0, z0, R), B = flatDir(x1, z1, R);
    const n = norm(cross(A, B)), c = norm(A.map((v, i) => v + B[i])), tt = cross(n, c);
    return { n, c, cosL: dot(A, c), t: tt, W, D, M };
  });
  const vol = L.volcano ? { d: flatDir(L.volcano[0], L.volcano[1], R), r: L.volcano[2], h: L.volcano[3], cr: L.volcano[4], cd: L.volcano[5] } : null;
  const hero = L.hero ? { d: flatDir(L.hero[0], L.hero[1], R), r: L.hero[2], depth: L.hero[3] } : null;
  return { style: L.style, mount: L.mount, craterK: L.craterK ?? 1, arcs, vol, hero };
}

/** everything outside the landing zone at direction (dx, dy, dz); returns { h, s (crater shade), ... } */
function relief(dx, dy, dz, R, F, out) {
  const px = dx * R, py = dy * R, pz = dz * R;
  // rolling terrain: two octaves of value noise
  out.h = 60 * (vn(px / 4200 + 3, py / 4200, pz / 4200 + 1) - 0.5) + 24 * (vn(px / 1500 + 7, py / 1500, pz / 1500) - 0.5);
  out.s = 0;
  for (const [C, prob, dk] of OCTAVES) {
    const k = C * 0.12, wob = 1 + (vn(px / k + 19, py / k, pz / k) - 0.5) * 0.3;
    craters(px, py, pz, C, prob, dk * F.craterK, wob, out); // weathered worlds keep only faint craters
  }
  // mountain ranges: ridged noise, only where the region mask allows
  const mask = smooth(0.52, 0.72, vn(px / 6000 + 17, py / 6000, pz / 6000));
  if (mask > 0) {
    // domain-warped ridges, so ranges wind instead of forming blobs
    const wq = (vn(px / 2000 + 21, py / 2000, pz / 2000) - 0.5) * 900, mx_ = px + wq, my_ = py + wq, mz_ = pz + wq;
    const m = ridge(vn(mx_ / 2600, my_ / 2600, mz_ / 2600)) * 0.6 + ridge(vn(mx_ / 1000 + 5, my_ / 1000, mz_ / 1000)) * 0.28
            + ridge(vn(mx_ / 400 + 9, my_ / 400, mz_ / 400)) * 0.12;
    out.h += F.mount * m * mask;
  }
  // fissures: thin iso-lines of noise, long ones and short ones, in some regions
  const fm = smooth(0.45, 0.6, vn(px / 3000 + 5, py / 3000 + 2, pz / 3000));
  if (fm > 0) {
    const c1 = 1 - smooth(0, 0.025, Math.abs(vn(px / 700 + 31, py / 700, pz / 700) - 0.5));
    const c2 = 1 - smooth(0, 0.04, Math.abs(vn(px / 110 + 41, py / 110, pz / 110) - 0.5));
    out.h -= (8 * c1 + 2.5 * c2) * fm;
  }
  // canyons, rilles, grabens: flat floor, steep walls, slight rims, tapered ends, optional meander
  for (const a of F.arcs) {
    const along = dx * a.c[0] + dy * a.c[1] + dz * a.c[2];
    if (along <= a.cosL) continue;
    const end = smooth(a.cosL, a.cosL + (1 - a.cosL) * 0.15, along);
    const sd = (dx * a.n[0] + dy * a.n[1] + dz * a.n[2]) * R + a.M * Math.sin((dx * a.t[0] + dy * a.t[1] + dz * a.t[2]) * R / 520);
    const ad = Math.abs(sd);
    if (ad > a.W * 2) continue;
    const trough = 1 - smooth(a.W * 0.55, a.W, ad), e = (ad - a.W) / (a.W * 0.35);
    out.h += a.D * (-trough + 0.12 * Math.exp(-e * e)) * end;
  }
  // shield volcano with caldera
  if (F.vol) {
    const v = F.vol, d = Math.hypot(dx - v.d[0], dy - v.d[1], dz - v.d[2]) * R;
    if (d < v.r) { const s = 1 - d / v.r; out.h += v.h * s * s * (3 - 2 * s) - v.cd * (1 - smooth(v.cr * 0.7, v.cr, d)); }
  }
  // hero crater: big, fresh, with a central peak
  if (F.hero) {
    const c = F.hero, t = Math.hypot(dx - c.d[0], dy - c.d[1], dz - c.d[2]) * R / c.r;
    if (t < 1.8) {
      const bowl = t < 1 ? t * t - 1 : 0, e = (t - 1) / 0.22;
      out.h += c.depth * (bowl + 0.35 * Math.exp(-e * e) + 0.45 * Math.exp(-(t / 0.16) * (t / 0.16)));
    }
  }
}

let features = null, featuresKey = '';
const tmp = { h: 0, s: 0 };
/** relief outside the landing zone at flat coords (x, z = arc length from the pad), faded in past `edge` */
export function moonRelief(x, z, R, edge, id = 'luna-orbit') {
  const d = Math.hypot(x, z);
  const w = smooth(edge - 300, edge + 200, d);
  if (w <= 0) return 0;
  if (featuresKey !== id + R) { features = moonFeatures(id, R); featuresKey = id + R; }
  const [dx, dy, dz] = flatDir(x, z, R);
  relief(dx, dy, dz, R, features, tmp);
  return tmp.h * w;
}

// ---- GLSL twin of the functions above + the landing-zone relief from sim.js ----
export const MOON_GLSL = /* glsl */ `
uniform float uR;
uniform float uEdge;
uniform float uSite;
uniform vec3 uC1;
uniform vec3 uC2;
uniform float uStyle;
uniform float uMount;
uniform float uCraterK;
uniform vec4 uArcN[4];   // n.xyz, width
uniform vec4 uArcC[4];   // c.xyz, cos(half length)
uniform vec4 uArcT[4];   // t.xyz, depth
uniform float uArcM[4];  // meander amplitude
uniform vec4 uVol;       // dir.xyz, base radius (0 = none)
uniform vec4 uVolP;      // height, caldera radius, caldera depth
uniform vec4 uHero;      // dir.xyz, radius (0 = none)
uniform float uHeroD;
varying vec3 vMoonCol;
uint mh3(ivec3 c) {
  uint h = uint(c.x) * 0x8da6b343u ^ uint(c.y) * 0xd8163841u ^ uint(c.z) * 0xcb1ab31fu;
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return h ^ (h >> 15u);
}
uint mmx(uint h) {
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return h ^ (h >> 16u);
}
float mu(uint h) { return float(h >> 8u) / 16777216.0; }
float vn(vec3 p) {
  vec3 i = floor(p); vec3 f = p - i; vec3 u = f * f * (3.0 - 2.0 * f);
  ivec3 c = ivec3(i) + 2048;
  float a = mu(mh3(c)), b = mu(mh3(c + ivec3(1, 0, 0))), cc = mu(mh3(c + ivec3(0, 1, 0))), d = mu(mh3(c + ivec3(1, 1, 0)));
  float e = mu(mh3(c + ivec3(0, 0, 1))), g = mu(mh3(c + ivec3(1, 0, 1))), hh = mu(mh3(c + ivec3(0, 1, 1))), k = mu(mh3(c + ivec3(1, 1, 1)));
  return mix(mix(mix(a, b, u.x), mix(cc, d, u.x), u.y), mix(mix(e, g, u.x), mix(hh, k, u.x), u.y), u.z);
}
float ridge(float n) { float q = 2.0 * n - 1.0; float r = 1.0 - sqrt(q * q + 0.01); return r * r; }
void moonCraters(vec3 p, float C, float prob, float dk, float wob, inout vec2 acc) {
  vec3 f = p / C;
  vec3 b = floor(f);
  ivec3 o = ivec3(b) + ivec3(f.x - b.x < 0.5 ? -1 : 0, f.y - b.y < 0.5 ? -1 : 0, f.z - b.z < 0.5 ? -1 : 0);
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) for (int k = 0; k < 2; k++) {
    ivec3 c = o + ivec3(i, j, k);
    uint h = mh3(c + 1024);
    if (mu(h) > prob) continue;
    uint a = mmx(h); uint bb = mmx(a); uint cc = mmx(bb); uint d = mmx(cc);
    vec3 q = (vec3(c) + 0.5 + (vec3(mu(a), mu(bb), mu(cc)) - 0.5) * 0.3) * C;
    float s = mu(d);
    float rc = C * (0.1 + 0.18 * s * s);
    float t = length(p - q) / rc * wob;
    if (t > 2.0) continue;
    float bowl = t < 1.0 ? max(t * t - 1.0, -0.8) : 0.0;
    float e = (t - 1.0) / 0.22;
    float rim = exp(-e * e);
    float ej = t > 1.0 ? 0.22 * exp(-(t - 1.0) * 3.0) * (1.0 - smoothstep(1.6, 2.0, t)) : 0.0;
    acc.x += rc * dk * (bowl + 0.35 * rim + ej);
    acc.y += bowl * 0.6 + rim * 0.4 + ej;
  }
}
float sstep(float a, float b, float x) { return smoothstep(a, b, x); }
// landing site around the pad (same as sim.js siteHeight)
float siteHeight(vec2 xz, float d) {
  if (uSite > 0.5 && uSite < 1.5) return d < 330.0 ? 95.0 * sstep(140.0, 330.0, d) : 95.0 * exp(-pow((d - 330.0) / 180.0, 2.0));
  if (uSite > 1.5 && uSite < 2.5) return -65.0 * sstep(150.0, 185.0, d);
  if (uSite > 2.5) { float q = (xz.x - 110.0) / 28.0; return -55.0 * exp(-q * q) * (1.0 - sstep(500.0, 700.0, abs(xz.y))); }
  return 0.0;
}
float zoneNoise(float x, float z) {
  return sin(x * 0.021 + 1.3) * cos(z * 0.017) * 14.0 + sin(x * 0.067 + z * 0.041) * 5.0 + sin(x * 0.13 - z * 0.11 + 2.1) * 2.0;
}
// returns height; writes the colour of the ground there. spacing = grid cell size there (level of detail)
float moonHeight(vec3 dir, float spacing, bool wantCol, out vec3 col) {
  float d = uR * atan(length(dir.xz), dir.y);
  vec2 xz = length(dir.xz) > 1e-7 ? normalize(dir.xz) * d : vec2(0.0);
  // landing zone relief (same as sim.js terrainHeight), fading out towards the edge
  float t = clamp((d - 70.0) / 60.0, 0.0, 1.0);
  float blend = t * t * (3.0 - 2.0 * t);
  float e = clamp((d - (uEdge - 250.0)) / 250.0, 0.0, 1.0);
  float zone = ((zoneNoise(xz.x, xz.y) + 6.0) * blend + siteHeight(xz, d)) * (1.0 - e * e * (3.0 - 2.0 * e));
  float w = smoothstep(uEdge - 300.0, uEdge + 200.0, d);
  vec3 p = dir * uR;
  float hh = 60.0 * (vn(p / 4200.0 + vec3(3.0, 0.0, 1.0)) - 0.5) + 24.0 * (vn(p / 1500.0 + vec3(7.0, 0.0, 0.0)) - 0.5);
  float shade = 0.0, mnt = 0.0, crack = 0.0, canyon = 0.0, volc = 0.0, rays = 0.0;
  if (w > 0.0) {
    // craters; each size fades out where the grid is too coarse to draw it (no spikes)
    float C[3] = float[3](1800.0, 500.0, 140.0);
    float P[3] = float[3](0.7, 0.6, 0.55);
    float K[3] = float[3](0.1, 0.15, 0.2);
    for (int o = 0; o < 3; o++) {
      float f = smoothstep(C[o] * 0.14, C[o] * 0.04, spacing);
      if (f <= 0.0) continue;
      vec2 a = vec2(0.0);
      float wob = 1.0 + (vn(p / (C[o] * 0.12) + vec3(19.0, 0.0, 0.0)) - 0.5) * 0.3;
      moonCraters(p, C[o], P[o], K[o] * uCraterK, wob, a);
      hh += a.x * f; shade += a.y * f;
    }
    // mountain ranges
    float mask = smoothstep(0.52, 0.72, vn(p / 6000.0 + vec3(17.0, 0.0, 0.0)));
    if (mask > 0.0) {
      vec3 pm = p + vec3((vn(p / 2000.0 + vec3(21.0, 0.0, 0.0)) - 0.5) * 900.0);
      float m = ridge(vn(pm / 2600.0)) * 0.6 + ridge(vn(pm / 1000.0 + vec3(5.0, 0.0, 0.0))) * 0.28
              + ridge(vn(pm / 400.0 + vec3(9.0, 0.0, 0.0))) * 0.12 * smoothstep(120.0, 40.0, spacing);
      mnt = m * mask;
      hh += uMount * mnt;
    }
    // fissures
    float fm = smoothstep(0.45, 0.6, vn(p / 3000.0 + vec3(5.0, 2.0, 0.0)));
    if (fm > 0.0) {
      float c1 = 1.0 - smoothstep(0.0, 0.025, abs(vn(p / 700.0 + vec3(31.0, 0.0, 0.0)) - 0.5));
      float c2 = (1.0 - smoothstep(0.0, 0.04, abs(vn(p / 110.0 + vec3(41.0, 0.0, 0.0)) - 0.5))) * smoothstep(30.0, 10.0, spacing);
      hh -= (8.0 * c1 * smoothstep(60.0, 20.0, spacing) + 2.5 * c2) * fm; // depth only up close, the line always
      crack = max(c1, c2) * fm;
    }
    // canyons / rilles / grabens
    for (int i = 0; i < 4; i++) {
      float along = dot(dir, uArcC[i].xyz);
      if (along <= uArcC[i].w) continue;
      float cl = uArcC[i].w;
      float endf = smoothstep(cl, cl + (1.0 - cl) * 0.15, along);
      float W = uArcN[i].w;
      float sd = dot(dir, uArcN[i].xyz) * uR + uArcM[i] * sin(dot(dir, uArcT[i].xyz) * uR / 520.0);
      float ad = abs(sd);
      if (ad > W * 2.0) continue;
      // walls get wider where the grid is coarse (no sawtooth); close up they match the flight model
      float wall = max(W * 0.45, spacing * 3.0);
      float trough = 1.0 - smoothstep(W - wall, W, ad);
      float ee = (ad - W) / max(W * 0.35, spacing * 2.0);
      hh += uArcT[i].w * (-trough + 0.12 * exp(-ee * ee)) * endf;
      canyon = max(canyon, trough * endf);
    }
    // shield volcano
    if (uVol.w > 0.0) {
      float dv = length(dir - uVol.xyz) * uR;
      if (dv < uVol.w) {
        float s = 1.0 - dv / uVol.w;
        hh += uVolP.x * s * s * (3.0 - 2.0 * s) - uVolP.z * (1.0 - smoothstep(min(uVolP.y * 0.7, uVolP.y - spacing * 3.0), uVolP.y, dv));
        volc = s;
      }
    }
    // hero crater with rays (the rays are colour only)
    if (uHero.w > 0.0) {
      float th = length(dir - uHero.xyz) * uR / uHero.w;
      if (th < 1.8) {
        float bowl = th < 1.0 ? th * th - 1.0 : 0.0;
        float ee = (th - 1.0) / max(0.22, spacing * 2.0 / uHero.w);
        hh += uHeroD * (bowl + 0.35 * exp(-ee * ee) + 0.45 * exp(-(th / 0.16) * (th / 0.16)));
        shade += bowl * 0.4 + exp(-ee * ee) * 0.6;
      }
      if (th < 9.0) {
        vec3 r = normalize(cross(uHero.xyz, dir) + 1e-6);
        float ang = atan(dot(r, normalize(cross(uHero.xyz, vec3(0.0, 0.0, 1.0)))), dot(r, normalize(cross(cross(uHero.xyz, vec3(0.0, 0.0, 1.0)), uHero.xyz))));
        float stripe = vn(vec3(ang * 5.0, th * 0.35, 7.0));
        float soft = clamp(spacing / 300.0, 0.0, 0.25); // softer ray edges where the grid is coarse
        rays = smoothstep(0.62 - soft, 0.85 + soft * 0.5, stripe) * smoothstep(9.0, 2.0, th) * smoothstep(0.8, 1.4, th) * (1.0 - soft * 2.0);
      }
    }
  }
  float h = zone + hh * w;
  col = vec3(1.0);
  if (!wantCol) return h;
  // colour
  vec3 zc = mix(uC1, uC2, clamp(zone / 22.0 + 0.25 * sin(xz.x * 0.09) * sin(xz.y * 0.07), 0.0, 1.0));
  float big = vn(p / 4200.0 + vec3(3.0, 1.0, 0.0));
  float fine = vn(p / 260.0 + vec3(11.0, 0.0, 0.0)) * smoothstep(80.0, 20.0, spacing);
  vec3 gc;
  if (uStyle < 0.5) {
    // Luna: dark maria in the lowlands, bright highlands and mountains, bright fresh ejecta
    float mare = smoothstep(0.42, 0.58, big) * (1.0 - mnt);
    gc = mix(uC1 * 1.18, uC2 * 0.5, mare);
    gc *= 1.0 + mnt * 0.35 + rays * 0.55;
  } else if (uStyle < 1.5) {
    // Mars: dark basalt plains vs bright dust, dark canyon floors, darker volcano with dusty flanks
    float basalt = smoothstep(0.45, 0.62, big);
    gc = mix(uC1 * 1.12 + vec3(0.05, 0.03, 0.0), uC2 * 0.62, basalt);
    gc = mix(gc, uC2 * 0.45 + vec3(0.04, 0.0, 0.0), canyon * 0.7);
    gc = mix(gc, uC2 * 0.55, volc * 0.5);
    gc *= 1.0 + mnt * 0.25;
  } else if (uStyle < 2.5) {
    // Terra: meadows and darker forests, dry brown uplands, grey rock and snow on the high ranges,
    // rivers in the valley floors
    float forest = smoothstep(0.5, 0.62, vn(p / 1700.0 + vec3(2.0, 9.0, 0.0)));
    float dry = smoothstep(0.55, 0.7, big);
    gc = mix(uC1 * 1.05, uC1 * vec3(0.55, 0.7, 0.55), forest);
    gc = mix(gc, uC2 * 1.1, dry * 0.8);
    float rock = smoothstep(0.2, 0.5, mnt);
    gc = mix(gc, vec3(0.45, 0.42, 0.38), rock);
    gc = mix(gc, vec3(0.93, 0.95, 0.98), smoothstep(0.66, 0.76, mnt)); // snow only on the peaks
    gc = mix(gc, vec3(0.16, 0.33, 0.48), smoothstep(0.55, 0.85, canyon));
    gc = mix(gc, uC1 * 0.75, smoothstep(0.1, 0.55, canyon) * (1.0 - smoothstep(0.55, 0.85, canyon)));
  } else {
    // Brontes: teal plains, dark basalt fields, ochre sulphur deposits, darker rift floor and volcano
    float basalt = smoothstep(0.46, 0.6, big);
    float sft = clamp(spacing / 500.0, 0.0, 0.12); // softer edges where the grid is coarse (no blocks)
    float sulphur = smoothstep(0.7 - sft, 0.78 + sft, vn(p / 1500.0 + vec3(13.0, 4.0, 0.0))) * (1.0 - sft * 2.5);
    gc = mix(uC1 * 1.45, uC2 * 0.85, basalt);
    gc = mix(gc, vec3(0.78, 0.64, 0.2), sulphur * 0.85);
    gc = mix(gc, uC2 * 0.4, canyon * 0.75);
    gc = mix(gc, vec3(0.16, 0.17, 0.2), volc * 0.6);
    gc *= 1.0 + mnt * 0.3;
  }
  gc *= 0.93 + fine * 0.14;
  gc *= 1.0 + clamp(shade, -0.6, 0.5) * 0.45;
  gc *= 1.0 - crack * 0.45 - canyon * 0.15;
  // landing zone: the planet's own colours, only shaded a little by its relief (no patchwork)
  col = gc * (w + (1.0 - w) * (1.06 - 0.2 * clamp(zone / 25.0, 0.0, 1.0)));
  return h;
}
`;

// ---- rendering: CDLOD on a cube sphere, one instanced draw call ----
// Every tile is the same N x N grid; per instance: cube face, corner (u, v), size in face units and size in
// metres. Tiles are fixed to the moon (nothing swims). A tile is split when the camera comes within
// K/2 tile sizes; inside a tile, odd grid vertices slide onto their even neighbours as the camera
// distance approaches K tile sizes (geomorphing), so at a split the new tile starts out exactly as
// coarse as its parent and refines smoothly.
const N = 8;           // grid cells per tile
const K = 5;           // LOD range = K * tile size
const MAX_TILES = 1500;
const MIN_TILE = 16;   // metres: finest tile (2 m cells)

// cube face f, face coords (u, v) in [-1, 1] -> point on the cube; +Y (f = 2) is centred on the pad
function facePoint(f, u, v, out) {
  // orientations chosen so (du x dv) points inwards on every face: triangles wind outwards
  switch (f) {
    case 0: return out.set(1, v, u);
    case 1: return out.set(-1, v, -u);
    case 2: return out.set(u, 1, v);
    case 3: return out.set(u, -1, -v);
    case 4: return out.set(-u, v, 1);
    default: return out.set(u, v, -1);
  }
}
const FACE_GLSL = /* glsl */ `
vec3 facePoint(float f, vec2 uv) {
  if (f < 0.5) return vec3(1.0, uv.y, uv.x);
  if (f < 1.5) return vec3(-1.0, uv.y, -uv.x);
  if (f < 2.5) return vec3(uv.x, 1.0, uv.y);
  if (f < 3.5) return vec3(uv.x, -1.0, -uv.y);
  if (f < 4.5) return vec3(-uv.x, uv.y, 1.0);
  return vec3(uv.x, uv.y, -1.0);
}`;

/** tileable detail texture: lots of small craters plus grain, as a normal map (rg) and albedo (b).
 *  Sampled per pixel on the sphere (triplanar) at two scales, so the ground stays crisp between grid points. */
function makeDetailTexture(THREE) {
  const S = 512, hgt = new Float32Array(S * S);
  let seed = 12345;
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296;
  // grain: tileable value noise at a few periods
  for (const [P, amp] of [[8, 0.22], [32, 0.1], [64, 0.05]]) {
    const lat = new Float32Array(P * P).map(() => rnd());
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fx = (x / S) * P, fy = (y / S) * P, ix = Math.floor(fx), iy = Math.floor(fy);
      const ux = fx - ix, uy = fy - iy, sx = ux * ux * (3 - 2 * ux), sy = uy * uy * (3 - 2 * uy);
      const v = (i, j) => lat[((iy + j) % P) * P + ((ix + i) % P)];
      hgt[y * S + x] += amp * ((v(0, 0) * (1 - sx) + v(1, 0) * sx) * (1 - sy) + (v(0, 1) * (1 - sx) + v(1, 1) * sx) * sy);
    }
  }
  // craters, many small and few large (power law), wrapped around the tile edges
  const alb = new Float32Array(S * S);
  for (let n = 0; n < 900; n++) {
    const r = 2 + 46 * Math.pow(rnd(), 3.2), cx = rnd() * S, cy = rnd() * S, depth = r * (0.18 + rnd() * 0.12), fresh = rnd();
    const R2 = Math.ceil(r * 2);
    for (let dy = -R2; dy <= R2; dy++) for (let dx = -R2; dx <= R2; dx++) {
      const tt = Math.hypot(dx, dy) / r;
      if (tt > 2) continue;
      const x = ((Math.floor(cx) + dx) % S + S) % S, y = ((Math.floor(cy) + dy) % S + S) % S;
      const bowl = tt < 1 ? Math.max(tt * tt - 1, -0.8) : 0, e = (tt - 1) / 0.22;
      const ej = tt > 1 ? 0.2 * Math.exp(-(tt - 1) * 3) * (2 - tt) : 0;
      hgt[y * S + x] += depth * 0.05 * (bowl + 0.35 * Math.exp(-e * e) + ej);
      if (fresh > 0.8) alb[y * S + x] += (tt < 1.6 ? 0.25 : 0) * (1 - tt / 1.6); // fresh craters are brighter
    }
  }
  const data = new Uint8Array(S * S * 4);
  let mn = Infinity, mxh = -Infinity;
  for (const v of hgt) { mn = Math.min(mn, v); mxh = Math.max(mxh, v); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const H = (i, j) => hgt[((y + j + S) % S) * S + ((x + i + S) % S)];
    const gx = (H(1, 0) - H(-1, 0)) * 3, gy = (H(0, 1) - H(0, -1)) * 3;
    const l = Math.hypot(gx, gy, 1);
    const k = (y * S + x) * 4;
    data[k] = Math.round((-gx / l * 0.5 + 0.5) * 255);
    data[k + 1] = Math.round((-gy / l * 0.5 + 0.5) * 255);
    data[k + 2] = Math.round(Math.min(1, Math.max(0, (hgt[y * S + x] - mn) / (mxh - mn) * 0.8 + 0.1 + alb[y * S + x])) * 255);
    data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
let detailTex = null;

export function createMoonTerrain(THREE, R, edge, c1, c2, id) {
  const F = moonFeatures(id, R);
  // shared tile grid
  const grid = [], idx = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) grid.push(i, j);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx.push(a, c, b, b, c, d); // same diagonal everywhere, so a fully morphed tile equals its parent
  }
  const geo = new THREE.InstancedBufferGeometry();
  const nv = (N + 1) * (N + 1);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(nv * 3), 3));
  // normals only feed three's shadow normal-bias (flat shading derives the real ones); must not be zero
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(nv * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute('grid', new THREE.Float32BufferAttribute(grid, 2));
  geo.setIndex(idx);
  const tileA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TILES * 4), 4); // face, u0, v0, size (face units)
  const metreA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TILES), 1);    // tile size in metres
  tileA.setUsage(THREE.DynamicDrawUsage); metreA.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('tile', tileA);
  geo.setAttribute('tileM', metreA);
  geo.instanceCount = 0;

  const uniforms = {
    uCam: { value: new THREE.Vector3() }, uR: { value: R }, uEdge: { value: edge }, uSite: { value: 0 },
    uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) },
    uStyle: { value: F.style }, uMount: { value: F.mount }, uCraterK: { value: F.craterK },
    uArcN: { value: [0, 1, 2, 3].map((i) => F.arcs[i] ? new THREE.Vector4(...F.arcs[i].n, F.arcs[i].W) : new THREE.Vector4(0, 1, 0, 1)) },
    uArcC: { value: [0, 1, 2, 3].map((i) => F.arcs[i] ? new THREE.Vector4(...F.arcs[i].c, F.arcs[i].cosL) : new THREE.Vector4(0, 1, 0, 2)) },
    uArcT: { value: [0, 1, 2, 3].map((i) => F.arcs[i] ? new THREE.Vector4(...F.arcs[i].t, F.arcs[i].D) : new THREE.Vector4(1, 0, 0, 0)) },
    uArcM: { value: [0, 1, 2, 3].map((i) => F.arcs[i]?.M ?? 0) },
    uVol: { value: F.vol ? new THREE.Vector4(...F.vol.d, F.vol.r) : new THREE.Vector4() },
    uVolP: { value: F.vol ? new THREE.Vector4(F.vol.h, F.vol.cr, F.vol.cd, 0) : new THREE.Vector4() },
    uHero: { value: F.hero ? new THREE.Vector4(...F.hero.d, F.hero.r) : new THREE.Vector4() },
    uHeroD: { value: F.hero?.depth ?? 0 },
    uDetail: { value: (detailTex ??= makeDetailTexture(THREE)) },
    uNV: { value: new THREE.Matrix3() }, // planet frame -> view space (for the per-pixel normal)
    uDetailK: { value: [1.0, 0.8, 0.35, 0.6][F.style] ?? 1.0 },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec3 uCam;
varying vec3 vPP;
varying vec3 vPN;
attribute vec2 grid;
attribute vec4 tile;
attribute float tileM;
${MOON_GLSL}
${FACE_GLSL}`)
      .replace('#include <beginnormal_vertex>', `
        // geomorph: odd grid vertices slide onto their even neighbours towards the far end of this LOD
        vec2 uv0 = tile.yz + grid / ${N}.0 * tile.w;
        vec3 p0 = normalize(facePoint(tile.x, uv0)) * uR;
        float range = ${K}.0 * tileM;
        float km = clamp((distance(uCam, p0) - 0.7 * range) / (0.3 * range), 0.0, 1.0);
        vec2 g = grid - fract(grid * 0.5) * 2.0 * km;
        vec3 dir = normalize(facePoint(tile.x, tile.yz + g / ${N}.0 * tile.w));
        // crater detail follows the camera distance (continuous across tiles of different size)
        float spacing = distance(uCam, dir * uR) / (${K}.0 * ${N}.0) * 1.4;
        vec3 mcol, ncol;
        float mh = moonHeight(dir, spacing, true, mcol);
        vMoonCol = mcol;
        vec3 moonPos = dir * (uR + mh);
        // smooth normal from two neighbouring height samples (about one grid cell away)
        vec3 t1 = normalize(cross(dir, abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 t2 = cross(dir, t1);
        float eps = max(spacing, 1.5) / uR;
        vec3 d1 = normalize(dir + t1 * eps), d2 = normalize(dir + t2 * eps);
        vec3 q1 = d1 * (uR + moonHeight(d1, spacing, false, ncol));
        vec3 q2 = d2 * (uR + moonHeight(d2, spacing, false, ncol));
        vec3 objectNormal = normalize(cross(q1 - moonPos, q2 - moonPos));
        if (dot(objectNormal, dir) < 0.0) objectNormal = -objectNormal;
        vPP = moonPos; vPN = objectNormal;`)
      .replace('#include <begin_vertex>', `vec3 transformed = moonPos - vec3(0.0, uR, 0.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vMoonCol;
varying vec3 vPP;
varying vec3 vPN;
uniform sampler2D uDetail;
uniform mat3 uNV;
uniform float uDetailK;
// triplanar detail at one scale: returns the normal perturbation (planet frame) and albedo offset in .w
vec4 detailAt(float scale, vec3 N, vec3 w, vec3 sg) {
  vec4 tx = texture2D(uDetail, vec2(vPP.z * sg.x, vPP.y) / scale);
  vec4 ty = texture2D(uDetail, vec2(vPP.x * sg.y, vPP.z) / scale);
  vec4 tz = texture2D(uDetail, vec2(vPP.x * sg.z, vPP.y) / scale);
  vec2 nx = tx.xy * 2.0 - 1.0, ny = ty.xy * 2.0 - 1.0, nz = tz.xy * 2.0 - 1.0;
  vec3 pert = w.x * vec3(0.0, nx.y * sg.x, nx.x) + w.y * vec3(ny.x, 0.0, ny.y * sg.y) + w.z * vec3(nz.x, nz.y * sg.z, 0.0);
  return vec4(pert, dot(vec3(tx.b, ty.b, tz.b), w) - 0.5);
}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vMoonCol;')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  {
    // per-pixel detail: small craters and grain at two scales, fading out with distance (no shimmer)
    vec3 N = normalize(vPN);
    vec3 w = pow(abs(N), vec3(4.0)); w /= dot(w, vec3(1.0));
    vec3 sg = sign(N + 1e-6);
    float dist = length(vViewPosition);
    float f1 = smoothstep(900.0, 120.0, dist), f2 = smoothstep(16000.0, 1500.0, dist) * (0.55 + 0.45 * smoothstep(150.0, 1200.0, dist)), f3 = smoothstep(80000.0, 5000.0, dist);
    vec4 d1 = f1 > 0.0 ? detailAt(38.0, N, w, sg) : vec4(0.0);
    vec4 d2 = detailAt(330.0, N, w, sg);
    vec4 d3 = detailAt(2700.0, N, w, sg);
    vec3 np = normalize(N + (d1.xyz * f1 * 0.7 + d2.xyz * f2 * 0.7 + d3.xyz * f3 * 0.6) * uDetailK);
    normal = normalize(uNV * np);
    diffuseColor.rgb *= 1.0 + (d1.w * f1 * 0.8 + d2.w * f2 + d3.w * f3 * 0.8) * 0.55;
  }`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  const _m4 = new THREE.Matrix4();
  mesh.onBeforeRender = (r, sc, camera) => {
    uniforms.uNV.value.setFromMatrix4(_m4.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld));
  };

  // backing sphere just below the deepest crater: hides hairline gaps at cube seams while tiles morph
  const back = new THREE.Mesh(new THREE.IcosahedronGeometry(R - 45, 5).translate(0, -R, 0),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(c1).lerp(new THREE.Color(c2), 0.5), roughness: 1 }));
  const group = new THREE.Group();
  group.add(back, mesh);

  // quadtree selection, per frame, on the CPU (a few hundred nodes)
  const ARC = (Math.PI / 2) * R; // face width in metres (at the face centre)
  const cam = new THREE.Vector3(), c = new THREE.Vector3();
  let n = 0, horizon = 0, camLen = 0;
  function visit(f, u0, v0, size, metres) {
    facePoint(f, u0 + size / 2, v0 + size / 2, c).normalize();
    const rad = metres * 0.75;
    // horizon cull: the tile's nearest point lies beyond the horizon (plus room for hills)
    const ang = Math.acos(Math.max(-1, Math.min(1, c.dot(cam) / camLen))) - rad / R;
    if (ang > horizon) return;
    c.multiplyScalar(R);
    const dist = Math.max(0, c.distanceTo(cam) - rad);
    if (metres > MIN_TILE && dist < (K * metres) / 2) {
      const h = size / 2, m = metres / 2;
      visit(f, u0, v0, h, m); visit(f, u0 + h, v0, h, m); visit(f, u0, v0 + h, h, m); visit(f, u0 + h, v0 + h, h, m);
      return;
    }
    if (n >= MAX_TILES) return;
    tileA.setXYZW(n, f, u0, v0, size); metreA.setX(n, metres); n++;
  }
  /** camPlanet: camera position relative to the moon's centre, in the moon's frame */
  function update(camPlanet) {
    cam.copy(camPlanet); camLen = Math.max(R + 1, cam.length());
    uniforms.uCam.value.copy(cam);
    horizon = Math.acos(R / camLen) + Math.acos(R / (R + 60)) + 0.02;
    n = 0;
    for (let f = 0; f < 6; f++) visit(f, -1, -1, 2, ARC);
    geo.instanceCount = n;
    tileA.needsUpdate = true; metreA.needsUpdate = true;
  }
  return { mesh: group, update, tiles: () => n, setSite: (i) => { uniforms.uSite.value = i; } };
}
