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
  let visible = false, view = 'side'; // 'side': the orbit seen from the side, 'top': the ground track from above

  function size() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return dpr;
  }

  /** the map card: the screen area left free by the panels around it (measured, so it fits any layout:
   *  phone, tablet portrait / landscape, desktop) */
  let card = null;
  function freeArea(dpr) {
    const W = canvas.width / dpr, H = canvas.height / dpr, phone = W < 560;
    const box = (id) => { const e = document.getElementById(id); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width > 4 && b.height > 4 ? b : null; };
    let left = 10, right = W - 10, top = phone ? 150 : 70;
    if (phone) { const rd = box('radar'); if (rd) top = Math.max(top, rd.bottom + 6); } // below the compass
    if (!phone) {
      const lc = box('leftcol'); if (lc && lc.right < W * 0.45) left = lc.right + 12;
      for (const id of ['burn', 'side']) { const b = box(id); if (b && b.left > W * 0.55 && b.top < H * 0.5) right = Math.min(right, b.left - 12); }
      const ro = box('readout'); if (ro && ro.left < right && ro.right > left) top = Math.max(top, ro.bottom + 10);
    }
    const ctrl = document.getElementById('controls')?.getBoundingClientRect();
    let bottom = ctrl && ctrl.top > top + 160 ? ctrl.top - 10 : H - 10;
    const pc = box('plan-chips'); if (pc && pc.top > top + 160) bottom = Math.min(bottom, pc.top - 8); // room for the plan chips
    card = { left, right, top, bottom };
    // the content inside the card: a row at the top for the view switch
    return { left: left + 8, right: right - 8, top: top + 46, bottom: bottom - 6 };
  }
  /** the card's frame (both views) */
  function drawCard() {
    if (!card) return;
    const { left, right, top, bottom } = card, r = 12;
    ctx.fillStyle = 'rgba(9,13,22,0.72)'; ctx.strokeStyle = 'rgba(160,200,255,0.16)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(left, top, right - left, bottom - top, r) : ctx.rect(left, top, right - left, bottom - top);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(215,244,255,0.55)'; ctx.font = '700 10px "Chakra Petch", sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(view === 'top' ? 'DRAUFSICHT · BODENSPUR' : 'BAHN', left + 12, top + 24);
  }

  /** top view: the ground track around the base, sideways stretched so a miss of a kilometre is plain to see */
  function drawTop(s, o, A) {
    const gt = S.groundTrack(s, 512);
    const cx = (A.left + A.right) / 2, cy = (A.top + A.bottom - 40) / 2 + 4, w = A.right - A.left - 16, h = A.bottom - A.top - 70;
    const tm = S.trackMiss(s), miss = tm ? Math.abs(tm.miss) : 0;
    const L = Math.min(Math.PI * s.planet.R * 0.95, Math.max(6000, Math.abs(s.x) * 1.15)); // along the track: base and lander in view
    const Z = Math.max(600, miss * 2.4, Math.abs(s.z) * 1.6); // across: the miss fills about half the height
    const X = (x) => cx + (x / L) * (w / 2), Y = (z) => cy - (z / Z) * (h / 2);
    const ex = Math.max(1, Math.round((h / 2 / Z) / (w / 2 / L)));
    // frame, the pad's east-west line, km ticks along it
    ctx.strokeStyle = 'rgba(160,200,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(-L), Y(0)); ctx.lineTo(X(L), Y(0)); ctx.stroke();
    const step = L > 15000 ? 5000 : 2000;
    ctx.fillStyle = 'rgba(215,244,255,0.45)'; ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
    for (let x = -Math.floor(L / step) * step; x <= L; x += step) { ctx.beginPath(); ctx.moveTo(X(x), Y(0) - 3); ctx.lineTo(X(x), Y(0) + 3); ctx.stroke(); if (x) ctx.fillText(`${x / 1000} km`, X(x), Y(0) + 15); }
    // the ground track (breaks where it wraps round the planet)
    if (gt) {
      ctx.strokeStyle = '#8fe3ff'; ctx.lineWidth = 2.5; ctx.beginPath();
      let pen = false, last = null;
      for (const q of gt.pts) {
        const ok = Math.abs(q.x) <= L * 1.05 && Math.abs(q.z) <= Z * 1.2 && (!last || Math.abs(q.x - last.x) < L);
        if (!ok) { pen = false; last = q; continue; }
        pen ? ctx.lineTo(X(q.x), Y(q.z)) : ctx.moveTo(X(q.x), Y(q.z)); pen = true; last = q;
      }
      ctx.stroke();
      // the miss: from the base square onto the track
      if (miss >= 40) {
        const c = gt.pts.reduce((b, q) => (Math.hypot(q.x, q.z) < Math.hypot(b.x, b.z) ? q : b));
        ctx.setLineDash([4, 4]); ctx.strokeStyle = '#c58bff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(c.x), Y(c.z)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#c58bff'; ctx.font = '700 12px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
        ctx.fillText(`${fmtAlt(miss)} ${gt.side > 0 ? '▲' : '▼'}`, X(c.x) + 10, (Y(0) + Y(c.z)) / 2 + 4);
      }
    }
    // the base and the lander (arrow along its ground track, stretched like the map)
    ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.arc(X(0), Y(0), 5, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'right'; ctx.fillText('BASIS', X(0) - 9, Y(0) + 4);
    if (Math.abs(s.x) <= L) {
      const ang = Math.atan2(-(s.vz / Z) * (h / 2), (s.vx / L) * (w / 2));
      ctx.save(); ctx.translate(X(s.x), Y(s.z)); ctx.rotate(ang);
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(215,244,255,0.6)'; ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(`quer ×${ex} gestreckt`, A.left + 8, A.bottom - 30); // (the switch below says which view)
    readout(s, o, A, cx);
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
    drawCard();
    if (view === 'top') { drawTop(s, o, A); return; }
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

    // a module in orbit: its orbit, where it is, and the meeting markers (closest approach: both positions then)
    if (s.target?.dock && !s.target.docked) {
      const o = s.target, T = S.inertial(s, o.x, o.y, o.z, o.vx, o.vy, o.vz), rm = Math.hypot(...T.r);
      const ang = (r) => Math.atan2(r[0], r[1]);
      ctx.setLineDash([3, 6]); ctx.strokeStyle = 'rgba(255,181,71,0.45)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, rm * k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      const [mx, my] = P(ang(T.r), rm);
      ctx.fillStyle = '#ffb547'; ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill();
      const ca = S.closestApproach(s);
      if (ca && ca.t > 1) {
        const [ax, ay] = P(ang(ca.rl), Math.hypot(...ca.rl)), [bx, by] = P(ang(ca.rm), Math.hypot(...ca.rm));
        ctx.strokeStyle = ca.d < 1500 ? '#5fe0a0' : '#ffb547'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.beginPath(); ctx.arc(ax, ay, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle; ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
        ctx.fillText(`${fmtAlt(ca.d)} · ${fmtTime(ca.t)}`, (ax + bx) / 2, Math.min(ay, by) - 12);
      }
    }
    // the lander, pointing along its velocity
    const th = s.x / R, [lx, ly] = P(th, R + s.y);
    const vxs = Math.cos(th) * s.vx * 1 + Math.sin(th) * s.vy, vys = Math.sin(th) * s.vx - Math.cos(th) * s.vy;
    const ang = Math.atan2(vys, vxs);
    ctx.save(); ctx.translate(lx, ly); ctx.rotate(ang);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();

    readout(s, o, A, cx);
  }

  /** the one-line orbit computer readout under the map (both views) */
  function readout(s, o, A, cx) {
    const p = s.planet;
    // one line: Ap/Pe are on the map already; time to touchdown and how far the cross is off the pad
    const lines = [];
    if (o.escape) lines.push('Fluchtbahn');
    else if (s.pred) lines.push(`⏱ ${fmtTime(s.pred.t)} · 🎯 ${s.pred.x < 0 ? '−' : '+'}${fmtAlt(Math.abs(Math.hypot(s.pred.x, s.pred.z)))}`);
    else lines.push(p.rho > 0 ? '⏱ – · Luft bremst langsam' : '⏱ – · stabiler Orbit');
    const tm = S.trackMiss(s);
    if (tm && Math.abs(tm.miss) >= 40) lines[lines.length - 1] += ` · ↔ ${fmtAlt(Math.abs(tm.miss))} neben der Basis`;
    const ca = s.target?.dock && !s.target.docked ? S.closestApproach(s) : null;
    if (ca) lines[lines.length - 1] = `⇄ Begegnung ${fmtAlt(ca.d)}${ca.t > 1 ? ` in ${fmtTime(ca.t)}` : ''}`;
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
    get view() { return view; },
    get card() { return card; },
    set view(v) { view = v === 'top' ? 'top' : 'side'; },
    set visible(v) { visible = v; canvas.hidden = !v; if (!v) ctx.clearRect(0, 0, canvas.width, canvas.height); },
  };
}
