import * as S from './sim.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const cls = (el, c) => { el.className = c || ''; };

export function createHud() {
  const list = $('part-list');
  const rows = {};
  const partRows = [
    ['capsule', 'Kommandokapsel'], ['engine', 'Antrieb'], ['tankL', 'Tank L'], ['tankR', 'Tank R'],
    ['battery', 'Batterien'], ['solar', 'Solarpaneele'], ['computer', 'Bordcomputer'],
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

  function update(s, input) {
    const p = s.planet;
    const alt = Math.max(0, S.altitude(s));
    const { m, cx, cy } = S.massProps(s);
    const tilt = (s.a * 180) / Math.PI;

    $('planet-tag').textContent = `${p.name} · ${fmt(p.g, 2)} m/s² · ${fmt(p.g / S.G0, 2)} g`;
    $('v-alt').textContent = `${fmt(alt, alt < 100 ? 1 : 0)} m`;
    const vy = $('v-vy'); vy.textContent = `${fmt(-s.vy, 1)} m/s`;
    cls(vy, -s.vy <= S.LAND.vy ? 'ok' : alt < 60 ? 'bad' : '');
    const vx = $('v-vx'); vx.textContent = `${s.vx >= 0 ? '→' : '←'} ${fmt(Math.abs(s.vx), 1)} m/s`;
    cls(vx, Math.abs(s.vx) <= S.LAND.vx ? 'ok' : 'warn');
    const ti = $('v-tilt'); ti.textContent = `${fmt(tilt, 1)}°`;
    cls(ti, Math.abs(tilt) <= S.LAND.tilt ? 'ok' : 'warn');
    const twr = (S.F_MAX * s.limit) / (m * p.g);
    const tw = $('v-twr'); tw.textContent = fmt(twr, 2); cls(tw, twr > 1.15 ? '' : 'bad');
    $('v-mass').textContent = `${fmt(m)} kg`;

    const g = $('v-g'); g.textContent = `${fmt(s.gNow, 2)} g`;
    cls(g, `big ${s.gNow > S.G_LIMIT ? 'bad' : s.gNow > S.G_LIMIT * 0.85 ? 'warn' : ''}`);
    const st = $('b-stress');
    st.style.width = `${Math.min(1, s.gStress) * 100}%`;
    st.style.background = s.gStress > 0.6 ? 'var(--bad)' : 'var(--warn)';
    $('v-stress').textContent = s.blackout ? 'Crew bewusstlos' : s.gStress > 0 ? `Belastung ${fmt(s.gStress * 100)} %` : 'Crew stabil';

    // burn gauge: altitude vs stopping distance on one scale
    const d = S.stoppingDistance(s);
    const scale = Math.max(p.alt, alt) * 1.05;
    const gauge = $('burn-gauge');
    gauge.style.opacity = s.powered ? 1 : 0.25;
    $('burn-stop').style.height = `${Math.min(1, d / scale) * 100}%`;
    $('burn-alt').style.bottom = `calc(${Math.min(1, alt / scale) * 100}% - 1px)`;
    const bl = $('burn-label');
    let label = '', lc = 'mute';
    if (s.status === 'landed') { label = 'GELANDET'; lc = 'ok'; }
    else if (s.status === 'crashed') { label = 'AUFSCHLAG'; lc = 'bad'; }
    else if (!s.powered) { label = 'OFFLINE'; lc = 'bad'; }
    else if (s.vy >= -0.5) { label = 'SCHWEBT'; lc = ''; }
    else if (!isFinite(d)) { label = 'ZU WENIG SCHUB'; lc = 'bad'; }
    else if (alt <= d * 1.02) { label = 'BURN!'; lc = 'bad'; }
    else if (alt <= d * 1.35) { label = 'BEREIT'; lc = 'warn'; }
    else { label = `in ${fmt(Math.max(0, (alt - d) / -s.vy), 0)} s`; lc = 'ok'; }
    bl.textContent = label; cls(bl, lc);

    // components
    setRow('capsule', s.blackout ? 'Blackout' : 'Crew ok', 1 - Math.min(1, s.gStress), s.gStress > 0.6 ? 'var(--bad)' : 'var(--ok)');
    setRow('engine', `${fmt(s.throttle * 100)} %`, s.throttle, 'var(--amber)');
    const fc = (f) => (f / S.FUEL_MAX < 0.2 ? 'var(--bad)' : 'var(--amber)');
    setRow('tankL', `${fmt(s.fuelL)} kg`, s.fuelL / S.FUEL_MAX, fc(s.fuelL));
    setRow('tankR', `${fmt(s.fuelR)} kg`, s.fuelR / S.FUEL_MAX, fc(s.fuelR));
    setRow('battery', `${fmt(s.battery)} %`, s.battery / S.BAT_CAP, s.battery < 20 ? 'var(--bad)' : 'var(--cyan)');
    setRow('solar', `${fmt(p.solar * 100)} % Licht`, p.solar, 'var(--cyan)');
    setRow('computer', s.powered ? 'online' : 'offline', s.powered ? 1 : 0, 'var(--ok)');
    $('v-com').textContent = `x ${cx >= 0 ? '+' : '−'}${fmt(Math.abs(cx * 100), 1)} cm · y ${fmt(cy, 2)} m`;
    const tq = $('v-torque');
    tq.textContent = `${fmt(s.torqueCom / 1000, 1)} kNm`;
    cls(tq, Math.abs(s.torqueCom) > S.RCS_TORQUE * 0.7 ? 'bad' : Math.abs(s.torqueCom) > 2500 ? 'warn' : '');

    // controls state
    $('v-limit').textContent = `${fmt(s.limit * 100)} %`;
    const lim = $('c-limit');
    if (document.activeElement !== lim) lim.value = Math.round(s.limit * 100);
    const sas = $('c-sas');
    sas.textContent = `Lageregler: ${{ retro: 'Retro', up: 'Senkrecht', off: 'Aus' }[s.sas || 'off']}`;
    sas.classList.toggle('on', !!s.sas);
    $('c-feed').textContent = `Tanks: ${{ LR: 'L+R', L: 'nur L', R: 'nur R' }[s.feed]}`;
    $('c-feed').classList.toggle('on', s.feed !== 'LR');
    $('c-thrust').classList.toggle('on', s.throttle > 0);
    $('c-left').classList.toggle('on', input.rcs > 0);
    $('c-right').classList.toggle('on', input.rcs < 0);

    // alerts, most important first
    const al = $('alert');
    let msg = null, color = 'var(--bad)', pulse = true;
    if (s.blackout) msg = 'BLACKOUT – CREW BEWUSSTLOS';
    else if (s.gNow > S.G_LIMIT) msg = 'G-LAST ZU HOCH – SCHUB DROSSELN';
    else if (S.fuel(s) <= 0) msg = 'TREIBSTOFF LEER';
    else if (!s.powered) { msg = 'BATTERIE LEER – PUMPEN AUS, MAX. 60 % SCHUB'; color = 'var(--warn)'; }
    else if (s.powered && s.vy < -0.5 && isFinite(d) && alt <= d * 1.02 && s.throttle < 0.95 * s.limit) msg = 'BURN!';
    else if (s.battery < 20) { msg = 'BATTERIE SCHWACH'; color = 'var(--warn)'; pulse = false; }
    al.hidden = !msg || s.status !== 'flying';
    if (msg) { al.textContent = msg; al.style.color = color; al.classList.toggle('pulse', pulse); }
  }

  return { update };
}
