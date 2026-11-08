// Cargo and base modules (prototype): simple procedural models in the lander's low-poly look.
// cargoModel(type) is centred on its own height (it rides on the frame where the capsule sits);
// deployed = true gives the version that stands in the base (panels unfolded, beacon blinking).
import * as THREE from 'three';
import { CARGO } from './sim.js';

const M = {};
const mat = (key, color, o = {}) => (M[key] ??= new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, flatShading: true, ...o }));
const hull = () => mat('hull', 0xdcdee6), dark = () => mat('dark', 0x202227), orange = () => mat('orange', 0xf27320),
  metal = () => mat('metal', 0x6b7079, { metalness: 0.6, roughness: 0.4 }), foil = () => mat('foil', 0xd9a633, { metalness: 0.8, roughness: 0.35 }),
  cells = () => mat('cells', 0x14245f, { metalness: 0.5, roughness: 0.25 }),
  lamp = () => mat('lamp', 0xff3b2f, { emissive: 0xff2a1a, emissiveIntensity: 2 });

function add(g, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
  o.castShadow = true; o.receiveShadow = true;
  g.add(o);
  return o;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r1, r2, h, n = 10) => new THREE.CylinderGeometry(r1, r2, h, n);

const BUILD = {
  beacon(g, h) {
    add(g, box(0.9, 0.5, 0.9), dark(), 0, -h / 2 + 0.25);
    add(g, box(0.7, 0.12, 0.7), orange(), 0, -h / 2 + 0.56);
    add(g, cyl(0.06, 0.06, h - 0.8, 6), metal(), 0, 0.15);
    add(g, new THREE.SphereGeometry(0.16, 10, 8), lamp(), 0, h / 2 - 0.12);
    add(g, new THREE.ConeGeometry(0.32, 0.18, 10, 1, true), metal(), 0.0, h / 2 - 0.55, 0, Math.PI, 0, 0);
  },
  solar(g, h, deployed) {
    add(g, box(1.6, 0.35, 1.2), dark(), 0, -h / 2 + 0.18);
    if (!deployed) { // folded stack
      for (let i = 0; i < 4; i++) add(g, box(2.0, 0.1, 1.4), i % 2 ? cells() : metal(), 0, -h / 2 + 0.42 + i * 0.13);
      return;
    }
    add(g, cyl(0.06, 0.06, 1.0, 6), metal(), 0, 0.1);
    for (const s of [-1, 1]) add(g, box(2.6, 0.06, 1.4), cells(), s * 1.45, 0.6, 0, 0, 0, s * -0.12);
  },
  depot(g, h) {
    add(g, new THREE.SphereGeometry(0.95, 14, 10), hull(), 0, h / 2 - 0.95);
    add(g, cyl(0.97, 0.97, 0.22, 14), orange(), 0, h / 2 - 0.95);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      add(g, cyl(0.05, 0.05, 1.0, 5), metal(), Math.cos(a) * 0.75, -h / 2 + 0.4, Math.sin(a) * 0.75, Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
    }
  },
  lab(g, h) {
    add(g, box(2.4, h - 0.3, 1.7), hull(), 0, -0.15);
    add(g, box(2.45, 0.3, 1.75), foil(), 0, -h / 2 + 0.15);
    add(g, box(1.6, 0.18, 0.05), mat('glass', 0x1d4a7a, { emissive: 0x2a6fb5, emissiveIntensity: 0.6 }), 0, 0.1, 0.86);
    add(g, cyl(0.04, 0.04, 0.5, 5), metal(), 0.8, h / 2 - 0.05);
    add(g, new THREE.ConeGeometry(0.35, 0.15, 12, 1, true), metal(), 0.8, h / 2 + 0.2, 0, Math.PI * 0.85, 0, 0);
  },
  rover(g, h) {
    const y0 = -h / 2;
    add(g, box(2.2, 0.4, 1.2), hull(), 0, y0 + 0.65);
    add(g, box(1.4, 0.3, 0.9), foil(), -0.2, y0 + 1.0);
    for (const x of [-0.8, 0, 0.8]) for (const z of [-0.72, 0.72]) add(g, cyl(0.3, 0.3, 0.22, 10), dark(), x, y0 + 0.3, z, Math.PI / 2, 0, 0);
    add(g, cyl(0.04, 0.04, 0.4, 5), metal(), 0.8, y0 + 1.05);
    add(g, box(0.3, 0.15, 0.2), dark(), 0.8, y0 + 1.3);
  },
  refinery(g, h) {
    add(g, cyl(0.9, 0.9, h - 0.8, 12), hull(), -0.2, -0.4);
    add(g, cyl(0.92, 0.92, 0.2, 12), orange(), -0.2, -0.2);
    add(g, cyl(0.25, 0.35, 0.8, 8), metal(), 0.75, h / 2 - 0.55);
    add(g, cyl(0.12, 0.12, h - 0.6, 6), metal(), 0.75, -0.3);
    add(g, box(0.9, 0.4, 0.4), dark(), 0.4, -h / 2 + 0.2, 0.7);
  },
  rocket(g, h) {
    const body = h - 1.2;
    add(g, cyl(0.55, 0.55, body, 12), hull(), 0, -h / 2 + body / 2);
    add(g, new THREE.ConeGeometry(0.55, 1.2, 12), hull(), 0, h / 2 - 0.6);
    add(g, cyl(0.57, 0.57, 0.3, 12), orange(), 0, -h / 2 + body * 0.7);
    add(g, cyl(0.38, 0.5, 0.35, 10), dark(), 0, -h / 2 + 0.17);
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      add(g, box(0.06, 0.8, 0.6), dark(), Math.cos(a) * 0.65, -h / 2 + 0.45, Math.sin(a) * 0.65, 0, -a, 0);
    }
  },
  crew(g) { // the habitat dome the crew sets up (only stands in the base)
    add(g, new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hull(), 0, -1.1);
    add(g, cyl(2.25, 2.25, 0.25, 16), orange(), 0, -1.0);
    add(g, box(1.0, 1.2, 1.2), metal(), 2.2, -0.5, 0);
    add(g, new THREE.SphereGeometry(0.12, 8, 6), lamp(), 0, 1.15, 0);
  },
};

/** a cargo / module model; its origin is the centre of its height (h) */
export function cargoModel(type, deployed = false) {
  const g = new THREE.Group();
  const h = CARGO[type]?.h ?? 2.2;
  (BUILD[type] ?? BUILD.beacon)(g, h, deployed);
  g.userData.h = h;
  return g;
}
