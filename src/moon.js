// Orbit level moon: procedural relief (craters + hills) shared by the flight model (JS) and the
// renderer (GLSL), and a single-draw-call terrain mesh: a polar grid that rides under the lander
// (fine near it, coarse towards the far side), displaced on the GPU. Only used when a planet has R.

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

// crater octaves: cell size (m), share of cells with a crater, depth factor
export const OCTAVES = [[1800, 0.7, 0.1], [500, 0.6, 0.15], [140, 0.55, 0.2]];

// one octave of craters at point p (metres on the sphere): 2x2x2 nearest cells are enough because a
// crater's influence (centre jitter + 1.6 radii) stays within 0.6 cells of its cell centre
function craters(px, py, pz, C, prob, dk, out) {
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
    const t = Math.hypot(px - qx, py - qy, pz - qz) / rc;
    if (t > 1.6) continue;
    const bowl = t < 1 ? t * t - 1 : 0, e = (t - 1) / 0.25, rim = Math.exp(-e * e);
    out.h += rc * (dk * bowl + dk * 0.3 * rim);
    out.s += bowl * 0.6 + rim * 0.4;
  }
}

/** relief outside the landing zone at flat coords (x, z = arc length from the pad), faded in past `edge` */
export function moonRelief(x, z, R, edge) {
  const d = Math.hypot(x, z);
  const w = smooth(edge - 300, edge + 200, d);
  if (w <= 0) return 0;
  const phi = d / R, sn = d > 1e-6 ? Math.sin(phi) / d : 0;
  const dx = x * sn, dy = Math.cos(phi), dz = z * sn;
  const hills = 18 * Math.sin(dx * 9 + 1.3) * Math.sin(dz * 7 + 0.4) + 9 * Math.sin(dy * 21 + dx * 13);
  const out = { h: hills, s: 0 };
  for (const [C, prob, dk] of OCTAVES) craters(dx * R, dy * R, dz * R, C, prob, dk, out);
  return out.h * w;
}

// ---- GLSL twin of the functions above + the landing-zone relief from sim.js ----
export const MOON_GLSL = /* glsl */ `
uniform mat3 uFrame;
uniform float uR;
uniform float uEdge;
uniform vec3 uC1;
uniform vec3 uC2;
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
void moonCraters(vec3 p, float C, float prob, float dk, inout vec2 acc) {
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
    float t = length(p - q) / rc;
    if (t > 1.6) continue;
    float bowl = t < 1.0 ? t * t - 1.0 : 0.0;
    float e = (t - 1.0) / 0.25;
    float rim = exp(-e * e);
    acc.x += rc * (dk * bowl + dk * 0.3 * rim);
    acc.y += bowl * 0.6 + rim * 0.4;
  }
}
float zoneNoise(float x, float z) {
  return sin(x * 0.021 + 1.3) * cos(z * 0.017) * 14.0 + sin(x * 0.067 + z * 0.041) * 5.0 + sin(x * 0.13 - z * 0.11 + 2.1) * 2.0;
}
// returns height; writes the colour of the ground there
float moonHeight(vec3 dir, float gridDist, out vec3 col) {
  float d = uR * atan(length(dir.xz), dir.y);
  vec2 xz = length(dir.xz) > 1e-7 ? normalize(dir.xz) * d : vec2(0.0);
  // landing zone relief (same as sim.js terrainHeight), fading out towards the edge
  float t = clamp((d - 70.0) / 60.0, 0.0, 1.0);
  float blend = t * t * (3.0 - 2.0 * t);
  float e = clamp((d - (uEdge - 250.0)) / 250.0, 0.0, 1.0);
  float zone = (zoneNoise(xz.x, xz.y) + 6.0) * blend * (1.0 - e * e * (3.0 - 2.0 * e));
  // craters + hills outside it
  float w = smoothstep(uEdge - 300.0, uEdge + 200.0, d);
  vec2 acc = vec2(18.0 * sin(dir.x * 9.0 + 1.3) * sin(dir.z * 7.0 + 0.4) + 9.0 * sin(dir.y * 21.0 + dir.x * 13.0), 0.0);
  if (w > 0.0) {
    // level of detail: each crater size fades out where the grid gets too coarse to draw it (no spikes);
    // near the lander every size is there, matching the flight model
    vec3 p = dir * uR;
    float spacing = max(3.0, gridDist * 0.045);
    float C[3] = float[3](1800.0, 500.0, 140.0);
    float P[3] = float[3](0.7, 0.6, 0.55);
    float K[3] = float[3](0.1, 0.15, 0.2);
    for (int o = 0; o < 3; o++) {
      float f = smoothstep(C[o] * 0.14, C[o] * 0.04, spacing);
      if (f <= 0.0) continue;
      vec2 a = vec2(0.0);
      moonCraters(p, C[o], P[o], K[o], a);
      acc += a * f;
    }
  }
  float h = zone + acc.x * w;
  // colour: zone like the flat levels; outside maria (dark lowlands) and bright crater rims
  vec3 zc = mix(uC1, uC2, clamp(zone / 22.0 + 0.25 * sin(xz.x * 0.09) * sin(xz.y * 0.07), 0.0, 1.0));
  float n = sin(dir.x * 5.1 + 0.7) * cos(dir.z * 4.3 - 0.4) + 0.6 * sin(dir.y * 7.7 + dir.x * 3.1) + 0.3 * sin(dir.z * 13.0 - dir.y * 9.0);
  float m = clamp((n - 0.15) * 2.2, 0.0, 1.0);
  vec3 gc = mix(uC1 * 1.2, uC2 * 0.62, m);
  gc *= 1.0 + clamp(acc.y, -0.6, 0.5) * 0.45;
  col = mix(zc, gc, w);
  return h;
}
`;

/** polar grid geometry around the origin (flat coords in x/z), indexed */
export function moonGridGeometry(THREE, R) {
  const radii = [0];
  while (radii.at(-1) < 120) radii.push(radii.at(-1) + 3);
  while (radii.at(-1) < Math.PI * R) radii.push(Math.min(Math.PI * R, radii.at(-1) * 1.045));
  const SEG = 128, pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let i = 1; i < radii.length; i++) for (let k = 0; k < SEG; k++) {
    const a = (k / SEG) * Math.PI * 2;
    pos.push(Math.cos(a) * radii[i], 0, Math.sin(a) * radii[i]);
  }
  const at = (i, k) => 1 + (i - 1) * SEG + (k % SEG);
  for (let k = 0; k < SEG; k++) idx.push(0, at(1, k + 1), at(1, k)); // centre fan
  for (let i = 1; i < radii.length - 1; i++) for (let k = 0; k < SEG; k++) {
    const a = at(i, k), b = at(i, k + 1), c = at(i + 1, k), d = at(i + 1, k + 1);
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  return geo;
}

/** terrain mesh: a MeshStandardMaterial whose vertex stage bends the grid onto the moon and displaces it */
export function createMoonTerrain(THREE, R, edge, c1, c2) {
  const uniforms = {
    uFrame: { value: new THREE.Matrix3() }, uR: { value: R }, uEdge: { value: edge },
    uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${MOON_GLSL}`)
      .replace('#include <begin_vertex>', `
        vec2 g = position.xz;
        float gd = length(g);
        vec3 dl = gd < 1e-4 ? vec3(0.0, 1.0, 0.0) : vec3(g.x / gd * sin(gd / uR), cos(gd / uR), g.y / gd * sin(gd / uR));
        vec3 dir = normalize(uFrame * dl);
        vec3 mcol;
        float mh = moonHeight(dir, gd, mcol);
        vMoonCol = mcol;
        vec3 transformed = dir * (uR + mh) - vec3(0.0, uR, 0.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMoonCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vMoonCol;');
  };
  const mesh = new THREE.Mesh(moonGridGeometry(THREE, R), mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  const q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  /** recentre the grid under the lander; snapped so the vertices don't swim while it moves */
  function center(x, z, alt) {
    const step = alt < 150 ? 4 : alt < 700 ? 16 : 64;
    const sx = Math.round(x / step) * step, sz = Math.round(z / step) * step;
    const d = Math.hypot(sx, sz);
    if (d < 1e-6) dir.set(0, 1, 0);
    else { const sn = Math.sin(d / R) / d; dir.set(sx * sn, Math.cos(d / R), sz * sn); }
    q.setFromUnitVectors(up, dir);
    uniforms.uFrame.value.setFromMatrix4(m4.makeRotationFromQuaternion(q));
  }
  return { mesh, center };
}
