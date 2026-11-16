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

  // approach layout 2 (side pads, sideways start): first steer the cross onto the pad (opt.pad: its kind) by
  // tilting in Halten and burning, then land as usual (Landen, centring on that pad)
  const padOf = (s) => (s.pads ? s.pads.find((p) => p.kind === (opt.pad ?? 'main')) ?? s.pads[0] : { x: 0, z: 0 });
  function steer(s, act) {
    if (!mem.steerInit) { mem.steerInit = true; act('panels'); }
    const P0 = padOf(s), pr = s.pred, alt = altOf(s), h = s.y - S.terrainHeight(P0.x, P0.z);
    const { m } = S.massProps(s);
    // the braking burn at the end also takes the sideways speed off: aim the free-fall cross a bit past the pad
    const vh = Math.hypot(s.vx, s.vz), vImp = Math.sqrt(s.vy * s.vy + 2 * P.g * Math.max(0, h));
    const tb = vImp / Math.max(1, s.spec.fMax / m * 0.6 - P.g), over = vh * tb * 0.3;
    const ux = vh > 0.5 ? s.vx / vh : 0, uz = vh > 0.5 ? s.vz / vh : 0;
    const mx = P0.x + ux * over - (pr?.x ?? s.x), mz = P0.z + uz * over - (pr?.z ?? s.z), miss = Math.hypot(mx, mz);
    // thick air: fall upright until the chute is safe (steering burns now would only cost the fuel the landing needs)
    const thick = P.rho > 0.5 && chute && s.spec.ids?.has?.('chute') !== false;
    if (thick && s.chute === 'stowed') {
      if (s.t > 0.1 && s.q < S.CHUTE_QMAX * 0.9 && alt < 1200) act('chute');
      return { thrust: false, rcs: Math.max(-1, Math.min(1, -s.a * 2)), rcsZ: Math.max(-1, Math.min(1, -s.b * 2)) };
    }
    // (hand over early enough for Landen to turn the lander upright: ~2 s per radian of tilt)
    if (!pr || Math.min(alt, h) < S.burnAltitude(s) * 1.5 + 25 + Math.hypot(s.a, s.b) * 2 * Math.abs(s.vy) || (s.chute === 'open' && h < 260)) {
      mem.steered = true; mem.init = true;
      if ((opt.mode ?? 'retro2') === 'retro2') { act('sas'); act('sas'); } // hold -> retro -> retro2
      return null;
    }
    // thick air: the chute as soon as it is safe; under it the pad steers the canopy towards the pad
    if (s.chute === 'open' && thick) {
      const cx = P0.x - (pr?.x ?? s.x), cz = P0.z - (pr?.z ?? s.z), cm = Math.hypot(cx, cz) || 1, k = Math.min(1, cm / 80);
      return { thrust: false, rcs: -(cx / cm) * k, rcsZ: (cz / cm) * k };
    }
    // on target: stand upright and wait (keep watching the cross: drag and wind still move it)
    if (miss < (mem.onT ? 10 : 5)) {
      mem.onT = true;
      return { thrust: false, rcs: Math.max(-1, Math.min(1, -s.a * 2)), rcsZ: Math.max(-1, Math.min(1, -s.b * 2)) };
    }
    mem.onT = false;
    // tilt towards the miss, more the further off; burn once the tilt is there (the pad turns the lander)
    const th = Math.min(0.9, 0.2 + miss / 100), ta = -th * (mx / miss), tb2 = th * (mz / miss);
    const rcs = Math.max(-1, Math.min(1, (ta - s.a) * 2)), rcsZ = Math.max(-1, Math.min(1, (tb2 - s.b) * 2));
    s.limit = Math.min(1, (S.G_LIMIT * 0.97 * S.G0 * m) / s.spec.fMax, 0.2 + miss / 250);
    return { thrust: Math.hypot(ta - s.a, tb2 - s.b) < 0.12, rcs: Math.abs(rcs) < 0.05 ? 0 : rcs, rcsZ: Math.abs(rcsZ) < 0.05 ? 0 : rcsZ };
  }

  function normal(s, act) {
    if (s.pads && !mem.steered) { const r = steer(s, act); if (r) return r; }
    if (!mem.init) {
      mem.init = true;
      if ((opt.mode ?? 'retro2') === 'retro2') { act('sas'); act('sas'); } // hold -> retro -> retro2
      act('panels'); // fold for the entry
    }
    // side pads: height over the pad counts too (a pillar); not over it yet, stop 12 m above it and fly in
    let alt = altOf(s);
    if (s.pads) {
      const P0 = padOf(s), hP = s.y - S.terrainHeight(P0.x, P0.z), dP = Math.hypot(P0.x - s.x, P0.z - s.z);
      alt = Math.min(alt, P0.kind === 'spire' && dP > P0.r * 0.6 ? hP - 8 : hP);
    }
    if (s.panels === 'in' && s.heatFlux < 4 && s.t > 8) act('panels');
    if (chute && P.rho > 0 && s.chute === 'stowed' && s.t > 0.1 && s.q < S.CHUTE_QMAX * 0.9 && alt < 1200) act('chute');
    if (s.chute === 'open' && alt < 150) act('chute');
    const { m } = S.massProps(s);
    const gcap = (S.G_LIMIT * 0.97 * S.G0 * m) / s.spec.fMax;
    s.limit = Math.min(1, gcap);
    if (!mem.burning && alt <= S.burnAltitude(s) * 1.3 + 10) mem.burning = true;
    let thrust = false;
    if (mem.burning) {
      const req = s.vy < -1.5 ? (s.vy * s.vy - 2.25) / (2 * Math.max(alt - 0.5, 0.3)) + P.g : P.g * (alt < 0 ? 1.15 : 0.95) - s.drag / m;
      const lw = Math.min(1, gcap, (req * m) / s.spec.fMax / Math.max(0.5, S.upVector(s).y));
      s.limit = Math.max(0.05, lw);
      thrust = lw >= 0.05 || s.vy < -2; // (on Luna the lowest setting lifts the lander: pulse instead)
    }
    const P0 = padOf(s), dx = P0.x - s.x, dz = P0.z - s.z, d = Math.hypot(dx, dz);
    // side pads (small): a ground speed that can still stop over the distance left (Landen's command scale: vmax)
    const vmax = Math.max(1, Math.min(S.VCMD, altOf(s) * 0.2));
    const want = (s.pads ? Math.min(1, Math.sqrt(2 * 0.8 * d) / vmax) : Math.min(1, d / 25)) * (altOf(s) > 3 ? 1 : 0);
    const mx = d > 0.5 ? (dx / d) * want : 0, mz = d > 0.5 ? (dz / d) * want : 0;
    let rcs = 0, rcsZ = 0;
    if ((opt.mode ?? 'retro2') === 'retro2') { if (s.sas === 'retro2') { rcs = -mx; rcsZ = mz; } } // (not while the switch still waits: in Halten the pad turns the lander)
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
      if (!mem.tgt) {
        mem.tgt = true; act('sas');
        // the cheapest plan whose low point is clear (like tapping the chip)
        const plans = [1, 2, 3].map((k) => S.meetPlan(s, k)).filter((m) => m?.ok);
        if (plans.length) act(`plan:${plans.reduce((a, b) => (Math.abs(b.dv) < Math.abs(a.dv) ? b : a)).k}`);
      }
      // hold the thrust: far, the dosed main engine; close, the computer's RCS approach
      return { thrust: s.sas === 'target', rcs: 0, rcsZ: 0 };
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
      else {
        const og = S.orbitGuide(s);
        // (after a docking right at the pad the cue can be long past: like a player, wait for the next lap)
        if (s.target?.docked && og && og.brakeIn > 5) mem.cueSeen = true; // a fresh braking cue after docking
        if (!og || (og.brakeIn < (opt.offset ?? 0) && (!s.target?.docked || mem.cueSeen))) mem.phase = 'brake';
      }
    }
    if (mem.phase === 'brake') {
      mem.lim0 ??= s.limit;
      thrust = !p || p.x > 0;
      // only once the engine points against the flight direction (after Ziel / Seite the lander may still face elsewhere)
      { const u = S.upVector(s), v = Math.hypot(s.vx, s.vy, s.vz) || 1; if ((u.x * s.vx + u.y * s.vy + u.z * s.vz) / v > -0.9 && v > 30) thrust = thrust && false; }
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
