// Navball: an attitude ball drawn into the tilt pad. The centre is where the lander's nose (the thrust axis)
// points; blue sky above the horizon, brown ground below, lines every 30°. Markers: flight direction
// (prograde, yellow), against it (retrograde, yellow ✕) and the base (magenta). Screen up on the ball is the
// direction away from the camera when upright; the ball turns with the lander's own axes (rotated by the camera's
// heading), so it never flips, and the pad steers in the same frame: dragging toward a marker moves the nose to it.
import * as S from './sim.js';

/** the ball's frame: N = nose (thrust axis), Br / Bu = screen right / up on the ball; Ja / Jb = how the nose
 *  moves for the two tilt commands (rcs tips the top to -x, rcsZ to +z), unit length and perpendicular to N */
export function ballFrame(s, yaw) {
  const a = s.a, b = s.b || 0, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const N = { x: -sa, y: ca * cb, z: ca * sb };
  const Ja = { x: -ca, y: -sa * cb, z: -sa * sb };
  const sg = ca < 0 ? -1 : 1, Jb = { x: 0, y: -sb * sg, z: cb * sg };
  // upright: T1 = +x, T2 = -z; turned by the camera heading this is exactly the camera's right / forward
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const Br = { x: -Ja.x * c - Jb.x * sn, y: -Ja.y * c - Jb.y * sn, z: -Ja.z * c - Jb.z * sn };
  const Bu = { x: Ja.x * sn - Jb.x * c, y: Ja.y * sn - Jb.y * c, z: Ja.z * sn - Jb.z * c };
  return { N, Br, Bu, Ja, Jb };
}
/** the tilt pad in the ball's frame: (u right, v up) -> tilt commands that move the nose that way on the ball */
export function padToTilt(s, yaw, u, v) {
  const { Br, Bu, Ja, Jb } = ballFrame(s, yaw);
  const D = { x: Br.x * u + Bu.x * v, y: Br.y * u + Bu.y * v, z: Br.z * u + Bu.z * v };
  return { rcs: D.x * Ja.x + D.y * Ja.y + D.z * Ja.z, rcsZ: D.x * Jb.x + D.y * Jb.y + D.z * Jb.z };
}

const SKY = [47, 111, 176], SKY2 = [120, 175, 225], GROUND = [122, 74, 38], GROUND2 = [70, 42, 22];
const PRO = '#e8ff4a', TGT = '#ff5cf0';

export function createNavball(host) {
  const cv = document.createElement('canvas');
  cv.className = 'navball';
  host.prepend(cv);
  const ctx = cv.getContext('2d');
  let img = null, W = 0;
  const v3 = (x, y, z) => ({ x, y, z });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return v3(a.x / l, a.y / l, a.z / l); };

  function draw(s, yaw) {
    const css = cv.clientWidth;
    if (!css) return;
    const px = Math.min(220, Math.round(css * Math.min(2, devicePixelRatio || 1)));
    if (px !== W) { W = px; cv.width = cv.height = W; img = ctx.createImageData(W, W); }
    const { N, Br, Bu } = ballFrame(s, yaw);
    const d = img.data, r = W / 2;
    // the ball, pixel by pixel: the direction under each pixel (front half), coloured by its elevation
    for (let j = 0; j < W; j++) {
      const v = (r - j - 0.5) / r;
      for (let i = 0; i < W; i++) {
        const u = (i + 0.5 - r) / r, q = u * u + v * v, o = (j * W + i) * 4;
        if (q >= 1) { d[o + 3] = 0; continue; }
        const w = Math.sqrt(1 - q);
        const dx = N.x * w + Br.x * u + Bu.x * v, dy = N.y * w + Br.y * u + Bu.y * v, dz = N.z * w + Br.z * u + Bu.z * v;
        const el = Math.asin(Math.max(-1, Math.min(1, dy))), sky = dy >= 0;
        const k = Math.min(1, Math.abs(el) / 1.2), A = sky ? SKY2 : GROUND, B = sky ? SKY : GROUND2;
        let cr = A[0] + (B[0] - A[0]) * k, cg = A[1] + (B[1] - A[1]) * k, cb = A[2] + (B[2] - A[2]) * k;
        // lines: horizon, every 30° of elevation, every 45° of heading
        const elDeg = (el * 180) / Math.PI, hd = (Math.atan2(dz, dx) * 180) / Math.PI;
        const fw = 1.6 / (r * Math.max(0.25, w)) * 57.3; // line width in degrees (wider toward the rim)
        if (Math.abs(elDeg) < fw * 0.9) { cr = cg = cb = 245; } else if (Math.abs(((elDeg % 30) + 45) % 30 - 15) > 15 - fw * 0.45 || (Math.abs(dy) < 0.9 && Math.abs(((hd % 45) + 67.5) % 45 - 22.5) > 22.5 - fw * 0.45 / Math.max(0.2, Math.cos(el)))) { cr = cr * 0.72 + 70; cg = cg * 0.72 + 70; cb = cb * 0.72 + 70; }
        const shade = 0.55 + 0.45 * Math.sqrt(w); // a little round
        d[o] = cr * shade; d[o + 1] = cg * shade; d[o + 2] = cb * shade; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // markers: in front at their spot, behind the ball at the rim (small, dimmed)
    const mark = (dir, fn) => {
      const n = norm(dir), f = dot(n, N), x = dot(n, Br), y = dot(n, Bu);
      if (f >= 0) fn(r + x * r * 0.97, r - y * r * 0.97, 1);
      else { const l = Math.hypot(x, y) || 1; fn(r + (x / l) * r * 0.86, r - (y / l) * r * 0.86, 0.5); }
    };
    const lw = Math.max(1.5, W / 70), R0 = W * 0.075;
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    if (sp > 0.3) {
      const vel = v3(s.vx, s.vy, s.vz);
      mark(vel, (x, y, a) => { // prograde: circle with three ticks
        ctx.globalAlpha = a; ctx.strokeStyle = PRO; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(x, y, R0 * a, 0, Math.PI * 2);
        ctx.moveTo(x - R0 * a, y); ctx.lineTo(x - R0 * 1.8 * a, y); ctx.moveTo(x + R0 * a, y); ctx.lineTo(x + R0 * 1.8 * a, y); ctx.moveTo(x, y - R0 * a); ctx.lineTo(x, y - R0 * 1.8 * a); ctx.stroke();
      });
      mark(v3(-s.vx, -s.vy, -s.vz), (x, y, a) => { // retrograde: circle with a cross
        ctx.globalAlpha = a; ctx.strokeStyle = PRO; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(x, y, R0 * a, 0, Math.PI * 2);
        const k = R0 * 0.7 * a; ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.stroke();
      });
    }
    // the base: along the ground toward the pad, below the horizon by the height over the distance
    const dist = Math.hypot(s.x, s.z), alt = Math.max(0, S.altitude(s));
    if (dist > 2 || alt > 2) mark(dist > 2 ? v3(-s.x / dist, -alt / Math.max(dist, 1), -s.z / dist) : v3(0, -1, 0), (x, y, a) => {
      ctx.globalAlpha = a; ctx.strokeStyle = TGT; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(x, y, R0 * 0.8 * a, 0, Math.PI * 2);
      ctx.moveTo(x, y - R0 * 1.4 * a); ctx.lineTo(x, y + R0 * 1.4 * a); ctx.moveTo(x - R0 * 1.4 * a, y); ctx.lineTo(x + R0 * 1.4 * a, y); ctx.stroke();
    });
    // the side burn that swings the orbit over the base (cyan diamond): nose there + thrust
    const tm = S.trackMiss(s);
    if (tm && Math.abs(tm.miss) >= 40 && tm.dvMag > S.SIDE_DONE && tm.ahead * s.planet.R > 2500) mark(v3(tm.dv.x, tm.dv.y, tm.dv.z), (x, y, a) => {
      ctx.globalAlpha = a; ctx.strokeStyle = '#8fe3ff'; ctx.lineWidth = lw; const k = R0 * 1.1 * a;
      ctx.beginPath(); ctx.moveTo(x, y - k); ctx.lineTo(x + k, y); ctx.lineTo(x, y + k); ctx.lineTo(x - k, y); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, lw, 0, Math.PI * 2); ctx.fillStyle = '#8fe3ff'; ctx.fill();
    });
    ctx.globalAlpha = 1;
    // the nose: fixed orange chevron in the middle
    ctx.strokeStyle = '#ffb547'; ctx.lineWidth = lw * 1.3; ctx.beginPath();
    ctx.moveTo(r - R0 * 1.6, r); ctx.lineTo(r - R0 * 0.6, r); ctx.lineTo(r, r + R0 * 0.6); ctx.lineTo(r + R0 * 0.6, r); ctx.lineTo(r + R0 * 1.6, r);
    ctx.moveTo(r, r - R0 * 0.2); ctx.lineTo(r, r - R0 * 0.9); ctx.stroke();
  }
  return { draw };
}
