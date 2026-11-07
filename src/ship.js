import * as THREE from 'three';
import { COMPONENTS, SHIELD, makeSpec, massProps } from './sim.js';

/** heat shield: a dark ablative cone ring around the nozzle (no Blender model needed) */
function shieldModel() {
  const prof = [[0.62, 0.16], [0.7, 0.18], [1.78, -0.02], [1.8, -0.1], [1.7, -0.12], [0.6, 0.06]].map(([r, y]) => new THREE.Vector2(r, y));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), new THREE.MeshStandardMaterial({ color: 0x3a2b22, roughness: 0.95, metalness: 0.05, flatShading: true }));
  mesh.castShadow = true;
  const g = new THREE.Group(); g.add(mesh);
  return g;
}

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
  for (const c of [...COMPONENTS, SHIELD]) {
    const o = c.model === 'shield' ? shieldModel() : models[c.model].clone(true);
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
  let canopyAlpha = 1, rigScale = 1;
  let looseChute = null; // canopy flying off after cut/tear: { v, t, torn }

  // heat: per-material base emissive so glowing can blend on top of it
  for (const o of Object.values(parts)) o.traverse((m) => {
    if (m.isMesh) m.material.userData.base = { color: m.material.emissive.clone(), i: m.material.emissiveIntensity };
  });
  const heatCol = new THREE.Color();
  function heatColor(k) { // dark red -> orange -> yellow-white
    return k < 0.5 ? heatCol.setRGB(0.55 + k * 0.9, 0.05 + k * 0.5, 0) : heatCol.setRGB(1, 0.3 + (k - 0.5) * 1.1, (k - 0.5) * 0.6);
  }

  // embers streaming off hot parts
  const EMB = 400;
  const embPos = new Float32Array(EMB * 3), embVel = new Float32Array(EMB * 3), embLife = new Float32Array(EMB);
  const dot = document.createElement('canvas'); dot.width = dot.height = 32;
  const dg = dot.getContext('2d');
  const rg = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, '#fff'); rg.addColorStop(0.45, 'rgba(255,255,255,0.9)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  dg.fillStyle = rg; dg.fillRect(0, 0, 32, 32);
  const embGeo = new THREE.BufferGeometry();
  embGeo.setAttribute('position', new THREE.BufferAttribute(embPos, 3));
  const embers = new THREE.Points(embGeo, new THREE.PointsMaterial({ color: 0xff8a20, size: 0.6, map: new THREE.CanvasTexture(dot), transparent: true, opacity: 0.95, depthWrite: false }));
  embers.frustumCulled = false;
  let embNext = 0, scene = null;
  const loose = []; // parts that blew off: { obj, v, w, t }
  const tmpV = new THREE.Vector3();

  const screenMats = [];
  parts.computer.traverse((m) => { if (m.isMesh && m.material.name === 'Screen') screenMats.push(m.material); });

  /** rebuild for a lander spec: parts that are not built in leave the group (so debris skips them),
   *  options change the size of engine, tanks, battery, legs and canopy */
  function reset(spec = makeSpec()) {
    const b = spec.build;
    for (const c of [...COMPONENTS, SHIELD]) {
      const o = parts[c.id];
      if (!spec.ids.has(c.id)) { o.parent?.remove(o); continue; }
      if (o.parent !== group) group.add(o);
      o.position.set(...c.pos);
      o.rotation.set(0, c.mirror ? Math.PI : 0, 0);
      o.visible = true;
      o.scale.set(1, 1, 1);
    }
    const sc = (id, x, y = x, z = x) => spec.ids.has(id) && parts[id].scale.set(x, y, z);
    if (b.engine === 'strong') sc('engine', 1.14, 1.08); else if (b.engine === 'eco') sc('engine', 0.88, 0.95);
    if (b.tanks !== 'std') { const k = b.tanks === 'large' ? [1.16, 1.12] : [0.86, 0.88]; sc('tankL', k[0], k[1]); sc('tankR', k[0], k[1]); }
    if (b.power !== 'panels') sc('battery', 1.35, 1.3);
    if (b.legs === 'wide') sc('legs', 1.25, 1, 1.25); else if (b.legs === 'light') sc('legs', 0.9, 1, 0.9);
    rigScale = b.chute === 'large' ? 1.24 : 1;
    group.userData.sink = 0;
    group.userData.physics = false;
    group.quaternion.identity();
    if (chuteRig.parent !== group) group.add(chuteRig);
    chuteRig.position.set(0, 5.72, 0); chuteRig.rotation.set(0, 0, 0); chuteRig.scale.setScalar(rigScale);
    chuteRig.visible = false; looseChute = null;
    for (const l of loose) l.obj.parent?.remove(l.obj);
    loose.length = 0;
    embLife.fill(0);
    for (const o of Object.values(parts)) o.traverse((m) => {
      if (m.isMesh) { m.material.emissive.copy(m.material.userData.base.color); m.material.emissiveIntensity = m.material.userData.base.i; }
    });
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
    if (!group.userData.physics) {
      group.position.set(s.x, s.y - (group.userData.sink || 0), s.z);
      group.rotation.set(s.b, 0, s.a);
    }
    updateChute(s, t, dt);
    // solar wings fold up around their root at the frame (root is 1.25 m inboard of the panel centre)
    const th = s.panelFold * 1.45;
    for (const id of ['solarL', 'solarR']) {
      const part = parts[id];
      if (part.parent !== group) continue;
      const c = part.userData.component, side = Math.sign(c.pos[0]);
      const rootX = c.pos[0] - side * 1.25;
      part.position.set(rootX + side * 1.25 * Math.cos(th), c.pos[1] + 1.25 * Math.sin(th), c.pos[2]);
      part.rotation.z = th; // the left wing is mirrored via rotation.y = π, so the same z angle folds both up
    }
    updateHeat(s, dt);
    const thr = s.status === 'flying' ? s.throttle : 0;
    const flick = 0.9 + Math.random() * 0.2;
    flame.visible = thr > 0.01;
    flame.scale.set(0.6 + thr * 0.4, (0.25 + thr) * flick, 0.6 + thr * 0.4);
    glow.intensity = thr * 60 * flick;
    const { cx, cy, cz } = massProps(s);
    com.position.set(cx, cy, cz);
    for (const m of screenMats) m.emissiveIntensity = s.powered ? 1 : 0;
  }

  function updateChute(s, t, dt) {
    if (looseChute) {
      // detached canopy drifts away, slowly falling, collapsing if torn
      looseChute.t += dt;
      looseChute.v.y += (-4 - looseChute.v.y) * Math.min(1, dt * 1.5);
      looseChute.v.x *= 1 - dt * 0.8;
      chuteRig.position.addScaledVector(looseChute.v, dt);
      chuteRig.rotation.z += dt * (looseChute.torn ? 1.2 : 0.4);
      const k = Math.min(1, looseChute.t / 1.5);
      canopy.scale.set(1 - k * (looseChute.torn ? 0.8 : 0.5), 1, 1 - k * (looseChute.torn ? 0.8 : 0.5));
      if (looseChute.t > 10) chuteRig.visible = false;
      return;
    }
    if (s.chute === 'stowed') { chuteRig.visible = false; return; }
    if ((s.chute === 'cut' || s.chute === 'torn') && chuteRig.parent === group) {
      group.parent.attach(chuteRig);
      looseChute = { v: new THREE.Vector3(s.vx * 0.5, s.vy * 0.4 + 6, s.vz * 0.5), t: 0, torn: s.chute === 'torn' };
      return;
    }
    if (s.status === 'crashed') { chuteRig.visible = false; return; }
    chuteRig.visible = true;
    for (const m of canopyMats) m.opacity = canopyAlpha;
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
    for (const m of canopyMats) m.opacity = fade * canopyAlpha;
    chuteRig.visible = fade > 0.01;
    canopy.scale.set(w, h, w);
    // the canopy stays roughly vertical in the world while the lander swings below it
    // canopy lies along the relative airflow
    const flowX = air ? Math.atan2(s.windX - s.vx, Math.max(3, -s.vy)) : 0;
    const flowZ = air ? Math.atan2(s.windZ - s.vz, Math.max(3, -s.vy)) : 0;
    // steering: the pilot pulls the risers, the canopy leans the way it glides
    chuteRig.userData.sx = (chuteRig.userData.sx ?? 0) + ((s.steerX || 0) - (chuteRig.userData.sx ?? 0)) * 0.08;
    chuteRig.userData.sz = (chuteRig.userData.sz ?? 0) + ((s.steerZ || 0) - (chuteRig.userData.sz ?? 0)) * 0.08;
    chuteRig.rotation.set(-s.b * 0.85 + flowZ * 0.9 + chuteRig.userData.sz * 0.3, 0, -s.a * 0.85 - flowX * 0.9 - chuteRig.userData.sx * 0.3 + Math.sin(t * 1.3) * 0.04 + (air ? 0 : 0.6));
  }

  function updateHeat(s, dt) {
    if (!scene && group.parent) { scene = group.parent; scene.add(embers); }
    for (const c of s.spec.comps) {
      if (!c.heat) continue;
      const part = parts[c.id];
      const k = Math.min(1, Math.max(0, (s.temp[c.id] - 140) / (c.heat[1] - 140)));
      const col = heatColor(k);
      part.traverse((m) => {
        if (!m.isMesh) return;
        const b = m.material.userData.base;
        m.material.emissive.copy(b.color).lerp(col, Math.min(1, k * 1.4));
        m.material.emissiveIntensity = Math.max(b.i, k * 2.2);
      });
      // embers from glowing parts that are still attached
      if (k > 0.4 && part.parent === group && s.status === 'flying') {
        let n = Math.random() < (k - 0.35) * 4 * dt * 60 ? 1 + Math.floor(k * 3) : 0;
        part.getWorldPosition(tmpV);
        while (n-- > 0) {
          const i = embNext++ % EMB;
          embPos[i * 3] = tmpV.x + (Math.random() - 0.5) * 1.5; embPos[i * 3 + 1] = tmpV.y - 0.3; embPos[i * 3 + 2] = tmpV.z + (Math.random() - 0.5) * 1.5;
          embVel[i * 3] = s.vx * 0.7 + (Math.random() - 0.5) * 3; embVel[i * 3 + 1] = s.vy * 0.7 + Math.random() * 2; embVel[i * 3 + 2] = s.vz * 0.7 + (Math.random() - 0.5) * 3;
          embLife[i] = 0.6 + Math.random() * 0.5;
        }
      }
    }
    for (let i = 0; i < EMB; i++) {
      if (embLife[i] <= 0) { embPos[i * 3 + 1] = -1e5; continue; }
      embLife[i] -= dt;
      for (let k = 0; k < 3; k++) embPos[i * 3 + k] += embVel[i * 3 + k] * dt;
    }
    embGeo.attributes.position.needsUpdate = true;
    // parts that blew off: tumble away, decelerated hard by the air (they fall behind = fly up on screen)
    for (const l of loose) {
      l.t += dt;
      l.v.y += (-12 - l.v.y) * Math.min(1, dt * 1.2);
      l.v.x *= 1 - dt * 0.5;
      l.obj.position.addScaledVector(l.v, dt);
      l.obj.rotation.x += l.w.x * dt; l.obj.rotation.z += l.w.z * dt;
      if (l.t > 8) l.obj.visible = false;
    }
  }

  /** A component overheated: detach it and send it tumbling. Returns its world position. */
  function blowOff(id, s) {
    const part = parts[id];
    if (part.parent !== group) return null;
    group.parent.attach(part);
    const side = Math.sign(part.userData.component.pos[0]) || (Math.random() - 0.5);
    loose.push({ obj: part, t: 0, v: new THREE.Vector3(s.vx + side * (5 + Math.random() * 4), s.vy * 0.85 + 6, s.vz + (Math.random() - 0.5) * 6), w: new THREE.Vector3(Math.random() * 6 - 3, 0, Math.random() * 6 - 3) });
    return part.getWorldPosition(new THREE.Vector3());
  }

  function setCanopyAlpha(a) {
    canopyAlpha = a;
    for (const m of canopyMats) m.depthWrite = a > 0.9;
  }

  return { group, parts, flame, helpers, reset, update, damageLegs, chuteRig, blowOff, setCanopyAlpha };
}
