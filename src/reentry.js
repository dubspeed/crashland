// Re-entry effects: a glowing plasma sheath on the lander's leading side, a long plasma trail behind it,
// an orange glow light on the hull. Driven by the heat flux and the airflow from the flight model.
import * as THREE from 'three';

const NOISE = /* glsl */ `
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h1(i), h1(i + vec2(1, 0)), u.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), u.x), u.y);
}
// colour of hot gas: deep orange at low heat, through yellow-pink to a pale violet white at the peak
vec3 plasmaCol(float k) {
  vec3 a = vec3(0.9, 0.22, 0.04), b = vec3(1.0, 0.55, 0.16), c = vec3(1.0, 0.86, 0.7);
  return k < 0.6 ? mix(a, b, k / 0.6) : mix(b, c, (k - 0.6) / 0.4);
}`;

export function createReentry(scene) {
  const uni = { uTime: { value: 0 }, uI: { value: 0 } };

  // sheath: a squashed sphere around the lander, brightest at its leading cap and at the rim (fresnel)
  const sheathMat = new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uI;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      ${NOISE}
      void main() {
        // a bow shock: bright on the leading cap, fading towards the sides, ragged and flickering
        float lead = pow(smoothstep(0.0, 1.0, vP.y), 1.6);   // +y of the mesh points into the airflow
        float rim = pow(1.0 - abs(dot(vN, vV)), 3.0) * lead;
        float flick = 0.6 + 0.7 * n2(vec2(atan(vP.x, vP.z) * 4.0, vP.y * 3.0 - uTime * 11.0));
        float a = (lead * 0.7 + rim * 0.3) * flick * min(uI, 1.0);
        gl_FragColor = vec4(plasmaCol(clamp(uI * 0.85, 0.0, 1.0)) * a, a);
      }`,
  });
  const sheath = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), sheathMat);
  sheath.renderOrder = 15;

  // trail: an open cone behind the lander, fading along its length, with streaks moving downstream
  const trailGeo = new THREE.CylinderGeometry(0.15, 1, 1, 24, 12, true).translate(0, -0.5, 0); // tip at 0, widens to -1
  const trailMat = new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main() {
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uI;
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      ${NOISE}
      void main() {
        float along = -vP.y;                                 // 0 at the lander .. 1 at the far end
        float fade = (1.0 - along) * (1.0 - along) * smoothstep(0.0, 0.06, along);
        float streak = 0.55 + 0.6 * n2(vec2(atan(vP.x, vP.z) * 4.0, along * 9.0 + uTime * 6.0));
        float face = 0.35 + 0.65 * abs(dot(vN, vV));
        float a = fade * streak * face * min(uI, 1.0) * 0.6;
        gl_FragColor = vec4(plasmaCol(clamp(uI * 0.75 * (1.0 - along * 0.7), 0.0, 1.0)) * a, a);
      }`,
  });
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.renderOrder = 14;

  const light = new THREE.PointLight(0xff7a30, 0, 40, 1.6);
  const group = new THREE.Group();
  group.add(sheath, trail, light);
  group.visible = false;
  scene.add(group);

  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), q = new THREE.Quaternion();
  let I = 0;
  /** s: flight state; pos: lander position (render coords, centre of the hull); dt, t: seconds */
  function update(s, pos, dt, t) {
    // intensity from the heat flux (heat-relevant entries reach ~100-250), eased so it swells and fades
    const target = s.status === 'flying' ? Math.min(1.15, Math.pow(Math.max(0, (s.heatFlux - 10) / 140), 0.7)) : 0;
    I += (target - I) * Math.min(1, dt * 3);
    uni.uI.value = I; uni.uTime.value = t;
    group.visible = I > 0.01;
    if (!group.visible) { light.intensity = 0; return; }
    // airflow direction (velocity relative to the air) in render coordinates
    dir.set(s.vx - (s.windX || 0), s.vy, s.vz - (s.windZ || 0));
    const v = dir.length();
    if (v < 1) return;
    dir.divideScalar(v);
    group.position.copy(pos);
    q.setFromUnitVectors(up, dir);
    // sheath: centred slightly ahead, flattened against the flow
    sheath.quaternion.copy(q);
    sheath.position.copy(dir).multiplyScalar(0.6);
    const r = 3.8 + I * 0.8;
    sheath.scale.set(r, r * 0.6, r);
    // trail: points backwards, longer with speed and heat
    trail.quaternion.copy(q);
    trail.position.copy(dir).multiplyScalar(-0.5);
    const len = 12 + Math.min(1, v / 250) * 70 * Math.min(1, I + 0.2);
    trail.scale.set(3.2 + I * 1.5, len, 3.2 + I * 1.5);
    light.position.copy(dir).multiplyScalar(3);
    light.intensity = 60 * I * I;
  }
  return { update, get intensity() { return I; } };
}
