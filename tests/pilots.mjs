// Autopilots for the tests: they only use what a player has (thrust, limiter, tilt pad, chute, panels,
// attitude mode) and follow the HUD's advice. No imports: the sim module S is passed in, so the same
// source also runs inside the browser page for the end-to-end run (tests/e2e.mjs).
//
// makePilot(S, planet, options) returns (s, act) => input, called once per simulation step.
// options: mode ('retro2' | 'hold', normal levels), offset (s relative to the brake cue, vacuum orbits),
// dD (m relative to the deorbit point, thick-air orbits), chute (false = never), aimX/aimZ (target),
// dropShield ('hint' | time in s: jettison the heat shield).
export function makePilot(S, P, opt = {}) {
  const mem = { init: false, phase: 'wait', burning: false };
  const chute = opt.chute !== false;
  const altOf = (s) => S.altitude(s);

  function normal(s, act) {
    if (!mem.init) {
      mem.init = true;
      if ((opt.mode ?? 'retro2') === 'retro2') { act('sas'); act('sas'); } // hold -> retro -> retro2
      act('panels'); // fold for the entry
    }
    const alt = altOf(s);
    if (s.panels === 'in' && s.heatFlux < 4 && s.t > 8) act('panels');
    if (chute && P.rho > 0 && s.chute === 'stowed' && s.t > 0.1 && s.q < S.CHUTE_QMAX * 0.9 && alt < 1200) act('chute');
    if (s.chute === 'open' && alt < 150) act('chute');
    const { m } = S.massProps(s);
    const gcap = (S.G_LIMIT * 0.97 * S.G0 * m) / s.spec.fMax;
    s.limit = Math.min(1, gcap);
    if (!mem.burning && alt <= S.burnAltitude(s) * 1.3 + 10) mem.burning = true;
    let thrust = false;
    if (mem.burning) {
      const req = s.vy < -1.5 ? (s.vy * s.vy - 2.25) / (2 * Math.max(alt - 0.5, 0.3)) + P.g : P.g * 0.95 - s.drag / m;
      s.limit = Math.max(0.05, Math.min(1, gcap, (req * m) / s.spec.fMax / Math.max(0.5, S.upVector(s).y)));
      thrust = true;
    }
    const dx = -s.x, dz = -s.z, d = Math.hypot(dx, dz);
    const want = Math.min(1, d / 25) * (alt > 3 ? 1 : 0);
    const mx = d > 0.5 ? (dx / d) * want : 0, mz = d > 0.5 ? (dz / d) * want : 0;
    let rcs = 0, rcsZ = 0;
    if ((opt.mode ?? 'retro2') === 'retro2') { rcs = -mx; rcsZ = mz; }
    else {
      const vwx = mx * 8 - s.vx, vwz = mz * 8 - s.vz;
      const ta = -Math.max(-0.3, Math.min(0.3, vwx * 0.05)), tb = Math.max(-0.3, Math.min(0.3, vwz * 0.05));
      rcs = thrust ? Math.max(-1, Math.min(1, (ta - s.a) * 4)) : 0;
      rcsZ = thrust ? Math.max(-1, Math.min(1, (tb - s.b) * 4)) : 0;
      if (Math.abs(rcs) < 0.05) rcs = 0;
      if (Math.abs(rcsZ) < 0.05) rcsZ = 0;
    }
    return { thrust, rcs, rcsZ };
  }

  function orbit(s, act) {
    const p = s.pred, alt = altOf(s);
    const chute = opt.chute !== false && s.spec.ids.has('chute'); // a lander built without one
    let thrust = false;
    // when to brake: the HUD cue (vacuum / thin air) or the deorbit point (thick air)
    // a module to fetch: Ziel (Bremsen -> Ziel), hold the thrust (the computer doses it) until it docks; the
    // mode goes back to Bremsen by itself
    if (mem.phase === 'wait' && s.target?.dock && !s.target.docked) {
      if (!mem.tgt) { mem.tgt = true; act('sas'); }
      const tr = S.targetRel(s);
      if (!tr || !tr.near || s.sas !== 'target') return { thrust: s.sas === 'target', rcs: 0, rcsZ: 0, tx: 0, ty: 0, tz: 0 };
      // close: RCS like a player with the docking display - line the port up, then creep in
      const p = tr.port, pd = Math.max(0.01, Math.hypot(p.x, p.y, p.z));
      const sp = Math.min(3, 0.12 + tr.portDist * 0.08) * (tr.offDist > 1.5 && tr.along < 6 ? 0 : 1);
      const want = { x: (p.x / pd) * sp, y: (p.y / pd) * sp, z: (p.z / pd) * sp };
      const c = (v) => Math.max(-1, Math.min(1, v));
      // vrel is how the lander moves relative to the module
      return { thrust: false, rcs: 0, rcsZ: 0, tx: c((want.x - tr.vrel.x) * 2), ty: c((want.y - tr.vrel.y) * 2), tz: c((want.z - tr.vrel.z) * 2) };
    }

    // the orbit misses the base: at the cheapest point (a quarter orbit before it) switch to Seite and burn
    // until the plane runs over the base; Seite then hands back to Bremsen by itself
    const tm = opt.fixPlane === false ? null : S.trackMiss(s);
    if (mem.phase === 'wait' && tm && !mem.sideDone && (mem.side || (Math.abs(tm.miss) > 40 && tm.best < 0.5 && tm.best > -20))) {
      if (!mem.side) { mem.side = true; mem.lim0 ??= s.limit; act('sas'); } // Bremsen -> Seite
      if (s.sas === 'side') {
        const u = S.upVector(s), l = tm.dvMag || 1, align = (u.x * tm.dv.x + u.y * tm.dv.y + u.z * tm.dv.z) / l;
        return { thrust: tm.dvMag > S.SIDE_DONE && align > 0.985, rcs: 0, rcsZ: 0 };
      }
      if (s.sasPending === 'side') return { thrust: false, rcs: 0, rcsZ: 0 };
      mem.side = false; mem.sideDone = true; // back on Bremsen
    }
    // aerobraking orbit: let the air take the speed off over a few passes until the high point is low enough
    if (mem.phase === 'wait' && opt.apMax && S.orbitInfo(s).ap > opt.apMax) return { thrust: false, rcs: 0, rcsZ: 0 };
    if (mem.phase === 'wait') {
      if (P.deorbitAt) { if (S.padAhead(s) < P.deorbitAt + (opt.dD ?? 0)) mem.phase = 'brake'; }
      else { const og = S.orbitGuide(s); if (!og || og.brakeIn < (opt.offset ?? 0)) mem.phase = 'brake'; }
    }
    if (mem.phase === 'brake') {
      mem.lim0 ??= s.limit;
      thrust = !p || p.x > 0;
      if (!thrust) { mem.phase = 'coast'; s.limit = mem.lim0; } // limiter back up after the fine part (HUD reminds)
      // follow the fine-control hint (unless the optional automatic fine control does it)
      const fh = s.settings?.autoFine || !thrust ? null : S.fineHint(s);
      if (fh) s.limit = fh.limit;
    }
    // panels: by temperature, like a player watching the parts panel
    const solar = Math.max(s.temp.solarL, s.temp.solarR);
    if (s.panels === 'out' && solar > 200) act('panels');
    if (s.panels === 'in' && solar < 150 && s.heatFlux < 20) act('panels');
    // chute when the HUD says it is possible, cut low; on Brontes brake for it first
    if (chute && P.rho > 0 && s.chute === 'stowed' && mem.phase !== 'wait' && S.chuteSafe(s) && alt < S.CHUTE_MAX_ALT(P) && s.vy < -10) act('chute');
    if (s.chute === 'open' && alt < (P.deorbitAt ? 150 : 120)) act('chute');
    if (chute && mem.phase === 'coast' && S.brakeForChute(s)) {
      mem.limChute ??= s.limit;
      thrust = true; s.limit = Math.max(0.05, Math.round(S.chuteBrakeLimit(s) * 20) / 20);
    } else if (mem.limChute !== undefined && s.chute === 'open') { s.limit = mem.limChute; mem.limChute = undefined; } // back up (HUD reminds)
    // final burn
    // thick air: chute first, cut it, then burn; thin air (Mars): the canopy alone is far too fast, so the
    // burn starts with it still open
    const thick = P.rho > 0.5;
    const canLand = thick ? s.chute !== 'open' && (s.chute !== 'stowed' || !chute) : true;
    if (mem.phase === 'coast' && canLand && alt <= S.burnAltitude(s) * 1.25 + 10) mem.phase = 'land';
    let rcs = 0, rcsZ = 0;
    if (mem.phase === 'land' && canLand) {
      const { m } = S.massProps(s);
      const req = s.vy < -1.5 ? (s.vy * s.vy - 2.25) / (2 * Math.max(alt - 0.5, 0.3)) + P.g - s.drag / m : P.g * 0.95 - s.drag / m;
      s.limit = Math.max(0.05, Math.min(P.deorbitAt ? 1 : 0.75, (req * m) / s.spec.fMax / Math.max(0.5, S.upVector(s).y)));
      thrust = true;
    }
    // steer the canopy towards the pad (the tilt pad does this for a player)
    if (s.chute === 'open') {
      const d = Math.hypot(s.x, s.z);
      if (d > 3) { const k = Math.min(1, d / 40); rcs = (s.x / d) * k; rcsZ = (-s.z / d) * k; }
    }
    return { thrust, rcs, rcsZ };
  }

  // heat shield decoupler: 'hint' = drop it when the HUD says so, a number = drop it at that time
  const fly = P.orbit ? orbit : normal;
  if (opt.dropShield === undefined) return fly;
  return (s, act) => {
    if (S.hasPart(s, 'shield') && (opt.dropShield === 'hint' ? S.shieldDropHint(s) : s.t >= opt.dropShield)) act('shield');
    return fly(s, act);
  };
}
