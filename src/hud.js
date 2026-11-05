import * as S from './sim.js';
import { createCrew } from './crew.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const cls = (el, c) => { el.className = c || ''; };

export function createHud() {
  const list = $('part-list');
  const rows = {};
  const partRows = [
    ['capsule', 'Kommandokapsel'], ['engine', 'Antrieb'], ['tankL', 'Tank L'], ['tankR', 'Tank R'],
    ['battery', 'Batterien'], ['solar', 'Solarpaneele'], ['computer', 'Bordcomputer'], ['chute', 'Fallschirm'], ['legs', 'Landebeine'],
  ];
  for (const [id, label] of partRows) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${label}</span><span></span><div class="bar"><i></i></div>`;
    list.append(li);
    rows[id] = { val: li.children[1], bar: li.querySelector('i') };
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
    el.innerHTML = `<i class="glyph" aria-hidden="true">${glyphs[key]}</i><div class="lw-head"><span>${label}</span><b></b></div><div class="lw-bar" style="background: linear-gradient(90deg, ${grad})"><i></i></div>`;
    $('landing').append(el);
    lw[key] = { val: el.querySelector('b'), mark: el.querySelector('.lw-bar i'), unit, max };
  }

  // big touchdown gauge: sink-rate scale with the exact limits, shown close to the ground
  const TD_MAX = 18;
  const tdStops = [0, ...S.LAND.vy, S.WRECK_V, TD_MAX];
  const tdNames = ['Sanft', 'Hart', 'Schaden', 'Bruch', 'Explosion'];
  const tdColors = ['var(--ok)', 'var(--warn)', 'var(--amber)', 'var(--bad)', '#8e1d16'];
  $('td-scale').style.background = `linear-gradient(90deg, ${tdColors.map((c, i) => `${c} ${(tdStops[i] / TD_MAX) * 100}% ${(tdStops[i + 1] / TD_MAX) * 100}%`).join(', ')})`;
  $('td-ticks').innerHTML = tdStops.slice(1, -1).map((v) => `<span style="left:${(v / TD_MAX) * 100}%">${fmt(v, v % 1 ? 1 : 0)}</span>`).join('')
    + tdNames.map((n, i) => `<em style="left:${((tdStops[i] + tdStops[i + 1]) / 2 / TD_MAX) * 100}%">${n}</em>`).join('');
  function tdZone(v, fuelLeft) {
    const i = [...S.LAND.vy, S.WRECK_V].findIndex((l) => v <= l);
    const k = i < 0 ? 4 : i;
    return k === 4 && fuelLeft <= 10 ? 3 : k; // no fuel, no explosion
  }

  const crew = createCrew($('crew-faces'), $('crew-say'));
  let tornAt;

  const heatFrac = (s, id) => { const c = S.COMPONENTS.find((k) => k.id === id); return (s.temp[id] - S.T_AMB) / (c.heat[1] - S.T_AMB); };
  const lostAt = {};
  const ttb = { at: undefined, v: 0 };

  function recentLoss(s) {
    for (const c of S.COMPONENTS) if (s.lost[c.id] && s.t - (lostAt[c.id] ??= s.t) < 3) return c.name;
    return null;
  }
  function hottest(s) {
    let best = { f: 0, name: '' };
    for (const c of S.COMPONENTS) if (c.heat && !s.lost[c.id]) { const f = heatFrac(s, c.id); if (f > best.f) best = { f, name: c.name, solar: c.model === 'solar' }; }
    return best;
  }

  function update(s, input) {
    if (s.t < 0.05) for (const k in lostAt) delete lostAt[k];
    const p = s.planet;
    const alt = Math.max(0, S.altitude(s));
    const { m, cx, cy } = S.massProps(s);
    const tilt = (s.a * 180) / Math.PI;

    $('planet-tag').textContent = `${p.name} · ${fmt(p.g, 2)} m/s² · ${fmt(p.g / S.G0, 2)} g`;
    $('v-alt').textContent = `${fmt(alt, alt < 100 ? 1 : 0)} m`;
    const live = { vy: Math.max(0, -s.vy), vx: Math.abs(s.vx), tilt: Math.abs(tilt) };
    if (s.touch) Object.assign(live, { vy: s.touch.vy, vx: s.touch.vx, tilt: s.touch.tilt });
    const gr = { vy: S.grade(live.vy, S.LAND.vy), vx: S.grade(live.vx, S.LAND.vx), tilt: S.grade(live.tilt, S.LAND.tilt) };
    for (const k of Object.keys(lw)) {
      const g = S.GRADES[gr[k]];
      lw[k].val.textContent = `${fmt(live[k], 1)} ${lw[k].unit} · ${g.name.split(' ')[0]}`;
      lw[k].val.style.color = g.color;
      lw[k].mark.style.left = `${Math.min(1, live[k] / lw[k].max) * 100}%`;
    }
    const gradeCls = ['ok', 'warn', 'warn', 'bad'];
    const twr = (S.F_MAX * s.limit) / (m * p.g);
    const tw = $('v-twr'); tw.textContent = fmt(twr, 2); cls(tw, twr > 1.15 ? '' : 'bad');
    $('v-mass').textContent = `${fmt(m)} kg`;

    // navigation: wind and where the pad is
    const vw = $('v-wind');
    if (p.rho > 0 && s.wind.speed) {
      const w = s.windNow, gust = Math.abs(w) > s.wind.speed * (0.35 + 0.65 * Math.min(1, Math.max(0, alt) / 300)) * 1.25;
      vw.innerHTML = `Wind <b>${w >= 0 ? '→' : '←'} ${fmt(Math.abs(w), 0)} m/s</b>${gust ? ' <em>Böe</em>' : ''}`;
      vw.hidden = false;
    } else vw.hidden = true;
    const dxPad = -s.x;
    const vp = $('v-pad');
    vp.innerHTML = Math.abs(dxPad) < 10 ? 'Landeplatz <b>unter dir</b>' : `Landeplatz <b>${dxPad > 0 ? '→' : '←'} ${fmt(Math.abs(dxPad), 0)} m</b>`;
    vp.className = Math.abs(dxPad) < 10 ? 'ok' : Math.abs(dxPad) > 70 ? 'warn' : '';

    // touchdown gauge
    const td = $('td');
    const showTd = s.status === 'flying' && alt < 80 && s.vy < -0.2;
    td.hidden = !showTd;
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
    const minLimit = Math.min(...s.crew.map((c) => c.limit));
    cls(g, s.gNow > S.G_LIMIT ? 'bad' : s.gNow > minLimit ? 'warn' : '');
    crew.update(s, alt, gr.vy === 3, performance.now() / 1000);
    const pilot = s.crew[0];
    $('tunnel').style.opacity = s.status === 'flying' ? Math.min(0.97, pilot.out ? 0.97 : pilot.stress ** 1.3 * 0.9) : 0;

    // fuel: amount and how long it lasts at full thrust
    const fuelNow = S.fuel(s), fuelFrac = fuelNow / s.fuel0;
    const fullBurn = fuelNow / (S.F_MAX / (S.ISP * S.G0));
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

    // components
    const awake = s.crew.filter((c) => !c.out).length;
    setRow('capsule', `${awake}/${s.crew.length} wach`, awake / s.crew.length, awake < s.crew.length ? 'var(--bad)' : 'var(--ok)');
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
    const solarGone = s.lost.solarL && s.lost.solarR;
    pb.textContent = solarGone ? 'Paneele weg' : s.panels === 'out' ? 'Paneele einklappen' : 'Paneele ausklappen';
    pb.disabled = solarGone;
    pb.classList.toggle('on', s.panels === 'in' && !solarGone);
    const solarHeat = Math.max(...['solarL', 'solarR'].filter((id) => !s.lost[id]).map((id) => heatFrac(s, id)), 0);
    pb.classList.toggle('warn', s.panels === 'out' && solarHeat > 0.3 && !solarGone);
    const cb = $('c-chute');
    cb.textContent = { burned: 'Schirm verglüht', stowed: 'Fallschirm', open: air ? 'Schirm abwerfen' : 'Schirm (nutzlos)', cut: 'Schirm weg', torn: 'Schirm gerissen' }[s.chute];
    cb.disabled = s.chute === 'cut' || s.chute === 'torn' || s.chute === 'burned' || (s.chute === 'open' && !air);
    cb.classList.toggle('on', s.chute === 'open' && air);
    cb.classList.toggle('ready', s.chute === 'stowed' && air && s.status === 'flying' && s.q <= S.CHUTE_QMAX * S.CHUTE_SAFE && s.t > 0.2);
    // heat: hot or destroyed components override their row
    const rowParts = { capsule: ['capsule'], engine: ['engine'], tankL: ['tankL'], tankR: ['tankR'], battery: ['battery'], solar: ['solarL', 'solarR'], computer: ['computer'], chute: ['chute'], legs: ['legs'] };
    for (const [row, ids] of Object.entries(rowParts)) {
      const lost = ids.filter((id) => s.lost[id]);
      const hot = ids.filter((id) => !s.lost[id]).map((id) => ({ id, f: heatFrac(s, id) })).sort((a, b) => b.f - a.f)[0];
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
    lever.querySelector('.mark span').textContent = `${fmt(s.limit * 100)} %`;
    lever.setAttribute('aria-valuenow', Math.round(s.limit * 100));
    const sas = $('c-sas');
    sas.textContent = `Lageregler: ${{ hold: 'Halten', retro: 'Retro', up: 'Senkrecht', off: 'Aus' }[s.sas || 'off']}`;
    sas.classList.toggle('on', !!s.sas);
    lever.classList.toggle('on', s.throttle > 0);
    const rcs = $('c-rcs');
    rcs.classList.toggle('on', input.rcs !== 0);
    rcs.querySelector('.knob').style.transform = `translateX(${-input.rcs * (rcs.clientWidth / 2 - 22)}px)`;

    // alerts, most important first
    const al = $('alert');
    let msg = null, color = 'var(--bad)', pulse = true;
    if (s.blackout) msg = 'PILOTIN BEWUSSTLOS – KEINE STEUERUNG';
    else if (s.gNow > S.G_LIMIT) msg = 'G-LAST ZU HOCH – SCHUB DROSSELN';
    else if (s.gNow > minLimit && s.throttle > 0) { msg = 'G-LAST: CREW LEIDET'; color = 'var(--warn)'; pulse = false; }
    else if (recentLoss(s)) msg = `${recentLoss(s).toUpperCase()} VERGLÜHT`;
    else if (s.chute === 'torn' && s.t - (tornAt ??= s.t) < 3) msg = 'FALLSCHIRM GERISSEN';
    else if (hottest(s).f > (hottest(s).solar && s.panels === 'out' ? 0.5 : 0.75)) { const h = hottest(s); msg = `HITZE: ${h.name.toUpperCase()} ${fmt(h.f * 100)} %${h.solar && s.panels === 'out' ? ' – EINKLAPPEN!' : ''}`; color = h.f > 0.9 ? 'var(--bad)' : 'var(--warn)'; pulse = h.f > 0.9; }
    else if (S.fuel(s) <= 0) msg = 'TREIBSTOFF LEER';
    else if (fuelFrac < 0.12 && s.throttle > 0) { msg = 'TREIBSTOFF KNAPP'; color = 'var(--warn)'; pulse = false; }
    else if (!s.powered) { msg = 'BATTERIE LEER – PUMPEN AUS, MAX. 60 % SCHUB'; color = 'var(--warn)'; }
    else if (s.powered && s.vy < -0.5 && isFinite(d) && alt <= burnAlt && s.throttle < 0.95 * s.limit) msg = 'BURN!';
    else if (s.battery < 20) { msg = 'BATTERIE SCHWACH'; color = 'var(--warn)'; pulse = false; }
    else if (s.panels === 'in' && !(s.lost.solarL && s.lost.solarR) && s.heatFlux < 4 && s.battery < 45 && s.t > 6) { msg = 'PANEELE AUSKLAPPEN – BATTERIE LÄDT NICHT'; color = 'var(--cyan)'; pulse = false; }
    else if (s.chute === 'stowed' && p.rho > 0 && alt > 120 && alt < 1200 && s.vy < -15 && s.t > 0.2 && !(s.powered && isFinite(d) && alt <= burnAlt)) {
      if (s.q <= S.CHUTE_QMAX * S.CHUTE_SAFE) { msg = 'FALLSCHIRM MÖGLICH'; color = 'var(--cyan)'; pulse = false; }
    }
    if (s.chute !== 'torn') tornAt = undefined;
    al.hidden = !msg || s.status !== 'flying';
    if (msg) { al.textContent = msg; al.style.color = color; al.classList.toggle('pulse', pulse); }
  }

  return { update, reset: crew.reset };
}
