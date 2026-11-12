// Orbit map (orbit levels): a full-screen 2D view of the planet, the lander, its free (Kepler) orbit,
// the predicted path with air and chute, apoapsis / periapsis and the pad. Plane = the approach plane
// (arc x along the track, height y); the pad sits at the top of the planet.
import * as S from './sim.js';

const fmtNum = (n, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
export function fmtAlt(m) {
  if (!isFinite(m)) return '∞';
  return Math.abs(m) >= 10000 ? `${fmtNum(m / 1000, 1)} km` : `${fmtNum(m)} m`;
}
export function fmtTime(t) {
  if (!isFinite(t)) return '–';
  const m = Math.floor(t / 60), sec = Math.floor(t % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function createOrbitMap(canvas) {
  const ctx = canvas.getContext('2d');
  let visible = false;

  function size() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return dpr;
  }

  /** free screen area between the HUD at the top and the controls at the bottom */
  function freeArea(dpr) {
    const W = canvas.width / dpr, H = canvas.height / dpr;
    const ctrl = document.getElementById('controls')?.getBoundingClientRect();
    const top = W < 560 ? 150 : 70;
    const bottom = ctrl && ctrl.top > top + 120 ? ctrl.top - 10 : H - 10;
    const left = W < 560 ? 10 : 290, right = W < 560 ? W - 10 : W - 290;
    return { left, right, top, bottom };
  }

  function draw(s) {
    if (!visible) return;
    const p = s.planet, o = S.orbitInfo(s);
    if (!o) return;
    const dpr = size();
    const W = canvas.width / dpr, H = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const A = freeArea(dpr);
    const R = o.R;
    // scale: planet plus the orbit (apoapsis capped), plus a margin for labels
    const rMax = Math.min(R + Math.max(isFinite(o.ap) ? o.ap : 0, s.y, 2500) * 1.05, R * 3);
    const k = Math.min(A.right - A.left, A.bottom - A.top - 40) / 2 / (rMax * (W < 560 ? 1.22 : 1.1)); // room for labels
    const cx = (A.left + A.right) / 2, cy = (A.top + A.bottom - 40) / 2 + 4;
    const P = (theta, r) => [cx + Math.sin(theta) * r * k, cy - Math.cos(theta) * r * k];

    // atmosphere (density above ~2 % of the surface value) and planet
    if (p.rho > 0) {
      const top = R + p.H * 4;
      const g = ctx.createRadialGradient(cx, cy, R * k, cx, cy, top * k);
      const sky = '#' + p.sky.toString(16).padStart(6, '0');
      g.addColorStop(0, sky + 'aa'); g.addColorStop(1, sky + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, top * k, 0, Math.PI * 2); ctx.fill();
    }
    const c1 = '#' + p.ground.toString(16).padStart(6, '0'), c2 = '#' + p.ground2.toString(16).padStart(6, '0');
    const pg = ctx.createRadialGradient(cx - R * k * 0.3, cy - R * k * 0.3, R * k * 0.1, cx, cy, R * k);
    pg.addColorStop(0, c1); pg.addColorStop(1, c2);
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, Math.PI * 2); ctx.fill();

    // night: the planet's shadow behind it (map plane: longitude around the pad), and where the sun is
    {
      const sx = S.SUN[0], sy = S.SUN[1], l = Math.hypot(sx, sy) || 1, ux = sx / l, uy = -sy / l, nx = -uy, ny = ux, L = rMax * 3 * k;
      ctx.fillStyle = 'rgba(0,0,10,0.55)'; ctx.beginPath();
      ctx.moveTo(cx + nx * R * k, cy + ny * R * k); ctx.lineTo(cx + nx * R * k - ux * L, cy + ny * R * k - uy * L);
      ctx.lineTo(cx - nx * R * k - ux * L, cy - ny * R * k - uy * L); ctx.lineTo(cx - nx * R * k, cy - ny * R * k); ctx.closePath(); ctx.fill();
      const sr = Math.min(A.right - cx, cx - A.left, (A.bottom - A.top) / 2) - 14, px2 = cx + ux * sr, py2 = cy + uy * sr;
      ctx.fillStyle = '#fff3b0'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('☀', px2, py2 + 5);
    }
    // pad
    const [px, py] = P(0, R);
    ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillText('ZIEL', px, py - 9);

    // free orbit (vacuum): dashed, faint where it runs below the surface
    const nuMax = o.e < 1 ? Math.PI : Math.acos(-1 / o.e) - 0.02;
    ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
    let prevBelow = null;
    ctx.beginPath();
    for (let i = 0; i <= 240; i++) {
      const nu = -nuMax + (2 * nuMax * i) / 240, r = o.p / (1 + o.e * Math.cos(nu));
      if (!(r > 0) || r > R * 6) { prevBelow = null; continue; }
      const below = r < R;
      const [x, y] = P(o.omega + o.dir * nu, r);
      if (below !== prevBelow) {
        if (prevBelow !== null) { ctx.lineTo(x, y); ctx.stroke(); }
        ctx.beginPath(); ctx.strokeStyle = below ? 'rgba(143,227,255,0.18)' : 'rgba(143,227,255,0.75)'; ctx.moveTo(x, y);
        prevBelow = below;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);

    // predicted path with air and chute (what will really happen without thrust), and the impact
    const path = s.predPath;
    if (path && path.length > 3) {
      ctx.strokeStyle = 'rgba(255,181,71,0.95)'; ctx.lineWidth = 2.2; ctx.beginPath();
      for (let i = 0; i < path.length; i += 2) { const [x, y] = P(path[i] / R, R + path[i + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      if (s.pred) {
        const [x, y] = P(s.pred.x / R, R);
        ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2.5; ctx.beginPath();
        ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
      }
    }

    // apoapsis / periapsis markers
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    const mark = (nu, label, alt, t) => {
      const r = o.p / (1 + o.e * Math.cos(nu));
      if (!(r > 0) || !isFinite(r)) return;
      const th = o.omega + o.dir * nu, [x, y] = P(th, r), [ox, oy] = P(th, r + 14 / k);
      ctx.fillStyle = '#8fe3ff'; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 4, y); ctx.fill();
      ctx.fillStyle = '#d7f4ff'; ctx.textAlign = 'center';
      const txt = `${label} ${fmtAlt(alt)}`, half = ctx.measureText(txt).width / 2 + 4;
      const lx2 = Math.min(A.right - half, Math.max(A.left + half, ox)); // keep the label on screen
      ctx.fillText(txt, lx2, oy - 2);
      if (isFinite(t)) { ctx.fillStyle = 'rgba(215,244,255,0.65)'; ctx.fillText(`in ${fmtTime(t)}`, lx2, oy + 11); }
    };
    if (o.e > 0.002) {
      if (o.e < 1) mark(Math.PI, 'Ap', o.ap, o.tAp);
      mark(0, 'Pe', o.pe, o.tPe);
    }

    // the lander, pointing along its velocity
    const th = s.x / R, [lx, ly] = P(th, R + s.y);
    const vxs = Math.cos(th) * s.vx * 1 + Math.sin(th) * s.vy, vys = Math.sin(th) * s.vx - Math.cos(th) * s.vy;
    const ang = Math.atan2(vys, vxs);
    ctx.save(); ctx.translate(lx, ly); ctx.rotate(ang);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();

    // orbit computer readout under the map
    // one line: Ap/Pe are on the map already; time to touchdown and how far the cross is off the pad
    const lines = [];
    if (o.escape) lines.push('Fluchtbahn');
    else if (s.pred) lines.push(`⏱ ${fmtTime(s.pred.t)} · 🎯 ${s.pred.x < 0 ? '−' : '+'}${fmtAlt(Math.abs(Math.hypot(s.pred.x, s.pred.z)))}`);
    else lines.push(p.rho > 0 ? '⏱ – · Luft bremst langsam' : '⏱ – · stabiler Orbit');
    const tm = S.trackMiss(s);
    if (tm && Math.abs(tm.miss) >= 40) lines[lines.length - 1] += ` · ↔ ${fmtAlt(Math.abs(tm.miss))} neben der Basis`;
    ctx.textAlign = 'center'; ctx.font = '600 12px "IBM Plex Mono", monospace';
    const by = A.bottom - 6 - (lines.length - 1) * 16;
    lines.forEach((l, i) => {
      ctx.fillStyle = 'rgba(5,8,14,0.7)';
      const w = ctx.measureText(l).width + 14;
      ctx.fillRect(cx - w / 2, by + i * 16 - 12, w, 16);
      ctx.fillStyle = i === 0 ? '#d7f4ff' : 'rgba(215,244,255,0.8)';
      ctx.fillText(l, cx, by + i * 16);
    });
    ctx.textAlign = 'left';
  }

  return {
    draw,
    get visible() { return visible; },
    set visible(v) { visible = v; canvas.hidden = !v; if (!v) ctx.clearRect(0, 0, canvas.width, canvas.height); },
  };
}
