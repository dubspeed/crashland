import * as THREE from 'three';
import { COMPONENTS, massProps } from './sim.js';

function checkerTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ffd23f'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createShip(models) {
  const group = new THREE.Group();
  const parts = {};
  for (const c of COMPONENTS) {
    const o = models[c.model].clone(true);
    o.position.set(...c.pos);
    if (c.mirror) o.rotation.y = Math.PI;
    o.userData.component = c;
    // own material copies so we can tint them (e.g. dead computer)
    o.traverse((m) => { if (m.isMesh) m.material = m.material.clone(); });
    parts[c.id] = o;
    group.add(o);
  }

  // engine flame
  const flame = new THREE.Group();
  flame.position.set(0, 0.72, 0);
  const cone = (r, h, color, op) => {
    const g = new THREE.ConeGeometry(r, h, 10, 1, true).rotateX(Math.PI).translate(0, -h / 2, 0);
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  };
  const outer = cone(0.7, 5, 0xff7a1a, 0.55), inner = cone(0.42, 3, 0xfff1b0, 0.9);
  flame.add(outer, inner);
  const glow = new THREE.PointLight(0xff8a30, 0, 40, 1.5);
  glow.position.y = -1.5;
  flame.add(glow);
  group.add(flame);

  // centre-of-mass marker + thrust axis
  const com = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8),
    new THREE.MeshBasicMaterial({ map: checkerTexture(), depthTest: false, transparent: true }));
  com.renderOrder = 999;
  const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.7, 0), new THREE.Vector3(0, 6, 0)]),
    new THREE.LineDashedMaterial({ color: 0x9fe8ff, dashSize: 0.25, gapSize: 0.18, depthTest: false, transparent: true, opacity: 0.8 }));
  axis.computeLineDistances(); axis.renderOrder = 998;
  const helpers = new THREE.Group(); helpers.add(com, axis);
  group.add(helpers);

  const screenMats = [];
  parts.computer.traverse((m) => { if (m.isMesh && m.material.name === 'Screen') screenMats.push(m.material); });

  function reset() {
    for (const c of COMPONENTS) {
      const o = parts[c.id];
      if (o.parent !== group) group.add(o);
      o.position.set(...c.pos);
      o.rotation.set(0, c.mirror ? Math.PI : 0, 0);
      o.visible = true;
      o.scale.set(1, 1, 1);
    }
    group.userData.sink = 0;
    flame.visible = true;
    helpers.visible = true;
  }

  // hard landing: legs buckle, ship settles lower
  function damageLegs() {
    parts.legs.scale.set(1.15, 0.8, 1.15);
    group.userData.sink = 0.45;
  }

  function update(s, t) {
    group.position.set(s.x, s.y - (group.userData.sink || 0), 0);
    group.rotation.z = s.a;
    const thr = s.status === 'flying' ? s.throttle : 0;
    const flick = 0.9 + Math.random() * 0.2;
    flame.visible = thr > 0.01;
    flame.scale.set(0.6 + thr * 0.4, (0.25 + thr) * flick, 0.6 + thr * 0.4);
    glow.intensity = thr * 60 * flick;
    const { cx, cy } = massProps(s);
    com.position.set(cx, cy, 0);
    for (const m of screenMats) m.emissiveIntensity = s.powered ? 1 : 0;
  }

  return { group, parts, flame, helpers, reset, update, damageLegs };
}
