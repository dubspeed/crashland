import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { terrainHeight } from './sim.js';

export function createDebris(scene) {
  let world = null;
  const bodies = [];
  const fx = [];

  function clear() {
    bodies.length = 0;
    for (const f of fx) scene.remove(f.obj);
    fx.length = 0;
    world = null;
  }

  function smokeAt(pos, n, size, color = 0x2a2624, spread = 4) {
    for (let i = 0; i < n; i++) {
      const smoke = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0),
        new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.85, flatShading: true, depthWrite: false }));
      smoke.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * size, (Math.random() - 0.5) * spread));
      smoke.userData.v = new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5 * size, (Math.random() - 0.5) * 3);
      scene.add(smoke);
      fx.push({ obj: smoke, t: -Math.random() * 0.3, life: 2 + Math.random() * 2 * size, kind: 'smoke' });
    }
  }

  /** dust ring kicked up by a hard (but survivable) landing */
  function puff(ship, s, strength) {
    const color = new THREE.Color(s.planet.ground).lerp(new THREE.Color(0xdddddd), 0.4).getHex();
    const n = 10 + strength * 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const d = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 + Math.random() * 0.2, 0),
        new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.5, flatShading: true, depthWrite: false }));
      d.position.set(s.x + Math.cos(a) * 1.5, s.y + 0.2, Math.sin(a) * 1.5);
      const sp = 2 + Math.random() * 2 + strength * 1.5;
      d.userData.v = new THREE.Vector3(Math.cos(a) * sp, 0.3 + Math.random() * 0.6, Math.sin(a) * sp);
      scene.add(d);
      fx.push({ obj: d, t: 0, life: 1.5 + Math.random(), kind: 'dust' });
    }
  }

  function explode(ship, s) {
    clear();
    const e = s.touch?.energy ?? 1; // 0 = gentle tip-over .. 1 = high-speed impact
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, -s.planet.g, 0) });
    world.allowSleep = true;
    const mat = new CANNON.Material();
    world.defaultContactMaterial = new CANNON.ContactMaterial(mat, mat, { friction: 0.5, restitution: 0.25 });
    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: mat });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.position.set(0, terrainHeight(s.x), 0);
    world.addBody(ground);

    ship.group.updateMatrixWorld(true);
    const impact = new THREE.Vector3(s.x, s.y + 1, 0);
    for (const part of Object.values(ship.parts)) {
      const box = new THREE.Box3();
      part.traverse((m) => {
        if (!m.isMesh) return;
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrix));
      });
      const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.12, 0.12, 0.12));
      const center = box.getCenter(new THREE.Vector3());
      scene.attach(part); // keep world transform
      const c = part.userData.component;
      const body = new CANNON.Body({ mass: Math.max(20, c.mass + (c.fuel ? s[c.fuel] : 0)), material: mat, linearDamping: 0.05, angularDamping: 0.1 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(size.x, size.y, size.z)), new CANNON.Vec3(center.x, center.y, center.z));
      body.position.copy(part.position);
      body.quaternion.copy(part.quaternion);
      const dir = part.position.clone().sub(impact).setZ((Math.random() - 0.5) * 2).normalize();
      const pow = (1 + Math.random() * 2) + e * (4 + Math.random() * 9);
      body.velocity.set(s.vx * 0.4 + dir.x * pow, 0.5 + e * (3 + Math.random() * 7), dir.z * pow);
      const spin = 1.5 + e * 6.5;
      body.angularVelocity.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
      world.addBody(body);
      bodies.push({ body, obj: part });
    }
    ship.flame.visible = false;
    ship.helpers.visible = false;

    // fireball + flash scale with impact energy and the fuel still on board
    const fuelFrac = (s.fuelL + s.fuelR) / 1200;
    const boom = e * (0.4 + 0.6 * fuelFrac);
    if (boom > 0.3) {
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      ball.position.copy(impact);
      ball.userData.size = 2 + boom * 9;
      scene.add(ball);
      fx.push({ obj: ball, t: 0, life: 0.5 + boom * 0.5, kind: 'ball' });
      const flash = new THREE.PointLight(0xff8a30, 0, 120, 1.6);
      flash.position.copy(impact).add(new THREE.Vector3(0, 3, 0));
      flash.userData.peak = 900 * boom;
      scene.add(flash);
      fx.push({ obj: flash, t: 0, life: 0.6 + boom, kind: 'flash' });
    }
    smokeAt(impact, Math.round(4 + boom * 12), 0.6 + boom * 0.6, boom > 0.3 ? 0x2a2624 : new THREE.Color(s.planet.ground).lerp(new THREE.Color(0xcccccc), 0.4).getHex());
  }

  function update(dt) {
    if (world) {
      world.step(1 / 60, dt, 4);
      for (const { body, obj } of bodies) { obj.position.copy(body.position); obj.quaternion.copy(body.quaternion); }
    }
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.t += dt;
      const k = Math.max(0, f.t / f.life);
      if (f.kind === 'ball') { f.obj.scale.setScalar(1 + Math.sqrt(k) * f.obj.userData.size); f.obj.material.opacity = (1 - k) ** 1.5; f.obj.material.color.setHSL(0.09 - k * 0.07, 1, 0.6 - k * 0.3); }
      if (f.kind === 'flash') f.obj.intensity = f.obj.userData.peak * (1 - k) ** 2;
      if (f.kind === 'smoke' && f.t > 0) { f.obj.position.addScaledVector(f.obj.userData.v, dt); f.obj.scale.setScalar(1 + k * 4); f.obj.material.opacity = 0.85 * (1 - k); }
      if (f.kind === 'dust') { f.obj.position.addScaledVector(f.obj.userData.v, dt); f.obj.userData.v.multiplyScalar(1 - 1.5 * dt); f.obj.scale.setScalar(1 + k * 2.5); f.obj.material.opacity = 0.5 * (1 - k); }
      if (k >= 1) { scene.remove(f.obj); fx.splice(i, 1); }
    }
  }

  return { explode, puff, update, clear };
}
