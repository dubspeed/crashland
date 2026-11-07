import * as THREE from 'three';
import { terrainHeight, surfaceR, surfaceId, surfaceEdge } from './sim.js';
import { createMoonTerrain } from './moon.js';

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function createWorld(scene, models) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true;
  const mobile = matchMedia('(pointer: coarse)').matches;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
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

  // sky dome (planets with air): horizon colour fading to a darker zenith, and to black space as the air
  // thins; a thin glowing limb at the (dipped) horizon when seen from high up
  const skyUni = { uHorizon: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() }, uSpace: { value: new THREE.Color(0x05060c) }, uAir: { value: 1 }, uDip: { value: 0 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    uniforms: skyUni, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: /* glsl */ `varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSpace; uniform float uAir; uniform float uDip;
      varying vec3 vD;
      void main() {
        float e = normalize(vD).y + uDip;                 // elevation above the visible horizon
        vec3 air = mix(uHorizon, uZenith, smoothstep(0.0, 0.7, e));
        vec3 col = mix(uSpace, air, uAir);
        float limb = exp(-abs(e) * 30.0) * (1.0 - uAir) * 0.8; // thin bright band from orbit
        col += uHorizon * limb;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  sky.renderOrder = -100; sky.frustumCulled = false;
  sky.scale.setScalar(5000);
  scene.add(sky);
  let skyBase = null, starBase = 0;
  let curveR = 0; // orbit level: radius of the moon the ground is bent onto (0 = flat world)

  // flat sim coordinates (x, z = arc length from the pad, h = height) -> point in the ground group.
  // azimuthal equidistant mapping onto a sphere whose top touches the pad; flat world: identity
  const UP = new THREE.Vector3(0, 1, 0);
  function curveDir(x, z, out) {
    const d = Math.hypot(x, z);
    if (!curveR || d < 1e-6) return out.set(0, 1, 0);
    const phi = d / curveR, sn = Math.sin(phi);
    return out.set((x / d) * sn, Math.cos(phi), (z / d) * sn);
  }
  function curvePoint(x, h, z, out) {
    if (!curveR) return out.set(x, h, z);
    curveDir(x, z, out);
    return out.multiplyScalar(curveR + h).add(_cR.set(0, -curveR, 0));
  }
  const _cam = new THREE.Vector3(), _up = new THREE.Vector3();
  const _cR = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();

  let moon = null; // orbit level terrain (GPU-displaced grid that follows the lander)

  function buildGround(p) {
    if (ground) { scene.remove(ground); ground.traverse((o) => { o.geometry?.dispose(); }); }
    ground = new THREE.Group();

    curveR = surfaceR(p);
    moon = null;
    if (curveR) {
      moon = createMoonTerrain(THREE, curveR, surfaceEdge(p), p.ground, p.ground2, surfaceId(p));
      ground.add(moon.mesh);
    } else {
      const terrain = new THREE.Mesh(flatGround(p), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
      terrain.receiveShadow = true;
      ground.add(terrain);
    }
    buildPad(p);
  }

  function flatGround(p) {
    const geo = new THREE.PlaneGeometry(2400, 2400, 140, 140).rotateX(-Math.PI / 2).toNonIndexed();
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
    return geo;
  }

  function buildPad(p) {
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

    // windsock at the pad edge: pole + striped cone hanging from a pivot
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 6), new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.4, roughness: 0.5 }));
    pole.position.set(14, 3.5, -8);
    const sock = new THREE.Group();
    sock.position.set(14, 6.9, -8);
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.45 - i * 0.07, 0.38 - i * 0.07, 0.75, 8, 1, true).rotateZ(0).translate(0, -0.4 - i * 0.75, 0),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffffff : 0xff6a1a, side: THREE.DoubleSide, roughness: 0.8 }));
      seg.castShadow = true;
      sock.add(seg);
    }
    ground.add(pole, sock);
    ground.userData.sock = sock;

    // faint light column above the pad so it can be found from high up
    const bh = curveR ? 3000 : 600, br = curveR ? 5 : 1.2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(br, br, bh, 8, 1, true).translate(0, bh / 2, 0),
      new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ground.add(beam);
    ground.userData.beam = beam;

    // rocks: one instanced mesh (one draw call) instead of hundreds of separate meshes
    const rnd = (n) => hash(n * 1.7, n * 9.3);
    let rockMesh = null;
    models.rock.traverse((o) => { if (o.isMesh && !rockMesh) rockMesh = o; });
    const rockMat = rockMesh.material.clone();
    rockMat.color.set(p.ground2).lerp(new THREE.Color(0x888888), 0.35);
    const rocks = new THREE.InstancedMesh(rockMesh.geometry, rockMat, 220);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < 220; i++) {
      const r = 24 + rnd(i) * 700, a = rnd(i + 100) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(z) < 6 && r < 60) continue;
      const k = 0.6 + rnd(i + 200) ** 2 * (r < 60 ? 1.5 : 9);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd(i + 400) * 6);
      sc.set(k, k * (0.7 + rnd(i + 300) * 0.6), k);
      curvePoint(x, terrainHeight(x, z) - k * 0.15, z, ps);
      if (curveR) q.premultiply(_q.setFromUnitVectors(UP, curveDir(x, z, _d)));
      rocks.setMatrixAt(n++, mtx.compose(ps, q, sc));
    }
    rocks.count = n;
    rocks.receiveShadow = true;
    ground.add(rocks);
    scene.add(ground);
  }

  function setPlanet(p) {
    scene.background = new THREE.Color(p.sky);
    // haze: none in vacuum, thicker the denser the air (orbit levels see tens of kilometres)
    const haze = surfaceR(p) ? (p.rho === 0 ? [80000, 300000] : p.rho < 0.1 ? [3000, 50000] : p.rho < 2 ? [2500, 32000] : [1500, 18000]) : null;
    scene.fog = new THREE.Fog(p.fog, haze ? haze[0] : 150, haze ? haze[1] : p.stars ? 2600 : 1400);
    stars.scale.setScalar(surfaceR(p) ? 10 : 1);
    hemi.color.set(p.sky).lerp(new THREE.Color(0xffffff), 0.6);
    hemi.groundColor.set(p.ground2);
    hemi.intensity = surfaceR(p) ? 0.35 : p.stars ? 0.6 : 1.0;
    sun.color.set(p.sun);
    stars.material.opacity = p.stars ? 1 : p.id.startsWith('brontes') ? 0.45 : 0;
    starBase = stars.material.opacity;
    sky.visible = p.rho > 0;
    skyBase = { horizon: new THREE.Color(p.fog), zenith: new THREE.Color(p.sky).multiplyScalar(0.6), fog: new THREE.Color(p.fog), bg: new THREE.Color(p.sky) };
    skyUni.uHorizon.value.copy(skyBase.horizon); skyUni.uZenith.value.copy(skyBase.zenith);
    stars.visible = stars.material.opacity > 0;
    dust.material.color.set(p.stars ? 0xbfc6d6 : 0xffffff);
    buildGround(p);
  }

  function update(camera, focus, t, wind = { x: 0, z: 0 }, dt = 0) {
    for (let i = 0; i < DUST; i++) { dustPos[i * 3] += wind.x * dt; dustPos[i * 3 + 2] += wind.z * dt; }
    const ws = Math.hypot(wind.x, wind.z);
    const beam = ground?.userData.beam;
    if (beam) {
      // fade out near the column, and when looking along it from close to its axis (seen from inside, the
      // 8-sided cylinder becomes a big see-through polygon over the screen)
      const lp = beam.worldToLocal(_g.copy(camera.position)), axis = Math.hypot(lp.x, lp.z);
      beam.material.opacity = (curveR ? 0.22 : 0.12) * Math.min(1, Math.max(0, (camera.position.distanceTo(beam.getWorldPosition(_g)) - 90) / 400))
        * Math.min(1, Math.max(0, (axis - 25) / 60));
    }
    const sock = ground?.userData.sock;
    if (sock) {
      // sock lifts from hanging (0) to horizontal (strong wind) and points downwind, with a little flutter
      const k = Math.min(1, ws / 12);
      sock.parent.userData.yaw ??= 0;
      if (ws > 0.3) sock.userData.yawTarget = -Math.atan2(wind.z, wind.x);
      sock.rotation.set(0, sock.userData.yawTarget ?? 0, 0.15 + k * 1.35 + Math.sin(t * 7) * 0.05 * k, 'YXZ');
    }
    // orbit level: low sun (~20°) so the craters get lit rims and shadowed bowls
    if (curveR) { const k = Math.max(1, focus.y / 60); sun.position.set(focus.x + 70 * k, focus.y + 32 * k, focus.z + 45 * k); }
    else sun.position.set(focus.x + 30, focus.y + 60, focus.z + 25);
    sun.target.position.copy(focus);
    // the shadow box must reach the ground below a high lander, else its far end cuts straight edges into it
    // high up the box also widens to cover all the ground in view (the lander's own shadow is invisible from
    // there anyway); near the ground it shrinks back to a sharp 50 m box
    const far = Math.max(200, Math.min(30000, focus.y * 4 + 300)), half = Math.max(25, Math.min(12000, focus.y * 3));
    const sc = sun.shadow.camera;
    if (Math.abs(far - sc.far) > 20 || Math.abs(half - sc.right) > 5) {
      sc.far = far; sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.updateProjectionMatrix();
    }
    stars.position.copy(camera.position);
    sky.position.copy(camera.position);
    dust.visible = !curveR || camera.position.y < 400; // speed dust only near the ground, not in orbit
    // orbit level: pick the terrain tiles for this camera (camera in the moon's frame, from its centre)
    if (moon) { ground.updateMatrixWorld(); moon.update(ground.worldToLocal(_cam.copy(camera.position)).add(_up.set(0, curveR, 0))); }
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

  /** orbit level: turn the moon under the lander so the ground point below it sits at (x, 0, z) facing up.
   *  The lander and camera keep using the flat sim coordinates. */
  const _g = new THREE.Vector3();
  function align(x, z, alt = 0) {
    if (!ground) return;
    if (!curveR) { ground.position.set(0, 0, 0); ground.quaternion.identity(); return; }
    ground.quaternion.setFromUnitVectors(curveDir(x, z, _d), UP);
    curvePoint(x, 0, z, _g).applyQuaternion(ground.quaternion);
    ground.position.set(x - _g.x, -_g.y, z - _g.z);
    ground.updateMatrixWorld(true);
  }
  /** flat sim point -> render position (and the local "up" orientation there) */
  function toRender(x, h, z, out, quat) {
    curvePoint(x, h, z, out);
    if (ground) out.applyMatrix4(ground.matrixWorld);
    if (quat) { quat.setFromUnitVectors(UP, curveDir(x, z, _d)); if (ground) quat.premultiply(ground.quaternion); }
    return out;
  }

  /** air: 0 (space) .. 1 (ground density); dip: how far the horizon sinks below eye level (rad) */
  function setAir(air, dip) {
    if (!skyBase) return;
    skyUni.uAir.value = air; skyUni.uDip.value = Math.sin(dip);
    // distant haze and the background follow the sky; stars come out as the air thins
    if (sky.visible) {
      scene.fog.color.copy(skyUni.uSpace.value).lerp(skyBase.fog, Math.pow(air, 0.6));
      scene.background.copy(skyUni.uSpace.value).lerp(skyBase.bg, air);
      stars.material.opacity = Math.max(starBase, Math.pow(1 - air, 2));
      stars.visible = stars.material.opacity > 0.02;
    }
  }

  return { setPlanet, update, align, toRender, setAir, stats: () => ({ tiles: moon ? moon.tiles() : 0 }) };
}
