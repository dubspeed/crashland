import * as S from './sim.js';
import { createCrew } from './crew.js';
import { fmtAlt, fmtTime } from './orbitmap.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const cls = (el, c) => { el.className = c || ''; };
// button caption + keyboard shortcut; only touches the DOM when the text changes, so the node under
// the mouse isn't replaced every frame (that can swallow clicks)
// control icons (24×24, stroke = currentColor); a button names its icon in data-icon
export const ICONS = {
  chute: '<path d="M3 11a9 7 0 0 1 18 0z"/><path d="M3 11l9 9 9-9M12 11v9"/>',
  panels: '<path d="M2 8h8v8H2zM14 8h8v8h-8z"/><path d="M10 12h4M6 8v8M18 8v8"/>',
  shield: '<path d="M3 8c3 2 15 2 18 0l-2 6c-3 2-11 2-14 0z"/><path d="M12 15v6M9 19l3 2 3-2"/>',
  sas: '<circle cx="12" cy="12" r="8"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/><circle cx="12" cy="12" r="1.5"/>',
  view: '<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>',
  com: '<circle cx="12" cy="12" r="7"/><path d="M12 5v14M5 12h14"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
};
/** button label: icon (from data-icon), a short word, the keyboard shortcut (desktop); title = what it does */
export function setLabel(el, text, key, title, badge) {
  const k = `${text}|${title ?? ''}|${badge ?? ''}`;
  if (el.dataset.label === k) return;
  el.dataset.label = k;
  const ic = ICONS[el.dataset.icon];
  // icon buttons show no word (it's in the help and the title); a badge carries a mode (Retro 2, Ziel)
  el.innerHTML = `${ic ? `<svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>` : ''}${ic ? '' : `<span class="t">${text}</span>`}${badge ? `<b class="badge">${badge}</b>` : ''}${key ? `<kbd>${key}</kbd>` : ''}`;
  el.title = title ?? text;
  el.setAttribute('aria-label', title ?? text);
}

export function createHud() {
  const list = $('part-list');
  const rows = {};
  const partRows = [
    ['capsule', 'Kommandokapsel'], ['engine', 'Antrieb'], ['tankL', 'Tank L'], ['tankR', 'Tank R'],
    ['battery', 'Batterien'], ['solar', 'Solarpaneele'], ['computer', 'Bordcomputer'], ['chute', 'Fallschirm'], ['legs', 'Landebeine'],
    ['shield', 'Hitzeschild'],
  ];
  for (const [id, label] of partRows) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${label}</span><span></span><div class="bar"><i></i></div>`;
    list.append(li);
    rows[id] = { val: li.children[1], bar: li.querySelector('i'), li };
  }
  const setRow = (id, text, frac, color) => {
    rows[id].val.textContent = text;
    rows[id].bar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    rows[id].bar.style.background = color || 'var(--ok)';
  };

  // landing window bars
  const lw = {};
  const lwDefs = [
    ['vy', 'Sinkrate', 'm/s', 10], ['vx', 'Drift', 'm/s', 6], ['tilt', 'Neigung', '°', 25],
  ];
  const tierColors = ['var(--ok)', 'var(--warn)', 'var(--amber)', 'rgba(255,93,82,0.75)'];
  const glyphs = { vy: '↓', vx: '↔', tilt: '∠' };
  for (const [key, label, unit, max] of lwDefs) {
    const lim = S.LAND[key];
    const stops = [0, ...lim.map((l) => (l / max) * 100), 100];
    const grad = tierColors.map((c, i) => `${c} ${stops[i]}% ${stops[i + 1]}%`).join(', ');
    const el = document.createElement('div');
    el.className = 'lw';
    el.innerHTML = `<i class="glyph" aria-hidden="true">${glyphs[key]}</i><div class="lw-head"><span>${label}</span><b></b></div><div class="lw-bar" style="background: linear-gradient(90deg, ${grad})"><i></i></div><b class="lw-num"></b>`;
    $('landing').append(el);
    lw[key] = { val: el.querySelector('.lw-head b'), num: el.querySelector('.lw-num'), mark: el.querySelector('.lw-bar i'), bar: el.querySelector('.lw-bar'), unit, max };
  }
  let landFor = null;
  function applyLand(land) {
    if (landFor === land) return;
    landFor = land;
    for (const [key, , , max] of lwDefs) {
      const stops = [0, ...land[key].map((l) => (l / max) * 100), 100];
      lw[key].bar.style.background = `linear-gradient(90deg, ${tierColors.map((c, i) => `${c} ${stops[i]}% ${stops[i + 1]}%`).join(', ')})`;
    }
    tdStops = [0, ...land.vy, S.WRECK_V, TD_MAX];
    $('td-scale').style.background = `linear-gradient(90deg, ${tdColors.map((c, i) => `${c} ${(tdStops[i] / TD_MAX) * 100}% ${(tdStops[i + 1] / TD_MAX) * 100}%`).join(', ')})`;
    $('td-ticks').innerHTML = tdStops.slice(1, -1).map((v) => `<span style="left:${(v / TD_MAX) * 100}%">${fmt(v, v % 1 ? 1 : 0)}</span>`).join('')
      + tdNames.map((n, i) => `<em style="left:${((tdStops[i] + tdStops[i + 1]) / 2 / TD_MAX) * 100}%">${n}</em>`).join('');
  }

  // big touchdown gauge: sink-rate scale with the exact limits, shown close to the ground
  const TD_MAX = 18;
  let tdStops = [0, ...S.LAND.vy, S.WRECK_V, TD_MAX];
  const tdNames = ['Sanft', 'Hart', 'Schaden', 'Bruch', 'Explosion'];
  const tdColors = ['var(--ok)', 'var(--warn)', 'var(--amber)', 'var(--bad)', '#8e1d16'];
  $('td-scale').style.background = `linear-gradient(90deg, ${tdColors.map((c, i) => `${c} ${(tdStops[i] / TD_MAX) * 100}% ${(tdStops[i + 1] / TD_MAX) * 100}%`).join(', ')})`;
  $('td-ticks').innerHTML = tdStops.slice(1, -1).map((v) => `<span style="left:${(v / TD_MAX) * 100}%">${fmt(v, v % 1 ? 1 : 0)}</span>`).join('')
    + tdNames.map((n, i) => `<em style="left:${((tdStops[i] + tdStops[i + 1]) / 2 / TD_MAX) * 100}%">${n}</em>`).join('');
  function tdZone(v, fuelLeft) {
    const i = [...tdStops.slice(1, 4), S.WRECK_V].findIndex((l) => v <= l);
    const k = i < 0 ? 4 : i;
    return k === 4 && fuelLeft <= 10 ? 3 : k; // no fuel, no explosion
  }

  // keep the touchdown bar clear of the controls: measure where they end and sit just above them
  const landscape = matchMedia('(max-height: 520px)');
  function placeGauge(td) {
    td.style.bottom = ''; td.style.top = '';
    if (landscape.matches) return; // landscape: the bar sits at the top centre
    const tr = td.getBoundingClientRect();
    let top = Infinity;
    for (const el of document.querySelectorAll('#controls .toggles, #controls .rcs, #controls .lever')) {
      const q = el.getBoundingClientRect();
      if (q.width && q.right > tr.left && q.left < tr.right && q.top < tr.bottom) top = Math.min(top, q.top);
    }
    if (!isFinite(top)) return;
    const bottom = innerHeight - top + 16;
    if (innerHeight - bottom - tr.height < innerHeight * 0.55) {
      // not enough room between lander and controls (small phones): right under the altitude readout
      const ro = $('readout').getBoundingClientRect();
      td.style.bottom = 'auto';
      td.style.top = `${Math.round((ro.height ? ro.bottom : 118) + 8)}px`;
    } else {
      td.style.top = '';
      td.style.bottom = `${Math.round(bottom)}px`;
    }
  }

  let crewTick = 0;
  const crew = createCrew($('crew-faces'), $('crew-say'));
  let tornAt, cargoAt;

  const heatFrac = (s, id) => { const c = s.spec.comps.find((k) => k.id === id); return c ? (s.temp[id] - S.T_AMB) / (c.heat[1] - S.T_AMB) : 0; };
  const lostAt = {};
  const pw = { inp: 0, use: 0 };
  const ttb = { at: undefined, v: 0 };

  function recentLoss(s) {
    for (const c of s.spec.comps) if (s.lost[c.id] && s.t - (lostAt[c.id] ??= s.t) < 3) return c.name;
    return null;
  }
  function hottest(s) {
    let best = { f: 0, name: '' };
    for (const c of s.spec.comps) if (c.heat && !s.lost[c.id] && !s.dropped[c.id]) { const f = heatFrac(s, c.id); if (f > best.f) best = { f, name: c.name, solar: c.id === 'solarL' || c.id === 'solarR' }; }
    return best;
  }

  /** heat shield row: is the shield facing the airflow? */
  function facingText(s) {
    if (!s.spec.ids.has('shield')) return '';
    if (s.lost.shield) return 'verglüht';
    if (s.dropped.shield) return 'abgeworfen';
    const u = S.upVector(s), v = Math.hypot(s.vx, s.vy, s.vz) || 1;
    const f = -(s.vx * u.x + s.vy * u.y + s.vz * u.z) / v;
    return f > 0.85 ? 'vorn' : f > 0.4 ? 'schräg' : 'seitlich';
  }
  /** Arrow glyph for a world direction (x, z) as seen on screen (up = away from the camera). */
  function screenArrow(dx, dz, yaw) {
    const right = dx * Math.cos(yaw) - dz * Math.sin(yaw), fwd = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
    const i = Math.round(Math.atan2(right, fwd) / (Math.PI / 4));
    return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][(i + 8) % 8];
  }

  // radar compass: top-down view around the lander, oriented like the camera
  const radar = $('radar'), rctx = radar.getContext('2d');
  function drawRadar(s, yaw) {
    const px = Math.round(radar.clientWidth * Math.min(2, devicePixelRatio || 1));
    if (!px) return;
    if (radar.width !== px) radar.width = radar.height = px;
    const c = rctx, R = px / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, px, px);
    c.translate(R, R);
    const k = R / 50; // drawing units: radius 50
    c.scale(k, k);
    // world (x, z) -> radar (right, up) for a camera at yaw looking at the lander
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const toR = (dx, dz) => [dx * cy - dz * sy, dx * sy + dz * cy];
    const RANGE = 600, scale = (d) => (44 * Math.log1p(d / 25)) / Math.log1p(RANGE / 25);
    const place = (dx, dz) => { const d = Math.hypot(dx, dz); const [x, y] = toR(dx, dz); const f = d > 0.01 ? Math.min(44, scale(d)) / d : 0; return [x * f, y * f, d]; };
    // backdrop + rings at 70 m (flat zone size) and 300 m
    c.beginPath(); c.arc(0, 0, 48, 0, Math.PI * 2); c.fillStyle = 'rgba(9,13,22,0.55)'; c.fill();
    c.strokeStyle = 'rgba(160,200,255,0.25)'; c.lineWidth = 1;
    for (const d of [70, 300]) { c.beginPath(); c.arc(0, 0, scale(d), 0, Math.PI * 2); c.stroke(); }
    // landing pad + flat zone
    const [padX, padY, padD] = place(-s.x, -s.z);
    const far = padD > RANGE;
    c.beginPath(); c.arc(padX, padY, Math.max(3, scale(padD + 70) - scale(padD)), 0, Math.PI * 2); c.fillStyle = 'rgba(95,224,160,0.18)'; c.fill();
    c.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; c.lineTo(padX + Math.cos(a) * 4.5, padY + Math.sin(a) * 4.5); }
    c.closePath(); c.fillStyle = '#f2c230'; c.fill(); c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1.2; c.stroke();
    // wind: arrow from the edge it comes from, pointing downwind
    if (s.planet.rho > 0 && s.wind.speed) {
      const ws = Math.hypot(s.windX, s.windZ) || 1;
      const [wx, wy] = s.windNow > 0.1 ? toR(s.windX / ws, s.windZ / ws) : toR(Math.cos(s.wind.heading), Math.sin(s.wind.heading));
      const len = 10 + Math.min(1, Math.abs(s.windNow) / 26) * 22;
      const sx = -wx * 46, sy2 = -wy * 46, ex = sx + wx * len, ey = sy2 + wy * len;
      c.strokeStyle = '#8fe3ff'; c.fillStyle = '#8fe3ff'; c.lineWidth = 3; c.lineCap = 'round';
      c.beginPath(); c.moveTo(sx, sy2); c.lineTo(ex, ey); c.stroke();
      c.beginPath(); c.moveTo(ex + wx * 5, ey + wy * 5); c.lineTo(ex - wy * 4, ey + wx * 4); c.lineTo(ex + wy * 4, ey - wx * 4); c.closePath(); c.fill();
    }
    // base modules (grey squares): don't land on them
    for (const o of s.obstacles ?? []) {
      const [ox, oy] = place(o.x - s.x, o.z - s.z);
      c.fillStyle = 'rgba(220,226,240,0.85)'; c.fillRect(ox - 2.5, oy - 2.5, 5, 5);
    }
    // predicted touchdown point (orange cross)
    if (s.pred && s.status === 'flying') {
      const [ix, iy] = place(s.pred.x - s.x, s.pred.z - s.z);
      c.strokeStyle = '#ffb547'; c.lineWidth = 2.2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(ix - 3.5, iy - 3.5); c.lineTo(ix + 3.5, iy + 3.5); c.moveTo(ix + 3.5, iy - 3.5); c.lineTo(ix - 3.5, iy + 3.5); c.stroke();
    }
    // own motion (where you drift to in the next ~10 s)
    const [mx, my] = place(s.vx * 10, s.vz * 10);
    const ml = Math.hypot(mx, my);
    if (ml > 2) {
      const ux = mx / ml, uy = my / ml;
      c.strokeStyle = '#ffffff'; c.fillStyle = '#ffffff'; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(mx - ux * 3, my - uy * 3); c.stroke();
      c.beginPath(); c.moveTo(mx + ux * 2, my + uy * 2); c.lineTo(mx - ux * 4 - uy * 3.5, my - uy * 4 + ux * 3.5); c.lineTo(mx - ux * 4 + uy * 3.5, my - uy * 4 - ux * 3.5); c.closePath(); c.fill();
    }
    // lander in the centre
    c.beginPath(); c.moveTo(0, -5); c.lineTo(4.5, 4); c.lineTo(-4.5, 4); c.closePath(); c.fillStyle = '#ffb547'; c.fill();
    // distance to the pad, at the bottom of the dial
    if (padD > 10) {
      c.font = "600 11px 'IBM Plex Mono', monospace"; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.fillStyle = padD > 70 ? '#ffd04d' : '#5fe0a0';
      const txt = `${Math.round(padD)} m`;
      c.strokeText(txt, 0, 37); c.fillText(txt, 0, 37);
    }
  }

  function update(s, input, yaw = 0.35) {
    drawRadar(s, yaw);
    if (s.t < 0.05) for (const k in lostAt) delete lostAt[k];
    const p = s.planet;
    const alt = Math.max(0, S.altitude(s));
    const { m, cx, cy } = S.massProps(s);
    const tilt = S.tiltDeg(s);

    $('planet-tag').textContent = `${p.name} · ${fmt(p.g, 2)} m/s² · ${fmt(p.g / S.G0, 2)} g`;
    $('v-alt').textContent = `${fmt(alt, alt < 100 ? 1 : 0)} m`;
    const live = { vy: Math.max(0, -s.vy), vx: S.drift(s), tilt };
    if (s.touch) Object.assign(live, { vy: s.touch.vy, vx: s.touch.vx, tilt: s.touch.tilt });
    applyLand(s.spec.land);
    const L = s.spec.land;
    const gr = { vy: S.grade(live.vy, L.vy), vx: S.grade(live.vx, L.vx), tilt: S.grade(live.tilt, L.tilt) };
    for (const k of Object.keys(lw)) {
      const g = S.GRADES[gr[k]];
      lw[k].val.textContent = `${fmt(live[k], 1)} ${lw[k].unit} · ${g.name.split(' ')[0]}`;
      lw[k].val.style.color = g.color;
      lw[k].num.textContent = k === 'tilt' ? `${fmt(live[k], 0)}°` : fmt(live[k], 1);
      lw[k].num.style.color = g.color;
      lw[k].mark.style.left = `${Math.min(1, live[k] / lw[k].max) * 100}%`;
    }
    const gradeCls = ['ok', 'warn', 'warn', 'bad'];
    const twr = (s.spec.fMax * s.limit) / (m * p.g);
    const tw = $('v-twr'); tw.textContent = fmt(twr, 2); cls(tw, twr > 1.15 ? '' : 'bad');
    $('v-mass').textContent = `${fmt(m)} kg`;

    // navigation: wind and where the pad is
    const vw = $('v-wind');
    if (p.rho > 0 && s.wind.speed) {
      const w = s.windNow, gust = Math.abs(w) > s.wind.speed * (0.35 + 0.65 * Math.min(1, Math.max(0, alt) / 300)) * 1.25;
      vw.innerHTML = `Wind <b>${screenArrow(s.windX, s.windZ, yaw)} ${fmt(Math.abs(w), 0)} m/s</b>${gust ? ' <em>Böe</em>' : ''}`;
      vw.hidden = false;
    } else vw.hidden = true;
    const padDist = Math.hypot(s.x, s.z);
    const vp = $('v-pad');
    vp.innerHTML = padDist < 10 ? 'Landeplatz <b>unter dir</b>' : `Landeplatz <b>${screenArrow(-s.x, -s.z, yaw)} ${fmt(padDist, 0)} m</b>`;
    vp.className = padDist < 10 ? 'ok' : padDist > 70 ? 'warn' : '';
    if (s.pred && s.status === 'flying' && padDist >= 10) {
      const miss = Math.hypot(s.pred.x, s.pred.z);
      vp.innerHTML += ` <span class="aim">· Kreuz ${miss < 4 ? 'auf dem Pad' : `${fmt(miss, 0)} m daneben`}</span>`;
    }

    // big readout: altitude above ground (large below 1000 m) and both speeds, coloured by the landing window
    {
      const ro = $('readout');
      ro.hidden = s.status !== 'flying';
      const low = alt < 1000;
      ro.classList.toggle('low', low);
      const altTxt = alt >= 1000 ? `${fmt(alt / 1000, 1)} km` : `${fmt(Math.max(0, alt), alt < 100 ? 1 : 0)} m`;
      const tone = ['ok', 'warn', 'amber', 'bad'];
      const sink = -s.vy, vh = S.drift(s);
      const vyCls = low && sink > 0 ? tone[S.grade(sink, L.vy)] : '';
      const vhCls = low ? tone[S.grade(vh, L.vx)] : '';
      const vyTxt = `${s.vy <= 0 ? '↓' : '↑'} ${fmt(Math.abs(s.vy), Math.abs(s.vy) < 100 ? 1 : 0)} m/s`, vhTxt = `→ ${fmt(vh, vh < 100 ? 1 : 0)} m/s`;
      const key = altTxt + vyTxt + vhTxt + vyCls + vhCls;
      if (ro.dataset.k !== key) {
        ro.dataset.k = key;
        $('ro-alt').textContent = altTxt;
        const a = $('ro-vy'), b = $('ro-vh');
        a.textContent = vyTxt; a.className = vyCls; b.textContent = vhTxt; b.className = vhCls;
      }
    }

    // orbit computer line (orbit levels): apoapsis / periapsis while still high and fast
    const vo = $('v-orbit');
    const oi = p.orbit && s.status === 'flying' && (alt > 600 || Math.hypot(s.vx, s.vz) > 40) ? S.orbitInfo(s) : null;
    vo.hidden = !oi;
    if (oi) {
      const txt = oi.escape ? 'Fluchtbahn' : `Ap <b>${fmtAlt(oi.ap)}</b> · Pe <b>${oi.pe < 0 ? 'Boden' : fmtAlt(oi.pe)}</b>${oi.pe > 0 && isFinite(oi.tAp) ? ` · Ap in ${fmtTime(oi.tAp)}` : ''}`;
      if (vo.dataset.t !== txt) { vo.dataset.t = txt; vo.innerHTML = txt; }
    }

    // touchdown gauge
    const td = $('td');
    const showTd = s.status === 'flying' && alt < 80 && s.vy < -0.2;
    td.hidden = !showTd;
    if (showTd) placeGauge(td);
    if (showTd) {
      const v = -s.vy, z = tdZone(v, S.fuel(s));
      $('td-v').textContent = fmt(v, 1);
      $('td-v').style.color = tdColors[z];
      $('td-grade').textContent = tdNames[z].toUpperCase();
      $('td-grade').style.color = tdColors[z];
      $('td-mark').style.left = `${Math.min(1, v / TD_MAX) * 100}%`;
      td.classList.toggle('danger', z >= 3);
      const sub = (label, val, g) => `<span style="color:${S.GRADES[g].color}">${label} ${val}</span>`;
      $('td-sub').innerHTML = `<span>${fmt(alt, alt < 10 ? 1 : 0)} m</span>` + sub('Drift', `${fmt(live.vx, 1)} m/s`, gr.vx) + sub('Neigung', `${fmt(live.tilt, 0)}°`, gr.tilt);
    }

    // crew: faces, g-load, tunnel vision from the pilot's strain
    const g = $('v-g'); g.textContent = `${fmt(s.status === 'flying' ? s.gNow : 0, 2)} g`;
    const minLimit = S.gLimitOf(s);
    cls(g, s.gNow > S.G_LIMIT ? 'bad' : s.gNow > minLimit ? 'warn' : '');
    // faces at ~30 fps are plenty
    if (!(crewTick = (crewTick + 1) % 2) || s.status !== 'flying') crew.update(s, alt, gr.vy === 3, performance.now() / 1000);
    const pilot = s.crew[0];
    $('tunnel').style.opacity = s.status === 'flying' && pilot ? Math.min(0.97, pilot.out ? 0.97 : pilot.stress ** 1.3 * 0.9) : 0;
    // cargo flights: a cargo card instead of the faces (g-load against what it takes, intact / damaged)
    const pl = s.spec.payload;
    $('cargo').hidden = !pl; $('crew-faces').hidden = !!pl; $('crew-h').textContent = pl ? 'Fracht · G-Last' : 'Crew · G-Last'; $('crew').classList.toggle('cargo-mode', !!pl);
    if (pl) {
      const c = S.CARGO[pl.id];
      $('cg-name').textContent = c.name;
      const st = s.status === 'crashed' ? ['verloren', 'bad'] : s.cargoDamaged ? [`beschädigt (${s.cargoDamaged})`, 'bad'] : ['intakt', 'ok'];
      $('cg-state').textContent = st[0]; $('cg-state').className = st[1];
      const gk = Math.min(1, (s.status === 'flying' ? s.gNow : 0) / (pl.g * 1.25));
      $('cg-g').style.width = `${gk * 100}%`;
      $('cg-g').style.background = s.gNow > pl.g ? 'var(--bad)' : s.gNow > pl.g * 0.8 ? 'var(--warn)' : 'var(--cyan)';
      $('cg-lim').style.left = `${(1 / 1.25) * 100}%`;
      $('cg-info').textContent = `max ${pl.g} g · Aufsetzen ≤ ${pl.touch} m/s`;
    }


    // fuel: amount and how long it lasts at full thrust
    const fuelNow = S.fuel(s), fuelFrac = fuelNow / s.fuel0;
    const fullBurn = fuelNow / (s.spec.fMax / (s.spec.isp * S.G0));
    const vf = $('v-fuel'); vf.textContent = `${fmt(fuelNow)} kg`;
    cls(vf, `big ${fuelFrac < 0.1 ? 'bad' : fuelFrac < 0.25 ? 'warn' : ''}`);
    $('v-fuelpct').textContent = `${fmt(fuelFrac * 100)} %`;
    $('v-burntime').textContent = `reicht für ${fmt(fullBurn, 1)} s Vollschub`;
    const bf = $('b-fuel');
    bf.style.width = `${fuelFrac * 100}%`;
    bf.style.background = fuelFrac < 0.1 ? 'var(--bad)' : fuelFrac < 0.25 ? 'var(--warn)' : 'var(--amber)';

    // burn gauge: altitude vs stopping distance on one scale
    const d = S.stoppingDistance(s);
    const burnAlt = S.burnAltitude(s);
    const scale = Math.max(p.alt, alt) * 1.05;
    const gauge = $('burn-gauge');
    gauge.style.opacity = s.computerOK ? 1 : 0.25;
    $('burn-stop').style.height = `${Math.min(1, burnAlt / scale) * 100}%`;
    $('burn-alt').style.bottom = `calc(${Math.min(1, alt / scale) * 100}% - 1px)`;
    const bl = $('burn-label');
    let label = '', lc = 'mute';
    if (s.status === 'landed') { label = S.GRADES[s.touch.grade].name.split(' ')[0].toUpperCase(); lc = gradeCls[s.touch.grade]; }
    else if (s.status === 'crashed') { label = 'AUFSCHLAG'; lc = 'bad'; }
    else if (!s.computerOK) { label = 'OFFLINE'; lc = 'bad'; }
    else if (s.vy >= -0.5) { label = 'SCHWEBT'; lc = ''; }
    else if (!isFinite(d)) { label = 'ZU WENIG SCHUB'; lc = 'bad'; }
    else if (alt <= burnAlt) { label = 'BURN!'; lc = 'bad'; }
    else { if (!(s.t - (ttb.at ?? -1) < 0.2 && ttb.at <= s.t)) { ttb.v = S.timeToBurn(s); ttb.at = s.t; } const tb = ttb.v; if (tb < 3) { label = 'BEREIT'; lc = 'warn'; } else { label = `in ${fmt(tb, 0)} s`; lc = 'ok'; } }
    bl.textContent = label; cls(bl, lc);

    // power: charge, what the panels bring in, what the lander uses (smoothed: thrust and jets flicker)
    {
      const k = Math.min(1, 0.12 + (s.t < 0.1 ? 1 : 0));
      pw.inp += ((s.powerIn ?? 0) - pw.inp) * k; pw.use += ((s.powerUse ?? 0) - pw.use) * k;
      const net = pw.inp - pw.use, bat = s.battery;
      $('pw-fill').style.width = `${bat}%`;
      $('pw-fill').style.background = bat < 20 ? 'var(--bad)' : bat < 45 ? 'var(--warn)' : 'var(--cyan)';
      const pct = $('pw-pct'); pct.textContent = `${fmt(bat)} %`; pct.className = bat < 20 ? 'bad' : bat < 45 ? 'warn' : '';
      const noPanels = !S.hasPart(s, 'solarL') && !S.hasPart(s, 'solarR');
      const pm = (x) => fmt(x * 60, x * 60 < 9.95 ? 1 : 0); // shown per minute: % of the battery
      $('pw-in').textContent = noPanels ? '–' : `+${pm(pw.inp)}`;
      $('pw-in').className = noPanels ? '' : pw.inp < 0.05 ? 'mute' : 'ok';
      $('pw-out').textContent = `−${pm(pw.use)} %/min`;
      // net per second, and how long until empty (or full)
      const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
      // phone: the bar alone says it, charging (stripes run right, ▲) or draining (stripes run left, ▼)
      const dir = net > 0.01 && bat < 99.5 ? 'chg' : net < -0.01 ? (bat / -net < 60 ? 'drain bad' : 'drain') : '';
      const bar = $('pw-fill').parentElement;
      if (bar.dataset.d !== dir) { bar.dataset.d = dir; bar.className = `pw-bar ${dir}`; const d = $('pw-dir'); d.textContent = dir.startsWith('chg') ? '▲' : dir ? '▼' : ''; d.className = `pw-dir ${dir}`; }
      const el = $('pw-net');
      if (net < -0.01) { el.textContent = `▼ ${pm(-net)} %/min · leer ${mmss(bat / -net)}`; el.className = `pw-net ${bat / -net < 60 ? 'bad' : 'warn'}`; }
      else if (net > 0.01 && bat < 99.5) { el.textContent = `▲ ${pm(net)} %/min · voll ${mmss((100 - bat) / net)}`; el.className = 'pw-net ok'; }
      else { el.textContent = bat >= 99.5 ? 'voll' : 'ausgeglichen'; el.className = 'pw-net'; }
    }

    // components
    const awake = s.crew.filter((c) => !c.out).length;
    if (s.crew.length) setRow('capsule', `${awake}/${s.crew.length} wach`, awake / s.crew.length, awake < s.crew.length ? 'var(--bad)' : 'var(--ok)');
    setRow('engine', `${fmt(s.throttle * 100)} %`, s.throttle, 'var(--amber)');
    const half = s.fuel0 / 2;
    const fc = (f) => (f / half < 0.2 ? 'var(--bad)' : 'var(--amber)');
    setRow('tankL', `${fmt(s.fuelL)} kg`, s.fuelL / half, fc(s.fuelL));
    setRow('tankR', `${fmt(s.fuelR)} kg`, s.fuelR / half, fc(s.fuelR));
    setRow('battery', `${fmt(s.battery)} %`, s.battery / S.BAT_CAP, s.battery < 20 ? 'var(--bad)' : 'var(--cyan)');
    setRow('solar', s.panels === 'in' ? 'eingeklappt' : `${fmt(p.solar * 100)} % Licht`, s.panels === 'in' ? 0 : p.solar, 'var(--cyan)');
    setRow('computer', s.computerOK ? 'online' : 'offline', s.computerOK ? 1 : 0, 'var(--ok)');
    setRow('legs', 'ok', 1, 'var(--ok)');
    const air = p.rho > 0;
    const chuteText = !air ? 'keine Luft' : { burned: 'verglüht', stowed: s.q > S.CHUTE_QMAX ? 'zu schnell' : 'bereit', open: `offen ${fmt(s.chuteOpen * 100)} %`, cut: 'abgeworfen', torn: 'gerissen' }[s.chute];
    setRow('chute', chuteText, s.chute === 'open' ? s.chuteOpen : s.chute === 'stowed' && air ? Math.min(1, s.q / S.CHUTE_QMAX) : 0,
      s.chute === 'stowed' && s.q > S.CHUTE_QMAX ? 'var(--bad)' : 'var(--cyan)');
    const qEl = $('v-q');
    qEl.textContent = air ? `${fmt(s.q / 1000, 1)} kPa` : '–';
    cls(qEl, s.q > S.CHUTE_QMAX ? 'bad' : s.q > S.CHUTE_QMAX * 0.8 ? 'warn' : '');
    const pb = $('c-panels');
    const solarGone = !S.hasPart(s, 'solarL') && !S.hasPart(s, 'solarR');
    const noPanels = !s.spec.ids.has('solarL');
    setLabel(pb, s.panels === 'out' || noPanels || solarGone ? 'Paneele' : 'Eingekl.', 'E', noPanels ? 'Keine Paneele' : solarGone ? 'Paneele weg' : s.panels === 'out' ? 'Paneele einklappen' : 'Paneele ausklappen');
    pb.disabled = solarGone || noPanels;
    pb.classList.toggle('on', s.panels === 'in' && !solarGone);
    const solarHeat = Math.max(...['solarL', 'solarR'].filter((id) => !s.lost[id]).map((id) => heatFrac(s, id)), 0);
    pb.classList.toggle('warn', s.panels === 'out' && solarHeat > 0.3 && !solarGone);
    const cb = $('c-chute');
    const noChute = !s.spec.ids.has('chute');
    setLabel(cb, s.chute === 'open' && air ? 'Abwerfen' : 'Schirm', 'P', noChute ? 'Kein Schirm' : { burned: 'Schirm verglüht', stowed: 'Fallschirm öffnen', open: air ? 'Schirm abwerfen' : 'Schirm (nutzlos)', cut: 'Schirm weg', torn: 'Schirm gerissen' }[s.chute]);
    cb.disabled = noChute || s.chute === 'cut' || s.chute === 'torn' || s.chute === 'burned' || (s.chute === 'open' && !air);
    cb.classList.toggle('on', s.chute === 'open' && air);
    cb.classList.toggle('ready', s.chute === 'stowed' && air && s.status === 'flying' && S.chuteSafe(s) && s.t > 0.2);
    // decoupler: heat shield off (only with a shield built in); glows when the hint says it is time
    const sb = $('c-shield');
    sb.hidden = !s.spec.ids.has('shield');
    const dropHint = S.shieldDropHint(s);
    setLabel(sb, 'Schild ab', 'J', s.lost.shield ? 'Schild verglüht' : s.dropped.shield ? 'Schild weg' : 'Hitzeschild abwerfen');
    sb.disabled = !S.hasPart(s, 'shield') || s.status !== 'flying';
    sb.classList.toggle('ready', !!dropHint && s.settings?.hints !== false);
    // heat: hot or destroyed components override their row
    const rowParts = { capsule: ['capsule'], engine: ['engine'], tankL: ['tankL'], tankR: ['tankR'], battery: ['battery'], solar: ['solarL', 'solarR'], computer: ['computer'], chute: ['chute'], legs: ['legs'], shield: ['shield'] };
    rows.shield.li.hidden = !s.spec.ids.has('shield');
    setRow('shield', facingText(s), 1, 'var(--ok)');
    for (const [row, ids0] of Object.entries(rowParts)) {
      const ids = ids0.filter((id) => s.spec.ids.has(id));
      if (!ids.length) { setRow(row, 'nicht verbaut', 0); rows[row].val.style.color = 'var(--mute)'; continue; }
      if (ids.every((id) => s.dropped[id])) { setRow(row, 'abgeworfen', 0); rows[row].val.style.color = 'var(--mute)'; continue; }
      const lost = ids.filter((id) => s.lost[id]);
      const hot = ids.filter((id) => !s.lost[id] && !s.dropped[id]).map((id) => ({ id, f: heatFrac(s, id) })).sort((a, b) => b.f - a.f)[0];
      if (lost.length) setRow(row, lost.length === ids.length ? 'verglüht' : `${lost.length}/${ids.length} verglüht`, 0, 'var(--bad)');
      else if (hot && hot.f > 0.3) {
        rows[row].val.textContent = `${fmt(s.temp[hot.id])} °C`;
        rows[row].bar.style.width = `${Math.min(1, hot.f) * 100}%`;
        rows[row].bar.style.background = hot.f > 0.8 ? 'var(--bad)' : 'var(--amber)';
      }
      rows[row].val.style.color = lost.length || (hot && hot.f > 0.8) ? 'var(--bad)' : hot && hot.f > 0.3 ? 'var(--amber)' : '';
    }

    $('v-com').textContent = `x ${cx >= 0 ? '+' : '−'}${fmt(Math.abs(cx * 100), 1)} cm · y ${fmt(cy, 2)} m`;
    const tq = $('v-torque');
    tq.textContent = `${fmt(s.torqueCom / 1000, 1)} kNm`;
    cls(tq, Math.abs(s.torqueCom) > S.RCS_TORQUE * 0.7 ? 'bad' : Math.abs(s.torqueCom) > 2500 ? 'warn' : '');

    // controls state
    const lever = $('c-lever');
    lever.querySelector('.fill').style.height = `${s.throttle * 100}%`;
    lever.querySelector('.mark').style.bottom = `${s.limit * 100}%`;
    { const ms = lever.querySelector('.mark span'), txt = `${fmt(s.limit * 100)} %`; if (ms.textContent !== txt) ms.textContent = txt; }
    lever.setAttribute('aria-valuenow', Math.round(s.limit * 100));
    const sas = $('c-sas');
    {
      // a mode that is still waiting (switch must rest) blinks in the badge
      const pend = s.sasPending !== undefined, mode = (pend ? s.sasPending : s.sas) || 'off';
      const m = { hold: 'Halten', retro: 'Retro', retro2: 'Retro 2', up: 'Senkrecht', off: 'Aus' }[mode];
      setLabel(sas, m, 'T', `Lageregler: ${m}${pend ? ' (gleich aktiv)' : ''}`, { hold: 'H', retro: 'R', retro2: 'R2', up: '↑', off: '–' }[mode]);
      sas.classList.toggle('pending', pend);
      // the choice in big, above the controls (the thumb covers the button): every mode in a row, the chosen
      // one lit, and a bar that fills until it takes over
      const toast = $('sas-toast');
      toast.hidden = !pend;
      if (pend) {
        const order = ['hold', 'retro', 'retro2', 'up', 'off'], names = { hold: 'Halten', retro: 'Retro', retro2: 'Retro 2', up: 'Senkrecht', off: 'Aus' };
        const html = order.map((k) => `<span class="${k === mode ? 'on' : ''}">${names[k]}</span>`).join('');
        if (toast.dataset.m !== mode) { toast.dataset.m = mode; $('st-modes').innerHTML = html; }
        $('st-fill').style.width = `${Math.min(100, (1 - (s.sasAt - s.t) / S.SAS_DELAY) * 100)}%`;
        const tg = document.querySelector('#controls .toggles').getBoundingClientRect();
        toast.style.bottom = `${Math.round(innerHeight - tg.top + 10)}px`;
      }
    }
    sas.classList.toggle('on', !!s.sas);
    lever.classList.toggle('on', s.throttle > 0);
    const rcs = $('c-rcs');
    rcs.classList.toggle('on', !!(input.padX || input.padY));
    const reach = rcs.clientWidth / 2 - 20;
    rcs.querySelector('.knob').style.transform = `translate(${(input.padX || 0) * reach}px, ${-(input.padY || 0) * reach}px)`;

    // alerts, most important first
    const al = $('alert');
    let msg = null, color = 'var(--bad)', pulse = true;
    // hints (advice) can be switched off in the start menu; warnings always show
    const hints = s.settings?.hints !== false;
    const fh = hints && !s.settings?.autoFine ? S.fineHint(s) : null;
    if (s.blackout) msg = 'PILOTIN BEWUSSTLOS – KEINE STEUERUNG';
    // name the cause: only the engine can be throttled; air drag or the canopy's jerk can't
    else if (s.gNow > S.G_LIMIT) msg = s.throttle > 0 ? 'G-LAST ZU HOCH – SCHUB DROSSELN' : s.chute === 'open' ? 'G-LAST ZU HOCH – SCHIRM REISST AN' : 'G-LAST ZU HOCH – LUFTWIDERSTAND';
    else if (s.cargoDamaged && s.t - (cargoAt ??= s.t) < 3) msg = `FRACHT BESCHÄDIGT (${s.cargoDamaged.toUpperCase()})`;
    else if (s.gNow > minLimit && s.throttle > 0) { msg = s.crew.length ? 'G-LAST: CREW LEIDET' : 'G-LAST: FRACHT IN GEFAHR – DROSSELN'; color = s.crew.length ? 'var(--warn)' : 'var(--bad)'; pulse = !s.crew.length; }
    else if (recentLoss(s)) msg = `${recentLoss(s).toUpperCase()} VERGLÜHT`;
    else if (s.chute === 'torn' && s.t - (tornAt ??= s.t) < 3) msg = 'FALLSCHIRM GERISSEN';
    else if (hottest(s).f > (hottest(s).solar && s.panels === 'out' ? 0.5 : 0.75)) { const h = hottest(s); msg = `HITZE: ${h.name.toUpperCase()} ${fmt(h.f * 100)} %${h.solar && s.panels === 'out' ? ' – EINKLAPPEN!' : ''}`; color = h.f > 0.9 ? 'var(--bad)' : 'var(--warn)'; pulse = h.f > 0.9; }
    else if (S.fuel(s) <= 0) msg = 'TREIBSTOFF LEER';
    else if (fuelFrac < 0.12 && s.throttle > 0) { msg = 'TREIBSTOFF KNAPP'; color = 'var(--warn)'; pulse = false; }
    else if (!s.powered) { msg = 'BATTERIE LEER – PUMPEN AUS, MAX. 60 % SCHUB'; color = 'var(--warn)'; }
    else if (hints && p.deorbitAt && s.pred && alt > 4000 && Math.hypot(s.pred.x, s.pred.z) < 60 && Math.hypot(s.vx, s.vz) > 80) { const lim0 = s.limit0 ?? p.limit0 ?? 0.5;
      msg = s.throttle > 0 ? 'KREUZ AUF DEM PAD – SCHUB AUS' : s.limit < lim0 * 0.8 ? `KURS STIMMT – SCHUBGRENZE ZURÜCK AUF ${Math.round(lim0 * 100)} %` : 'KURS STIMMT – WIEDEREINTRITT, RETRO HALTEN'; color = 'var(--ok)'; pulse = s.throttle > 0; }
    else if (s.fineBurn) { msg = 'FEINREGELUNG – KREUZ WANDERT ZUM PAD'; color = 'var(--cyan)'; pulse = false; }
    else if (fh) {
      // deorbit fine control as advice: the cross reacts to every m/s now
      const pct = Math.round(fh.limit * 100), long = s.pred.x > 0;
      // within ~300 m the steerable canopy does the rest
      const close = fh.d < 300;
      if (s.throttle > 0) msg = s.limit > fh.limit + 0.015 ? `FEIN: SCHUB AUF ${pct} % – KREUZ NAHE AM ZIEL` : `FEIN: GUT · KREUZ ${fmt(fh.d)} m VOM ZIEL`;
      else if (close) msg = `KURS STIMMT – ${fmt(fh.d)} m MIT DEM SCHIRM STEUERN`;
      else msg = long ? `KREUZ ${fmt(fh.d)} m HINTER DEM ZIEL – WEITER BREMSEN (≤ ${pct} %)` : `ZU VIEL GEBREMST – KREUZ ${fmt(fh.d)} m VOR DEM ZIEL`;
      color = s.throttle > 0 || long ? 'var(--cyan)' : close ? 'var(--ok)' : 'var(--warn)'; pulse = false;
    }
    else if (hints && S.brakeForChute(s)) {
      // hint only: the thrust that keeps the crew below their G limit (the air already brakes hard)
      const rec = S.chuteBrakeLimit(s), pct = Math.round(rec * 20) * 5;
      const how = pct >= 5 ? ` · SCHUB ≤ ${pct} %` : ' · LUFT BREMST GENUG';
      msg = (s.throttle > 0 ? 'BREMSEN … BIS DER SCHIRM GEHT' : 'FÜR DEN SCHIRM BREMSEN') + how;
      color = 'var(--amber)'; pulse = s.throttle === 0;
    }
    else if (hints && S.orbitGuide(s)) {
      // orbit level: count down to the braking burn, then keep burning until the orbit speed is gone
      const og = S.orbitGuide(s);
      if (s.throttle > 0) { msg = `BREMSEN · ${fmt(og.vh)} m/s`; color = 'var(--amber)'; pulse = false; }
      else if (og.brakeIn > 2.5) { msg = `ORBIT ${fmt(og.vh)} m/s · BREMSEN IN ${fmt(og.brakeIn)} s`; color = 'var(--cyan)'; pulse = false; }
      else { msg = og.brakeIn > -8 ? 'JETZT BREMSEN (RETRO)' : 'ZU SPÄT – BREMSEN!'; color = 'var(--amber)'; }
    }
    else if (hints && s.chute === 'open' && p.rho > 0.5 && s.throttle === 0 && s.limit < (s.limit0 ?? p.limit0 ?? 0.5) * 0.8 && alt > 150) { msg = `SCHUBGRENZE FÜR DIE LANDUNG HOCHSETZEN (${Math.round((s.limit0 ?? p.limit0 ?? 0.5) * 100)} %)`; color = 'var(--cyan)'; pulse = false; }
    else if (hints && s.powered && s.vy < -0.5 && isFinite(d) && alt <= burnAlt && s.throttle < 0.95 * s.limit) msg = 'BURN!';
    else if (hints && S.shieldDropHint(s)) {
      const why = { over: 'HITZE VORBEI', safe: 'KEINE HITZEGEFAHR', vacuum: 'KEINE LUFT' }[S.shieldDropHint(s)];
      msg = `${why} – HITZESCHILD ABWERFEN (−${fmt(S.SHIELD.mass)} kg)`; color = 'var(--cyan)'; pulse = false;
    }
    else if (s.battery < 20) { msg = 'BATTERIE SCHWACH'; color = 'var(--warn)'; pulse = false; }
    else if (hints && s.panels === 'in' && (S.hasPart(s, 'solarL') || S.hasPart(s, 'solarR')) && s.heatFlux < 4 && s.battery < 45 && s.t > 6) { msg = 'PANEELE AUSKLAPPEN – BATTERIE LÄDT NICHT'; color = 'var(--cyan)'; pulse = false; }
    else if (hints && s.chute === 'stowed' && p.rho > 0 && alt > 120 && alt < S.CHUTE_MAX_ALT(p) && s.vy < -15 && s.t > 0.2 && !(s.powered && isFinite(d) && alt <= burnAlt)) {
      if (S.chuteSafe(s)) { msg = 'FALLSCHIRM MÖGLICH'; color = 'var(--cyan)'; pulse = false; }
    }
    if (s.chute !== 'torn') tornAt = undefined;
    if (!s.cargoDamaged) cargoAt = undefined;
    al.hidden = !msg || s.status !== 'flying';
    if (msg) { al.textContent = msg; al.style.color = color; al.classList.toggle('pulse', pulse); }
  }

  return { update, reset: crew.reset };
}
