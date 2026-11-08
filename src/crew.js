// Crew portraits: low-poly faces in helmets, drawn on canvas, reacting live to g-load and events.
import * as S from './sim.js';

const LOOK = {
  kira: { skin: '#b37b52', hair: '#1b1411', hairStyle: 'short', stripe: '#ffb547' },
  bo: { skin: '#efc3a0', hair: '#c8642a', hairStyle: 'beard', stripe: '#8fe3ff' },
  ines: { skin: '#6e4832', hair: '#141010', hairStyle: 'puff', glasses: true, stripe: '#5fe0a0' },
  juno: { skin: '#d9a77c', hair: '#e8d9b0', hairStyle: 'short', stripe: '#c58cff' },
};

const HEAD = [[50, 22], [68, 27], [76, 42], [75, 58], [68, 72], [58, 80], [50, 82], [42, 80], [32, 72], [25, 58], [24, 42], [32, 27]];

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(Math.min(255, Math.max(0, v * f))));
  return `rgb(${c.join(',')})`;
}
function mix(hex, to, k) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (x, s) => (x >> s) & 255;
  return `rgb(${[16, 8, 0].map((s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k)).join(',')})`;
}
function poly(ctx, pts, fill) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
}

/** Expression parameters for a mood. */
function face(mood) {
  switch (mood) {
    case 'float': return { eyes: 'happy', brow: 3, mouth: 'smile' };
    case 'effort': return { eyes: 'open', open: 0.6, brow: -2, mouth: 'flat' };
    case 'strain': return { eyes: 'squint', brow: -5, mouth: 'grimace', sweat: true };
    case 'scared': return { eyes: 'wide', brow: 4, mouth: 'o' };
    case 'out': return { eyes: 'closed', brow: 0, mouth: 'o', tilt: 0.35 };
    case 'joy': return { eyes: 'happy', brow: 3, mouth: 'grin' };
    case 'relief': return { eyes: 'open', open: 0.8, brow: 2, mouth: 'smile', sweat: true };
    case 'dizzy': return { eyes: 'dizzy', brow: 1, mouth: 'wavy', tilt: 0.15 };
    default: return { eyes: 'open', open: 0.9, brow: 0, mouth: 'flat' };
  }
}

function drawFace(ctx, px, who, st) {
  const L = LOOK[who.id];
  ctx.setTransform(px / 100, 0, 0, px / 100, 0, 0);
  ctx.clearRect(0, 0, 100, 100);
  // helmet interior
  ctx.beginPath(); ctx.arc(50, 50, 47, 0, Math.PI * 2); ctx.fillStyle = '#0b1018'; ctx.fill();

  if (st.mood === 'nosignal') {
    for (let i = 0; i < 140; i++) {
      const v = Math.floor(Math.random() * 160);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(10 + Math.random() * 80, 10 + Math.random() * 80, 4, 2);
    }
    ctx.fillStyle = '#ff5d52'; ctx.font = '700 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('KEIN', 50, 48); ctx.fillText('SIGNAL', 50, 61);
    ring(ctx, L);
    return;
  }

  const f = face(st.mood);
  ctx.save();
  ctx.beginPath(); ctx.arc(50, 50, 45, 0, Math.PI * 2); ctx.clip();
  // engine vibration + zero-g bob
  const jx = (Math.random() - 0.5) * st.shake, jy = (Math.random() - 0.5) * st.shake;
  const bob = st.mood === 'float' ? Math.sin(st.t * 2 + who.limit * 7) * 2 : 0;
  ctx.translate(jx, jy + bob);
  if (f.tilt) { ctx.translate(50, 70); ctx.rotate(f.tilt); ctx.translate(-50, -70); }

  // g-load pulls the face down; zero-g puffs it up
  const g = st.g;
  const stretch = Math.max(-0.06, Math.min(0.32, (g - 1) * 0.12));
  const puff = g < 0.3 ? 1.06 : 1;
  const head = HEAD.map(([x, y]) => [50 + (x - 50) * puff, y > 50 ? y + (y - 50) * stretch : y - (50 - y) * stretch * 0.25]);
  const jaw = (y) => (y > 50 ? y + (y - 50) * stretch : y);

  // hair behind the head (puff floats in zero-g)
  if (L.hairStyle === 'puff') {
    const lift = g < 0.3 ? 5 + Math.sin(st.t * 3) * 1.5 : -Math.min(4, stretch * 12);
    ctx.fillStyle = L.hair;
    for (const [x, y, r] of [[50, 20, 17], [33, 28, 12], [67, 28, 12], [42, 16, 10], [58, 16, 10]]) {
      ctx.beginPath(); ctx.arc(x, y - lift, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  // head: two-tone low-poly facets, paler with stress (blood leaves the head)
  const pale = Math.min(1, st.stress * 0.8 + (st.out ? 0.3 : 0));
  const skin = mix(L.skin, '#a7a9ad', pale * 0.55);
  poly(ctx, head, skin);
  const right = head.filter(([x]) => x >= 50);
  poly(ctx, [[50, head[0][1]], ...right, [50, head[6][1]]], 'rgba(0,0,0,0.13)');
  poly(ctx, [[50, 50], head[9], head[10]], 'rgba(255,255,255,0.08)');
  if (L.hairStyle === 'short' || L.hairStyle === 'beard') {
    const up = g < 0.3 ? 3 : 0;
    poly(ctx, [[25, 40], [30, 26 - up], [42, 18 - up], [50, 16 - up * 1.5], [60, 18 - up], [70, 26 - up], [75, 40], [68, 31], [56, 28], [44, 28], [32, 31]], L.hair);
  }
  if (L.hairStyle === 'beard') {
    poly(ctx, [[27, 58], [33, jaw(72)], [42, jaw(81)], [50, jaw(84)], [58, jaw(81)], [67, jaw(72)], [73, 58], [66, jaw(66)], [58, jaw(73)], [42, jaw(73)], [34, jaw(66)]], L.hair);
  }

  // eyes
  const ey = 49;
  ctx.lineCap = 'round';
  for (const ex of [40, 60]) {
    ctx.strokeStyle = '#1a1210'; ctx.fillStyle = '#1a1210'; ctx.lineWidth = 2.4;
    if (f.eyes === 'open' || f.eyes === 'wide') {
      const ry = f.eyes === 'wide' ? 6 : 4.5 * (f.open ?? 1);
      ctx.beginPath(); ctx.ellipse(ex, ey, f.eyes === 'wide' ? 6 : 5, Math.max(0.8, ry), 0, 0, Math.PI * 2);
      ctx.fillStyle = '#f4f1ea'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex + st.look, ey + (f.eyes === 'wide' ? 0 : 0.5), f.eyes === 'wide' ? 1.6 : 2.3, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1210'; ctx.fill();
    } else if (f.eyes === 'squint') {
      ctx.beginPath(); ctx.moveTo(ex - 6, ey - 1); ctx.lineTo(ex, ey + 1.5); ctx.lineTo(ex + 6, ey - 1); ctx.stroke();
    } else if (f.eyes === 'closed') {
      ctx.beginPath(); ctx.arc(ex, ey - 1, 5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    } else if (f.eyes === 'happy') {
      ctx.beginPath(); ctx.arc(ex, ey + 2, 5, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
    } else if (f.eyes === 'dizzy') {
      ctx.beginPath();
      for (let a = 0; a < 10; a += 0.4) ctx.lineTo(ex + Math.cos(a + st.t * 6) * a * 0.5, ey + Math.sin(a + st.t * 6) * a * 0.5);
      ctx.lineWidth = 1.4; ctx.stroke();
    }
  }
  if (L.glasses) {
    ctx.strokeStyle = '#d8dde6'; ctx.lineWidth = 1.6;
    for (const ex of [40, 60]) { ctx.beginPath(); ctx.arc(ex, ey, 8, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(48, ey); ctx.lineTo(52, ey); ctx.stroke();
  }
  // brows: positive = raised/worried, negative = furrowed
  ctx.strokeStyle = shade(L.hair === '#c8642a' ? '#a04d1c' : L.hair, 1); ctx.lineWidth = 2.6;
  for (const [ex, dir] of [[40, 1], [60, -1]]) {
    ctx.beginPath();
    ctx.moveTo(ex - 6 * dir, 41 - f.brow * 0.3);
    ctx.lineTo(ex + 5 * dir, 41 - f.brow);
    ctx.stroke();
  }
  // mouth
  const my = jaw(68);
  ctx.strokeStyle = '#3a1712'; ctx.fillStyle = '#3a1712'; ctx.lineWidth = 2.4;
  ctx.beginPath();
  if (f.mouth === 'smile') { ctx.arc(50, my - 5, 8, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); }
  else if (f.mouth === 'grin') { ctx.arc(50, my - 3, 9, 0, Math.PI); ctx.fill(); ctx.fillStyle = '#f4f1ea'; ctx.fillRect(43, my - 3, 14, 3); }
  else if (f.mouth === 'grimace') {
    const w = 9 + stretch * 8;
    ctx.fillRect(50 - w, my - 3, w * 2, 7); ctx.fillStyle = '#f4f1ea'; ctx.fillRect(50 - w + 1.5, my - 1.5, w * 2 - 3, 4);
    ctx.strokeStyle = '#3a1712'; ctx.lineWidth = 0.8;
    for (let x = 50 - w + 5; x < 50 + w - 2; x += 4) { ctx.beginPath(); ctx.moveTo(x, my - 1.5); ctx.lineTo(x, my + 2.5); ctx.stroke(); }
  } else if (f.mouth === 'o') { ctx.ellipse(50, my, 3.5, 4.5 + stretch * 6, 0, 0, Math.PI * 2); ctx.fill(); }
  else if (f.mouth === 'wavy') { ctx.moveTo(42, my); for (let x = 42; x <= 58; x += 2) ctx.lineTo(x, my + Math.sin(x * 0.9) * 1.6); ctx.stroke(); }
  else { ctx.moveTo(44, my); ctx.lineTo(56, my); ctx.stroke(); }
  // sweat
  if (f.sweat || st.stress > 0.25) {
    ctx.fillStyle = '#9fd8ff';
    const sy = 36 + ((st.t * 14) % 16);
    ctx.beginPath(); ctx.moveTo(74, sy - 5); ctx.quadraticCurveTo(79, sy + 2, 74, sy + 3); ctx.quadraticCurveTo(69, sy + 2, 74, sy - 5); ctx.fill();
  }
  ctx.restore();

  // tunnel vision per person
  if (st.stress > 0.05) {
    const grd = ctx.createRadialGradient(50, 50, 12, 50, 50, 48);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, `rgba(0,0,0,${Math.min(0.92, st.stress * 0.95)})`);
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(50, 50, 46, 0, Math.PI * 2); ctx.fill();
  }
  // visor reflection
  ctx.beginPath(); ctx.moveTo(22, 30); ctx.quadraticCurveTo(30, 14, 50, 9); ctx.lineTo(48, 15); ctx.quadraticCurveTo(33, 20, 27, 33); ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill();
  ring(ctx, L);
}

function ring(ctx, L) {
  ctx.lineWidth = 6; ctx.strokeStyle = '#d9dde4';
  ctx.beginPath(); ctx.arc(50, 50, 46, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = L.stripe; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(50, 50, 46, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
}

const LINES = {
  start: ['kira', 'Abstieg beginnt. Alle angeschnallt?'],
  float: ['ines', 'Schwerelos! Meine Haare…'],
  ignite: ['kira', 'Zündung!'],
  overG: { kira: 'Halte… durch…', bo: 'Ächz! Zu viel G!', ines: 'Uff… das drückt!', juno: 'Puls bei 160…' },
  dark: { kira: 'Mir wird schwarz vor Augen…', bo: 'Ich seh nur noch grau…', ines: 'Mir wird schwarz…', juno: 'Tunnelblick… nicht gut…' },
  out: { kira: ['bo', 'Kira?! KIRA! Wach auf!'], bo: ['ines', 'Bo ist weg!'], ines: ['bo', 'Ines ist ohnmächtig!'], juno: ['kira', 'Juno ist weggetreten!'] },
  wake: { kira: 'Was… bin wieder da!', bo: 'Wo… was ist passiert?', ines: 'Hab ich was verpasst?', juno: 'Okay… Vitalwerte stabil.' },
  brake: ['bo', 'BREMSEN!!'],
  fuel: ['bo', 'Tank fast leer!'],
  power: ['bo', 'Strom weg! Pumpen aus!'],
  chuteOpen: ['kira', 'Schirm offen!'],
  chuteUseless: ['ines', 'Ein Fallschirm. Ohne Luft. Netter Versuch.'],
  chuteTorn: ['bo', 'Der Schirm ist gerissen! Wir waren zu schnell!'],
  chuteCut: ['kira', 'Schirm abgeworfen.'],
  heat: ['bo', 'Die Solarpaneele glühen! Einklappen!'],
  lost: { solarL: ['bo', 'Solarpaneel links weggeschmolzen!'], solarR: ['bo', 'Solarpaneel rechts weggeschmolzen!'],
    tankL: ['kira', 'Tank links explodiert!'], tankR: ['kira', 'Tank rechts explodiert!'], chute: ['ines', 'Der Fallschirm ist verbrannt!'],
    computer: ['bo', 'Bordcomputer ist hin!'], battery: ['bo', 'Batterien durchgebrannt!'], legs: ['kira', 'Die Landebeine… sind weg.'],
    frame: ['bo', 'Der Rahmen bricht!'], engine: ['bo', 'Triebwerk weg!'], capsule: ['ines', 'Die Kapsel!'] },
  land0: ['kira', 'Butterweich. Willkommen auf {p}!'],
  land1: ['kira', 'Gelandet. Etwas holprig.'],
  land2: ['bo', 'Das Fahrwerk… das gibt Ärger mit der Werft.'],
};

export function createCrew(container, sayEl) {
  // one card per seat; rebuilt when the capsule has a different crew (2-4)
  let cards = [], cardsFor = '', crewNow = S.CREW;
  function ensureCards(crew) {
    const key = crew.map((c) => c.id).join();
    if (key === cardsFor) return;
    cardsFor = key; crewNow = crew;
    container.innerHTML = '';
    container.style.setProperty('--n', crew.length);
    cards = crew.map((c) => {
      const el = document.createElement('div');
      el.className = 'face';
      el.innerHTML = `<canvas></canvas><span class="nm">${c.name} <small>${c.limit.toLocaleString('de-DE')} g</small></span><div class="bar"><i></i></div>`;
      container.append(el);
      return { el, canvas: el.querySelector('canvas'), bar: el.querySelector('i') };
    });
  }
  ensureCards(S.CREW);
  let said = new Set(), sayUntil = 0, prev = null, look = 0;

  function say(key, who, text, t) {
    if (said.has(key)) return;
    said.add(key);
    // a line for someone not on board (two-seater): the pilot says it
    const c = crewNow.find((k) => k.id === who) ?? crewNow[0];
    sayEl.innerHTML = `<b>${c.name}:</b> ${text}`;
    sayEl.classList.remove('fresh'); void sayEl.offsetWidth; sayEl.classList.add('fresh');
    sayUntil = t + 3;
  }

  function reset() { said = new Set(); prev = null; sayEl.textContent = ''; sayUntil = 0; }

  function events(s, alt, crashGrade) {
    const t = s.t;
    if (s.status === 'landed') {
      const [w, txt] = LINES[`land${s.touch.grade}`];
      say('land', w, txt.replace('{p}', s.planet.name), t);
      return;
    }
    if (s.status === 'crashed' && s.touch.crash.crew) {
      say('crash', ...(s.touch.crash.kind === 'wreck' ? ['kira', 'Alle in Ordnung? … Der Lander ist Schrott.'] : ['bo', 'Raus hier, es brennt!']), t);
      return;
    }
    if (s.status !== 'flying') { sayEl.textContent = ''; return; }
    if (t < 3) say('start', ...(s.wind.speed >= 15 && s.planet.rho > 0 ? ['kira', `${s.wind.name} heute. Gegenhalten!`] : LINES.start), t);
    if (s.planet.rho > 0 && s.wind.speed && t > 4 && Math.abs(s.windNow) > s.wind.speed * 1.3) say(`gust-${Math.floor(t / 15)}`, 'ines', 'Böe!', t);
    if (s.panels === 'in' && s.heatFlux < 4 && s.t > 8 && s.battery < 70 && (S.hasPart(s, 'solarL') || S.hasPart(s, 'solarR'))) say('unfold', 'bo', 'Hitze ist vorbei. Paneele wieder ausklappen, die Batterie leert sich.', t);
    else if (t > 4 && t < 8 && s.gNow < 0.3 && !said.has('ignite')) say('float', ...LINES.float, t);
    if (s.throttle > 0) say('ignite', ...LINES.ignite, t);
    if (prev && s.chute !== prev.chute) {
      if (s.chute === 'open') say('chute-open', ...(s.planet.rho > 0 ? LINES.chuteOpen : LINES.chuteUseless), t);
      if (s.chute === 'torn') say('chute-torn', ...LINES.chuteTorn, t);
      if (s.chute === 'cut') say('chute-cut', ...LINES.chuteCut, t);
    }
    const solarHot = s.panels === 'out' && ['solarL', 'solarR'].some((id) => S.hasPart(s, id) && s.temp[id] > s.spec.comps.find((c) => c.id === id).heat[1] * 0.35);
    if (solarHot) say('heat', ...LINES.heat, t);
    for (const id of Object.keys(s.lost)) if (LINES.lost[id]) say(`lost-${id}`, ...LINES.lost[id], t);
    s.crew.forEach((c, i) => {
      const p = prev?.crew[i];
      if (s.gNow > c.limit) say(`overG-${c.id}`, c.id, LINES.overG[c.id], t);
      if (c.stress > 0.6 && !c.out) say(`dark-${c.id}-${c.fainted}`, c.id, LINES.dark[c.id], t);
      if (c.out && p && !p.out) { const [w, txt] = LINES.out[c.id]; said.delete(`out-${c.id}`); say(`out-${c.id}-${c.fainted}`, w, txt, t); }
      if (!c.out && p?.out) say(`wake-${c.id}-${c.fainted}`, c.id, LINES.wake[c.id], t);
    });
    if (alt < 60 && crashGrade && s.throttle < 0.3) say('brake', ...LINES.brake, t);
    if (S.fuel(s) / s.fuel0 < 0.12 && s.throttle > 0) say('fuel', ...LINES.fuel, t);
    if (!s.powered) say('power', ...LINES.power, t);
    if (t > sayUntil && sayUntil) { sayEl.textContent = ''; sayUntil = 0; }
  }

  function moodFor(s, c, alt, crashGrade) {
    if (s.status === 'crashed') return s.touch.crash.crew ? 'dizzy' : 'nosignal';
    if (c.out) return 'out';
    if (s.status === 'landed') return ['joy', 'relief', 'dizzy'][s.touch.grade];
    if (alt < 80 && crashGrade && s.throttle < 0.5) return 'scared';
    if (s.gNow > c.limit) return 'strain';
    if (s.gNow > c.limit * 0.72) return 'effort';
    if (s.gNow < 0.15) return 'float';
    return 'focus';
  }

  function update(s, alt, crashGrade, time) {
    ensureCards(s.crew);
    events(s, alt, crashGrade);
    look += ((s.vx > 1 ? 1.2 : s.vx < -1 ? -1.2 : 0) - look) * 0.05;
    s.crew.forEach((c, i) => {
      const card = cards[i];
      const px = Math.round(card.canvas.clientWidth * Math.min(2, devicePixelRatio || 1));
      if (px && card.canvas.width !== px) { card.canvas.width = card.canvas.height = px; }
      const ctx = card.canvas.getContext('2d');
      drawFace(ctx, card.canvas.width, c, {
        mood: moodFor(s, c, alt, crashGrade), g: s.status === 'flying' ? s.gNow : 1, stress: c.stress, out: c.out,
        t: time, shake: s.status === 'flying' ? s.throttle * 2.2 : 0, look,
      });
      card.bar.style.width = `${Math.min(1, c.stress) * 100}%`;
      card.bar.style.background = c.stress > 0.6 ? 'var(--bad)' : 'var(--warn)';
      card.el.classList.toggle('out', c.out);
    });
    prev = { crew: s.crew.map((c) => ({ ...c })), chute: s.chute };
  }

  return { update, reset };
}
