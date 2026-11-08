// Fullscreen 3D lander editor: the lander on a turntable, parts are picked in 3D (or from the slot bar
// at the bottom), the camera flies to the chosen part and its variants appear as cards. Key figures are
// bars against the standard build instead of a table.
import * as THREE from 'three';

// which build slot a part belongs to (capsule, frame and computer are fixed)
const SLOT_OF = { engine: 'engine', tankL: 'tanks', tankR: 'tanks', battery: 'power', solarL: 'power', solarR: 'power', chute: 'chute', shield: 'shield', legs: 'legs' };
const PARTS_OF = { engine: ['engine'], tanks: ['tankL', 'tankR'], power: ['battery', 'solarL', 'solarR'], chute: ['chute'], shield: ['shield'], legs: ['legs'] };
// slot icons (24×24, stroke = currentColor)
const ICON = {
  engine: '<path d="M8 3h8v5l3 9H5l3-9z"/><path d="M9 20l3 2 3-2"/>',
  tanks: '<rect x="4" y="4" width="6" height="16" rx="3"/><rect x="14" y="4" width="6" height="16" rx="3"/>',
  power: '<path d="M2 9h7v6H2zM15 9h7v6h-7z"/><path d="M9 12h6"/><path d="M12 7l-1.5 5h3L12 17"/>',
  chute: '<path d="M3 11a9 7 0 0 1 18 0z"/><path d="M3 11l9 9 9-9M12 11v9"/>',
  shield: '<path d="M3 8c3 2 15 2 18 0l-2 6c-3 2-11 2-14 0z"/><path d="M10 15v4h4v-4"/>',
  legs: '<path d="M8 4h8v6H8z"/><path d="M8 10L3 20M16 10l5 10M2 20h3M19 20h3"/>',
};
const icon = (id) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">${ICON[id]}</svg>`;

export function createBuilder({ S, ship, camera, canvas, getBuild, setBuild, resetBuild, getFuelK, onClose }) {
  const $ = (id) => document.getElementById(id);
  const root = $('builder');
  let active = false, slot = null, hover = null, pulse = { ids: [], t: 1 };
  const view = { tgt: new THREE.Vector3(0, 2.8, 0), dist: 17, zoom: 1, pitch: 0.28 };

  // ---------- figures ----------
  const f = (n, d = 0) => n.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
  const dryMass = (spec) => spec.comps.reduce((a, c) => a + c.mass, 0);
  const figures = (build) => {
    const spec = S.makeSpec(build);
    const per = [...S.PLANETS, ...S.ORBIT_PLANETS].map((p) => {
      const st = S.createState(p, { build, fuelK: getFuelK(), rnd: () => 0.5, windHeading: 0 });
      const m0 = S.massProps(st).m, fuel = st.fuel0;
      return { p, dv: spec.isp * S.G0 * Math.log(m0 / (m0 - fuel)), twr: spec.fMax / (m0 * p.g) };
    });
    return { spec, dry: dryMass(spec), per };
  };
  // landing tolerance (sink rate, drift, tilt) against the standard legs
  const std0 = S.makeSpec(S.DEFAULT_BUILD).land;
  const landK = (sp) => (sp.land.vy[2] / std0.vy[2] + sp.land.vx[2] / std0.vx[2] + sp.land.tilt[2] / std0.tilt[2]) / 3;
  // ranges over every possible build, for the bar scales
  const range = { dry: [Infinity, 0], fMax: [Infinity, 0], isp: [Infinity, 0], bat: [Infinity, 0], chute: [0, 0], land: [Infinity, 0] };
  (function walk(i, b) {
    if (i === S.BUILD_SLOTS.length) {
      const sp = S.makeSpec(b);
      const v = { dry: dryMass(sp), fMax: sp.fMax, isp: sp.isp, bat: sp.batK, chute: sp.ids.has('chute') ? sp.chuteCda : 0, land: landK(sp) };
      for (const k in range) { range[k][0] = Math.min(range[k][0], v[k]); range[k][1] = Math.max(range[k][1], v[k]); }
      return;
    }
    for (const o of S.BUILD_SLOTS[i].options) walk(i + 1, { ...b, [S.BUILD_SLOTS[i].id]: o.id });
  })(0, {});
  let std = null; // figures of the standard build (bar ticks)

  // one bar: fill from the range's lower end (with a floor so the minimum is still visible), tick = standard
  const bar = (v, k, s, better) => {
    const [lo, hi] = range[k];
    const pos = (x) => (hi > lo ? 12 + ((x - lo) / (hi - lo)) * 88 : 100);
    const cls = Math.abs(v - s) < 1e-6 ? '' : (v > s) === better ? ' up' : ' down';
    return `<div class="g-bar${cls}"><i style="width:${pos(v).toFixed(1)}%"></i><b style="left:${pos(s).toFixed(1)}%"></b></div>`;
  };

  function renderFigures() {
    const build = getBuild();
    const now = figures(build);
    std ??= figures(S.DEFAULT_BUILD);
    const sp = now.spec, ss = std.spec;
    const g = (label, val, barHtml) => `<div class="g"><span class="g-l">${label}</span>${barHtml}<span class="g-v">${val}</span></div>`;
    $('build-gauges').innerHTML =
      g('Masse', `${f(now.dry / 1000, 2)} t`, bar(now.dry, 'dry', std.dry, false)) +
      g('Schub', `${f(sp.fMax / 1000)} kN`, bar(sp.fMax, 'fMax', ss.fMax, true)) +
      g('Isp', `${sp.isp} s`, bar(sp.isp, 'isp', ss.isp, true)) +
      g('Batterie', `×${f(sp.batK, 1)}${sp.ids.has('solarL') ? ' ☀' : ''}`, bar(sp.batK, 'bat', ss.batK, true)) +
      g('Schirm', sp.ids.has('chute') ? `${f(sp.chuteCda)} m²` : '—', bar(sp.ids.has('chute') ? sp.chuteCda : 0, 'chute', ss.chuteCda, true)) +
      g('Landung', `${f(landK(sp) * 100)} %`, bar(landK(sp), 'land', 1, true));
    // per planet: Δv against the standard lander (tick at 2/3), thrust-to-weight as a coloured figure
    $('build-planets').innerHTML = now.per.map((r, i) => {
      const s0 = std.per[i].dv, k = r.dv / s0;
      const cls = k > 1.02 ? ' up' : k < 0.98 ? ' down' : '';
      const twr = r.twr < 1.3 ? 'bad' : r.twr < 2 ? 'warn' : '';
      return `<div class="bp" title="${r.p.name}: Δv ${f(r.dv)} m/s, Schub/Gewicht ${f(r.twr, 1)}"><span class="bp-n">${r.p.name.replace(' Orbit', ' ◯')}</span><div class="g-bar${cls}"><i style="width:${Math.min(100, (k / 1.5) * 100).toFixed(1)}%"></i><b style="left:66.7%"></b></div>`
        + `<span class="bp-v"><span class="dv">${f(r.dv)}</span><small class="${twr}" title="Schub/Gewicht">${f(r.twr, 1)}g</small></span></div>`;
    }).join('');
    return now;
  }

  // ---------- slot bar and option cards ----------
  function renderSlots() {
    const build = getBuild();
    $('build-slots').innerHTML = S.BUILD_SLOTS.map((sl) => {
      const changed = build[sl.id] !== S.DEFAULT_BUILD[sl.id];
      return `<button class="bs${slot === sl.id ? ' on' : ''}${changed ? ' mod' : ''}" data-slot="${sl.id}" aria-pressed="${slot === sl.id}">${icon(sl.id)}<span>${sl.name}</span></button>`;
    }).join('');
  }
  function renderOptions() {
    const box = $('build-opts');
    if (!slot) { box.innerHTML = '<p class="bo-hint">Tippe auf ein Bauteil am Lander oder unten auf ein Symbol.</p>'; return; }
    const build = getBuild(), sl = S.BUILD_SLOTS.find((x) => x.id === slot);
    const cur = figures(build);
    box.innerHTML = sl.options.map((o) => {
      const alt = o.id === build[slot] ? cur : figures({ ...build, [slot]: o.id });
      // what this choice would change, as small badges against the current build
      const dm = alt.dry - cur.dry;
      const dv = alt.per.reduce((a, r, i) => a + r.dv / cur.per[i].dv, 0) / alt.per.length - 1;
      const badges = o.id === build[slot] ? '<em class="b-cur">gewählt</em>'
        : `${Math.abs(dm) > 0.5 ? `<em class="${dm < 0 ? 'b-up' : 'b-down'}">${dm > 0 ? '+' : '−'}${f(Math.abs(dm))} kg</em>` : ''}${Math.abs(dv) > 0.005 ? `<em class="${dv > 0 ? 'b-up' : 'b-down'}">Δv ${dv > 0 ? '+' : '−'}${f(Math.abs(dv) * 100)} %</em>` : ''}`;
      return `<button class="bo${o.id === build[slot] ? ' on' : ''}" data-id="${o.id}" aria-pressed="${o.id === build[slot]}"><b>${o.name}</b><small>${o.desc.replace(/ · [+−]\d+ kg/, '') || '&nbsp;'}</small><span class="bo-b">${badges}</span></button>`;
    }).join('');
  }
  $('build-slots').addEventListener('click', (e) => {
    const b = e.target.closest('.bs'); if (!b) return;
    select(slot === b.dataset.slot ? null : b.dataset.slot);
  });
  $('build-opts').addEventListener('click', (e) => {
    const b = e.target.closest('.bo'); if (!b || !slot) return;
    choose(slot, b.dataset.id);
  });
  $('build-done').addEventListener('click', () => close());
  $('build-reset').addEventListener('click', () => { resetBuild(); baseScale.clear(); pulse = { ids: Object.keys(SLOT_OF), t: 0 }; refresh(); });

  function choose(sl, id) {
    if (getBuild()[sl] === id) return;
    setBuild(sl, id); baseScale.clear();
    pulse = { ids: PARTS_OF[sl], t: 0 };
    refresh();
  }
  function select(sl) {
    const changed = sl !== slot;
    slot = sl;
    renderSlots(); renderOptions(); updateGhosts();
    $('build-opts').classList.toggle('enter', changed);
    if (changed) { void $('build-opts').offsetWidth; } // restart the cards' slide-in
  }
  function refresh() {
    $('build-opts').classList.remove('enter'); // a choice re-renders the cards without sliding them in again
    renderFigures(); renderSlots(); renderOptions(); updateGhosts();
  }

  // ---------- 3D: ghosts for parts that are not built in, picking, highlight ----------
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.16, depthWrite: false, wireframe: true });
  const ghosts = {};
  for (const id of ['chute', 'shield', 'solarL', 'solarR']) {
    const g = ship.parts[id].clone(true);
    g.traverse((m) => { if (m.isMesh) { m.material = ghostMat; m.castShadow = false; } });
    g.userData = { ghostOf: id };
    ghosts[id] = g;
  }
  function updateGhosts() {
    const spec = S.makeSpec(getBuild());
    for (const [id, g] of Object.entries(ghosts)) {
      const show = active && !spec.ids.has(id);
      if (show && g.parent !== ship.group) ship.group.add(g);
      if (!show && g.parent) g.parent.remove(g);
      if (show) {
        const c = [...S.COMPONENTS, S.SHIELD].find((x) => x.id === id);
        g.position.set(...c.pos); g.rotation.set(0, c.mirror ? Math.PI : 0, 0);
      }
    }
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  // fingers are wide and the legs and the chute pack are thin: try a small ring around the tap as well
  function pick(x, y, reach = 14) {
    const h = pickAt(x, y);
    if (h || !reach) return h;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = pickAt(x + Math.cos(a) * reach, y + Math.sin(a) * reach);
      if (r) return r;
    }
    return null;
  }
  function pickAt(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const objs = [...Object.values(ship.parts).filter((o) => o.parent === ship.group), ...Object.values(ghosts).filter((g) => g.parent)];
    // real parts first: the wireframe ghosts of missing parts only catch taps that hit nothing else
    let ghost = null;
    for (const h of ray.intersectObjects(objs, true)) {
      let o = h.object;
      while (o && !o.userData.component && !o.userData.ghostOf) o = o.parent;
      if (o?.userData.ghostOf) { ghost ??= o.userData.ghostOf; continue; }
      const id = o?.userData.component?.id;
      if (id) return { id, slot: SLOT_OF[id] ?? null };
    }
    return ghost ? { id: ghost, slot: SLOT_OF[ghost] } : null;
  }
  // tap = pick (a drag orbits the camera, handled in main.js); mouse hover highlights
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { if (active) down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!active || !down || down.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
    down = null;
    if (moved > 8 || dt > 600) return;
    const h = pick(e.clientX, e.clientY);
    // a part selects its slot (fixed parts and empty space go back to the overview)
    select(h?.slot ?? null);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active || e.pointerType !== 'mouse') return;
    const h = pick(e.clientX, e.clientY, 0);
    hover = h?.slot ?? null;
    canvas.style.cursor = h ? (h.slot ? 'pointer' : 'not-allowed') : '';
  });
  // zoom: wheel and two-finger pinch
  canvas.addEventListener('wheel', (e) => { if (active) view.zoom = Math.min(1.8, Math.max(0.55, view.zoom * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });
  const touches = new Map(); let pinch0 = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') touches.set(e.pointerId, [e.clientX, e.clientY]); });
  addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (!active || touches.size !== 2) { pinch0 = null; return; }
    const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch0) view.zoom = Math.min(1.8, Math.max(0.55, view.zoom * (pinch0 / d)));
    pinch0 = d; down = null; // a pinch is never a tap
  });
  const lift = (e) => { touches.delete(e.pointerId); pinch0 = null; };
  addEventListener('pointerup', lift); addEventListener('pointercancel', lift);
  addEventListener('keydown', (e) => { if (active && e.code === 'Escape') { if (slot) select(null); else close(); } });

  // ---------- per frame: highlight, turntable, camera ----------
  const tint = new THREE.Color(0x3ad8ff), box = new THREE.Box3(), tmp = new THREE.Vector3(), size = new THREE.Vector3();
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.55, 72).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.55, depthWrite: false }));
  const ticks = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.0, 48, 1, 0, Math.PI * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.08, depthWrite: false }));
  const deck = new THREE.Group(); deck.add(ring, ticks);
  function frame(s, dt, time) {
    if (!active) return;
    // turntable under the lander
    if (deck.parent !== ship.group.parent && ship.group.parent) ship.group.parent.add(deck);
    deck.position.set(s.x, s.y + 0.06, s.z);
    // highlight: chosen slot glows (pulsing), hovered slot lighter; a part that just changed pops
    pulse.t = Math.min(1, pulse.t + dt / 0.45);
    const glow = {};
    for (const id of PARTS_OF[hover] ?? []) glow[id] = 0.25;
    for (const id of PARTS_OF[slot] ?? []) glow[id] = 0.35 + 0.2 * Math.sin(time * 4);
    for (const [id, k] of Object.entries(glow)) {
      const p = ship.parts[id];
      if (p.parent !== ship.group) continue;
      p.traverse((m) => { if (m.isMesh) { m.material.emissive.lerp(tint, k); m.material.emissiveIntensity = Math.max(m.material.emissiveIntensity, 0.6); } });
    }
    for (const g of Object.values(ghosts)) g.visible = true;
    ghostMat.opacity = 0.14 + (slot && PARTS_OF[slot].some((id) => ghosts[id]?.parent) ? 0.2 + 0.1 * Math.sin(time * 4) : 0);
    if (pulse.t < 1) {
      const k = 1 + Math.sin(pulse.t * Math.PI) * 0.14;
      for (const id of pulse.ids) {
        const p = ship.parts[id]; if (p?.parent !== ship.group) continue;
        if (!baseScale.has(p)) baseScale.set(p, p.scale.clone());
        p.scale.copy(baseScale.get(p)).multiplyScalar(k);
      }
    }
  }
  // the pop scales parts each frame: put them back to their built size first
  const baseScale = new Map();
  function beforeUpdate() {
    for (const [p, sc] of baseScale) p.scale.copy(sc);
    if (pulse.t >= 1) baseScale.clear();
  }

  /** camera around the chosen part, framed in the free space between the top figures and the dock */
  function placeCamera(s, yaw, pitchIn, dt, lookAt) {
    const ids = (PARTS_OF[slot] ?? []).map((id) => (ship.parts[id].parent === ship.group ? ship.parts[id] : ghosts[id]?.parent ? ghosts[id] : null)).filter(Boolean);
    let tx = s.x, ty = s.y + 2.9, tz = s.z, d = 14;
    if (ids.length) {
      box.makeEmpty();
      for (const o of ids) box.expandByObject(o);
      box.getCenter(tmp); box.getSize(size);
      tx = tmp.x; ty = tmp.y; tz = tmp.z;
      d = Math.max(7.5, size.length() * 1.6);
    }
    const W = innerWidth, H = innerHeight;
    const top = $('build-top').getBoundingClientRect().bottom, bottom = H - $('build-dock').getBoundingClientRect().top;
    const free = Math.max(120, H - top - bottom);
    // narrow screens: the lander must fit the width too
    d *= Math.max(1, (H / free) * 0.85) / Math.min(1, (W / free) * 0.9);
    const k = 1 - Math.exp(-dt * 4);
    view.tgt.x += (tx - view.tgt.x) * k; view.tgt.y += (ty - view.tgt.y) * k; view.tgt.z += (tz - view.tgt.z) * k;
    view.dist += (d * view.zoom - view.dist) * k;
    const e = Math.max(-0.05, Math.min(1.35, view.pitch + pitchIn));
    camera.position.set(view.tgt.x + Math.sin(yaw) * Math.cos(e) * view.dist, view.tgt.y + Math.sin(e) * view.dist, view.tgt.z + Math.cos(yaw) * Math.cos(e) * view.dist);
    lookAt.copy(view.tgt);
    // shift the image so the lander sits in the middle of the free area
    const dy = H / 2 - (top + free / 2);
    camera.setViewOffset(W, H, 0, Math.round(dy), W, H);
    placeTag();
  }

  // label next to the chosen part, following it on screen
  function placeTag() {
    const tag = $('build-tag');
    if (!slot) { tag.hidden = true; return; }
    const sl = S.BUILD_SLOTS.find((x) => x.id === slot), o = sl.options.find((x) => x.id === getBuild()[slot]);
    const built = (PARTS_OF[slot] ?? []).some((id) => ship.parts[id].parent === ship.group);
    tmp.set(view.tgt.x, view.tgt.y + (box.isEmpty() ? 0 : size.y * 0.5), view.tgt.z).project(camera);
    const x = (tmp.x * 0.5 + 0.5) * innerWidth, y = (-tmp.y * 0.5 + 0.5) * innerHeight;
    tag.hidden = false;
    const html = `${sl.name}<b>${built ? o.name : 'nicht verbaut'}</b>`;
    if (tag.innerHTML !== html) tag.innerHTML = html;
    tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function open() {
    active = true; slot = null; hover = null; view.zoom = 1; std = null;
    root.hidden = false;
    document.body.classList.add('building');
    refresh();
  }
  function close() {
    if (!active) return;
    active = false; slot = null; hover = null;
    root.hidden = true;
    document.body.classList.remove('building');
    camera.clearViewOffset();
    canvas.style.cursor = '';
    deck.parent?.remove(deck);
    updateGhosts();
    ship.reset(S.makeSpec(getBuild()));
    onClose();
  }

  return { open, close, frame, beforeUpdate, placeCamera, pick, get active() { return active; }, select, choose, get slot() { return slot; } };
}
