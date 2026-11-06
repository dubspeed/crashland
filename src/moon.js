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
float moonHeight(vec3 dir, float spacing, out vec3 col) {
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
    // level of detail: each crater size fades out where the grid is too coarse to draw it (no spikes);
    // spacing depends only on the distance to the camera, so neighbouring tiles agree
    vec3 p = dir * uR;
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

export function createMoonTerrain(THREE, R, edge, c1, c2) {
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
    uCam: { value: new THREE.Vector3() }, uR: { value: R }, uEdge: { value: edge },
    uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec3 uCam;
attribute vec2 grid;
attribute vec4 tile;
attribute float tileM;
${MOON_GLSL}
${FACE_GLSL}`)
      .replace('#include <begin_vertex>', `
        // geomorph: odd grid vertices slide onto their even neighbours towards the far end of this LOD
        vec2 uv0 = tile.yz + grid / ${N}.0 * tile.w;
        vec3 p0 = normalize(facePoint(tile.x, uv0)) * uR;
        float range = ${K}.0 * tileM;
        float km = clamp((distance(uCam, p0) - 0.7 * range) / (0.3 * range), 0.0, 1.0);
        vec2 g = grid - fract(grid * 0.5) * 2.0 * km;
        vec3 dir = normalize(facePoint(tile.x, tile.yz + g / ${N}.0 * tile.w));
        // crater detail follows the camera distance (continuous across tiles of different size)
        float spacing = distance(uCam, dir * uR) / (${K}.0 * ${N}.0) * 1.4;
        vec3 mcol;
        float mh = moonHeight(dir, spacing, mcol);
        vMoonCol = mcol;
        vec3 transformed = dir * (uR + mh) - vec3(0.0, uR, 0.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMoonCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vMoonCol;');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;

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
  return { mesh: group, update, tiles: () => n };
}
