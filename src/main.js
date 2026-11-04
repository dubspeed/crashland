import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------- Rendering ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec5ff);
scene.fog = new THREE.Fog(0x8ec5ff, 30, 70);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(13, 5, 15);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, -0.5, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.6;

scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(8, 16, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
scene.add(sun);

// ---------- Physics ----------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
const mat = new CANNON.Material('default');
world.defaultContactMaterial = new CANNON.ContactMaterial(mat, mat, { friction: 0.4, restitution: 0.45 });

// ---------- Assets ----------
const loader = new GLTFLoader();
// Models are bundled as base64 data URLs (vite assetsInlineLimit) so the build is a single JS file.
const urls = import.meta.glob('./assets/*.glb', { query: '?url', import: 'default', eager: true });
const load = async (n) => {
  const url = urls[`./assets/${n}.glb`];
  const buf = url.startsWith('data:')
    ? Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer
    : await (await fetch(url)).arrayBuffer();
  const g = await loader.parseAsync(buf, '');
  g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g.scene;
};
const [plate, ball, rock, crate] = await Promise.all(['plate', 'ball', 'rock', 'crate'].map(load));

scene.add(plate);
// Plate collider: 8-sided cylinder, radius 6, height 0.6 (matches the Blender mesh)
const plateBody = new CANNON.Body({ mass: 0, material: mat });
const plateShape = new CANNON.Cylinder(6, 6, 0.6, 8);
plateBody.addShape(plateShape, new CANNON.Vec3(), new CANNON.Quaternion().setFromEuler(0, Math.PI / 8, 0));
world.addBody(plateBody);

const kinds = [
  { model: ball, shape: () => new CANNON.Sphere(0.5), mass: 1 },
  { model: rock, shape: () => new CANNON.Sphere(0.48), mass: 2 },
  { model: crate, shape: () => new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)), mass: 1.5 },
];

const objects = [];
const countEl = document.getElementById('count');

function spawn(pos = new THREE.Vector3((Math.random() - 0.5) * 8, 12 + Math.random() * 4, (Math.random() - 0.5) * 8)) {
  const k = kinds[Math.random() < 0.55 ? 0 : Math.random() < 0.5 ? 1 : 2];
  const s = 0.6 + Math.random() * 0.8;
  const mesh = k.model.clone();
  mesh.scale.setScalar(s);
  scene.add(mesh);
  const shape = k.shape();
  if (shape instanceof CANNON.Sphere) shape.radius *= s, shape.updateBoundingSphereRadius();
  else shape.halfExtents.scale(s, shape.halfExtents), shape.updateConvexPolyhedronRepresentation(), shape.updateBoundingSphereRadius();
  const body = new CANNON.Body({ mass: k.mass * s * s * s, material: mat, shape, linearDamping: 0.05, angularDamping: 0.1 });
  body.position.copy(pos);
  body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  body.angularVelocity.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
  world.addBody(body);
  objects.push({ mesh, body });
}

function remove(o) { scene.remove(o.mesh); world.removeBody(o.body); }
function reset() { objects.splice(0).forEach(remove); }

// ---------- Input ----------
let raining = true;
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return; // was a drag
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(plate, true)[0];
  const p = hit ? hit.point : ray.ray.at(20, new THREE.Vector3());
  for (let i = 0; i < 5; i++) spawn(new THREE.Vector3(p.x + (Math.random() - 0.5), 10 + i * 1.3, p.z + (Math.random() - 0.5)));
});
const rainBtn = document.getElementById('btn-rain');
function toggleRain() { raining = !raining; rainBtn.textContent = `Regen: ${raining ? 'an' : 'aus'}`; }
rainBtn.addEventListener('click', toggleRain);
document.getElementById('btn-reset').addEventListener('click', reset);
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); toggleRain(); }
  if (e.code === 'KeyR') reset();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Loop ----------
const timer = new THREE.Timer();
let rainTimer = 0;
for (let i = 0; i < 12; i++) spawn();

renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 1 / 20);
  rainTimer += dt;
  if (raining && rainTimer > 0.35 && objects.length < 150) { rainTimer = 0; spawn(); }
  world.step(1 / 60, dt, 4);
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    o.mesh.position.copy(o.body.position);
    o.mesh.quaternion.copy(o.body.quaternion);
    if (o.body.position.y < -25) { remove(o); objects.splice(i, 1); }
  }
  countEl.textContent = `${objects.length} Objekte`;
  controls.update();
  renderer.render(scene, camera);
});

window.__crashland = { objects, spawn, reset };
