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

  // parachute: rig hangs from the capsule top; canopy model has its origin at the riser confluence
  const chuteRig = new THREE.Group();
  const canopy = models.parachute.clone(true);
  const canopyMats = [];
  canopy.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.side = THREE.DoubleSide; m.material.transparent = true; canopyMats.push(m.material); } });
  canopy.position.y = 0.2;
  chuteRig.add(canopy);
  group.add(chuteRig);
  let loose = null; // canopy flying off after cut/tear: { v, t, torn }

  // re-entry glow under the heat shield at high dynamic pressure
  const heat = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 6).scale(1, 0.45, 1),
    new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  heat.position.y = 0.4;
  group.add(heat);

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
    if (chuteRig.parent !== group) group.add(chuteRig);
    chuteRig.position.set(0, 5.72, 0); chuteRig.rotation.set(0, 0, 0); chuteRig.scale.set(1, 1, 1);
    chuteRig.visible = false; loose = null;
    flame.visible = true;
    helpers.visible = true;
  }

  // hard landing: legs buckle, ship settles lower
  function damageLegs() {
    parts.legs.scale.set(1.15, 0.8, 1.15);
    group.userData.sink = 0.45;
  }

  let lastT = 0;
  function update(s, t) {
    const dt = Math.min(0.05, Math.max(0, t - lastT)); lastT = t;
    group.position.set(s.x, s.y - (group.userData.sink || 0), 0);
    group.rotation.z = s.a;
    updateChute(s, t, dt);
    heat.material.opacity = s.status === 'flying' ? Math.min(0.4, Math.max(0, (s.q - 6000) / 10000)) * (0.85 + Math.random() * 0.3) : 0;
    const thr = s.status === 'flying' ? s.throttle : 0;
    const flick = 0.9 + Math.random() * 0.2;
    flame.visible = thr > 0.01;
    flame.scale.set(0.6 + thr * 0.4, (0.25 + thr) * flick, 0.6 + thr * 0.4);
    glow.intensity = thr * 60 * flick;
    const { cx, cy } = massProps(s);
    com.position.set(cx, cy, 0);
    for (const m of screenMats) m.emissiveIntensity = s.powered ? 1 : 0;
  }

  function updateChute(s, t, dt) {
    if (loose) {
      // detached canopy drifts away, slowly falling, collapsing if torn
      loose.t += dt;
      loose.v.y += (-4 - loose.v.y) * Math.min(1, dt * 1.5);
      loose.v.x *= 1 - dt * 0.8;
      chuteRig.position.addScaledVector(loose.v, dt);
      chuteRig.rotation.z += dt * (loose.torn ? 1.2 : 0.4);
      const k = Math.min(1, loose.t / 1.5);
      canopy.scale.set(1 - k * (loose.torn ? 0.8 : 0.5), 1, 1 - k * (loose.torn ? 0.8 : 0.5));
      if (loose.t > 10) chuteRig.visible = false;
      return;
    }
    if (s.chute === 'stowed') { chuteRig.visible = false; return; }
    if ((s.chute === 'cut' || s.chute === 'torn') && chuteRig.parent === group) {
      group.parent.attach(chuteRig);
      loose = { v: new THREE.Vector3(s.vx * 0.5, s.vy * 0.4 + 6, 0), t: 0, torn: s.chute === 'torn' };
      return;
    }
    if (s.status === 'crashed') { chuteRig.visible = false; return; }
    chuteRig.visible = true;
    for (const m of canopyMats) m.opacity = 1;
    const deploy = Math.min(1, s.chuteT / 0.5); // pulled out of the pack before it inflates
    const air = s.planet.rho > 0;
    let w = air ? 0.12 + 0.88 * s.chuteOpen : 0.06;
    let h = deploy * (air ? 1 : 0.55);
    let fade = 1;
    if (s.status === 'landed') {
      // canopy collapses and sinks away after touchdown
      const k = Math.min(1, (t - (chuteRig.userData.landT ??= t)) / 1.8);
      h *= 1 - k * 0.7; w *= 1 - k * 0.5; fade = 1 - k;
    } else chuteRig.userData.landT = undefined;
    for (const m of canopyMats) m.opacity = fade;
    chuteRig.visible = fade > 0.01;
    canopy.scale.set(w, h, w);
    // the canopy stays roughly vertical in the world while the lander swings below it
    chuteRig.rotation.z = -s.a * 0.85 + Math.sin(t * 1.3) * 0.04 + (air ? 0 : 0.6);
  }

  return { group, parts, flame, helpers, reset, update, damageLegs, chuteRig };
}
