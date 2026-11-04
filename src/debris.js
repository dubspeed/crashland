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

  function explode(ship, s) {
    clear();
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
      const pow = 5 + Math.random() * 9;
      body.velocity.set(s.vx * 0.3 + dir.x * pow, Math.abs(s.vy) * 0.08 + 4 + Math.random() * 6, dir.z * pow);
      body.angularVelocity.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      world.addBody(body);
      bodies.push({ body, obj: part });
    }
    ship.flame.visible = false;
    ship.helpers.visible = false;

    // fireball, smoke, flash
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ball.position.copy(impact);
    scene.add(ball);
    fx.push({ obj: ball, t: 0, life: 0.9, kind: 'ball' });
    const flash = new THREE.PointLight(0xff8a30, 800, 120, 1.6);
    flash.position.copy(impact).add(new THREE.Vector3(0, 3, 0));
    scene.add(flash);
    fx.push({ obj: flash, t: 0, life: 1.4, kind: 'flash' });
    for (let i = 0; i < 14; i++) {
      const smoke = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0),
        new THREE.MeshStandardMaterial({ color: 0x2a2624, transparent: true, opacity: 0.85, flatShading: true, depthWrite: false }));
      smoke.position.copy(impact).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4));
      smoke.userData.v = new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3);
      scene.add(smoke);
      fx.push({ obj: smoke, t: -Math.random() * 0.3, life: 3 + Math.random() * 2, kind: 'smoke' });
    }
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
      if (f.kind === 'ball') { f.obj.scale.setScalar(1 + Math.sqrt(k) * 10); f.obj.material.opacity = (1 - k) ** 1.5; f.obj.material.color.setHSL(0.09 - k * 0.07, 1, 0.6 - k * 0.3); }
      if (f.kind === 'flash') f.obj.intensity = 800 * (1 - k) ** 2;
      if (f.kind === 'smoke' && f.t > 0) { f.obj.position.addScaledVector(f.obj.userData.v, dt); f.obj.scale.setScalar(1 + k * 4); f.obj.material.opacity = 0.85 * (1 - k); }
      if (k >= 1) { scene.remove(f.obj); fx.splice(i, 1); }
    }
  }

  return { explode, update, clear };
}
