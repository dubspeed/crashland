import * as THREE from 'three';
import { terrainHeight } from './sim.js';

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function createWorld(scene, models) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // stars on a far sphere
  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 1500; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(4000);
    v.y = Math.abs(v.y) * 0.9 + 100;
    sp.push(v.x, v.y, v.z);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true }));
  scene.add(stars);

  // dust particles around the camera give a sense of speed
  const DUST = 700, BOX = 140;
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < dustPos.length; i++) dustPos[i] = (Math.random() - 0.5) * BOX;
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.55, depthWrite: false }));
  dust.frustumCulled = false;
  scene.add(dust);

  let ground = null;

  function buildGround(p) {
    if (ground) { scene.remove(ground); ground.traverse((o) => { o.geometry?.dispose(); }); }
    ground = new THREE.Group();

    const geo = new THREE.PlaneGeometry(2400, 2400, 200, 200).rotateX(-Math.PI / 2).toNonIndexed();
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    const colors = new Float32Array(pos.count * 3);
    const c1 = new THREE.Color(p.ground), c2 = new THREE.Color(p.ground2), c = new THREE.Color();
    for (let f = 0; f < pos.count; f += 3) {
      const x = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
      const z = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
      const y = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
      c.copy(c1).lerp(c2, Math.min(1, Math.max(0, y / 22 + (hash(x, z) - 0.5) * 0.5)));
      c.offsetHSL(0, 0, (hash(z, x) - 0.5) * 0.06);
      for (let k = 0; k < 3; k++) c.toArray(colors, (f + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    terrain.receiveShadow = true;
    ground.add(terrain);

    // landing pad
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(12, 13, 0.5, 8).translate(0, -0.23, 0),
      new THREE.MeshStandardMaterial({ color: 0x7c8088, roughness: 0.8, flatShading: true }));
    pad.rotation.y = Math.PI / 8;
    pad.receiveShadow = true;
    const mark = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6, emissive: 0x332200 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(7.6, 8.4, 8, 1).rotateX(-Math.PI / 2), mark);
    ring.position.y = 0.03; ring.rotation.y = Math.PI / 8;
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(6, 0.02, 0.6), mark);
    const bar2 = bar1.clone(); bar1.rotation.y = Math.PI / 4; bar2.rotation.y = -Math.PI / 4;
    bar1.position.y = bar2.position.y = 0.03;
    ground.add(pad, ring, bar1, bar2);
    const lamps = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3b2f }));
      l.position.set(Math.cos(a) * 11.6, 0.15, Math.sin(a) * 11.6);
      lamps.push(l); ground.add(l);
    }
    ground.userData.lamps = lamps;

    // rocks
    const rnd = (n) => hash(n * 1.7, n * 9.3);
    for (let i = 0; i < 220; i++) {
      const r = 24 + rnd(i) * 700, a = rnd(i + 100) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(z) < 6 && r < 60) continue;
      const s = 0.6 + rnd(i + 200) ** 2 * (r < 60 ? 1.5 : 9);
      const rock = models.rock.clone();
      rock.scale.set(s, s * (0.7 + rnd(i + 300) * 0.6), s);
      rock.rotation.y = rnd(i + 400) * 6;
      rock.position.set(x, terrainHeight(x, z) - s * 0.15, z);
      rock.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.set(p.ground2).lerp(new THREE.Color(0x888888), 0.35); } });
      ground.add(rock);
    }
    scene.add(ground);
  }

  function setPlanet(p) {
    scene.background = new THREE.Color(p.sky);
    scene.fog = new THREE.Fog(p.fog, 150, p.stars ? 2600 : 1400);
    hemi.color.set(p.sky).lerp(new THREE.Color(0xffffff), 0.6);
    hemi.groundColor.set(p.ground2);
    hemi.intensity = p.stars ? 0.6 : 1.0;
    sun.color.set(p.sun);
    stars.material.opacity = p.stars ? 1 : p.id === 'brontes' ? 0.45 : 0;
    stars.visible = stars.material.opacity > 0;
    dust.material.color.set(p.stars ? 0xbfc6d6 : 0xffffff);
    buildGround(p);
  }

  function update(camera, focus, t) {
    sun.position.set(focus.x + 30, focus.y + 60, focus.z + 25);
    sun.target.position.copy(focus);
    stars.position.copy(camera.position);
    // wrap dust inside a box around the camera
    for (let i = 0; i < DUST; i++) {
      for (let k = 0; k < 3; k++) {
        const c = camera.position.getComponent(k);
        let v = dustPos[i * 3 + k];
        if (v < c - BOX / 2) v += BOX; else if (v > c + BOX / 2) v -= BOX;
        dustPos[i * 3 + k] = v;
      }
    }
    dustGeo.attributes.position.needsUpdate = true;
    const on = Math.sin(t * 4) > 0;
    ground?.userData.lamps.forEach((l, i) => { l.material.color.set(on === (i % 2 === 0) ? 0xff3b2f : 0x441010); });
  }

  return { setPlanet, update };
}
