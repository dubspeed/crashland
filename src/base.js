// Base building, step B (prototype): a small tech tree instead of a fixed mission order, slots the player
// picks (near or far ring), and builder parts unlocked by what the bases have built. Pure data and functions.
import * as S from './sim.js';

/** what has to stand in the base before a module can be flown in */
export const REQS = {
  beacon: [],
  solar: ['beacon'],
  depot: ['beacon'],
  lab: ['solar'],
  rover: ['lab'],
  refinery: ['depot', 'solar'],
  rocket: ['refinery'],
  crew: ['lab', 'rocket'],
};

/** builder options a module unlocks (career); everything not listed here is there from the start */
export const UNLOCKS = {
  beacon: { legs: ['wide'], chute: ['large'] },
  solar: { solar: ['large'], battery: ['large'] },
  depot: { tanks: ['large'] },
  lab: { engine: ['eco'], shield: ['light'], capsule: ['armored'] },
  rover: { legs: ['heavy'] },
  refinery: { engine: ['strong', 'cluster'], tanks: ['huge'], shield: ['shield'] },
  rocket: { capsule: ['hab'] },
};
const LOCKED = {}; // slot -> option -> module that unlocks it
for (const [mod, u] of Object.entries(UNLOCKS)) for (const [slot, opts] of Object.entries(u)) for (const o of opts) (LOCKED[slot] ??= {})[o] = mod;

/** the module that unlocks a builder option, or null if it is there from the start */
export const unlockedBy = (slot, option) => LOCKED[slot]?.[option] ?? null;
/** is a builder option available, given every module built in any base (damaged ones count) */
export function isUnlocked(slot, option, builtTypes) {
  const m = unlockedBy(slot, option);
  return !m || builtTypes.has(m);
}
/** a build with every locked choice replaced by the standard part */
export function allowedBuild(build, builtTypes) {
  const b = { ...build };
  for (const sl of S.BUILD_SLOTS) if (!isUnlocked(sl.id, b[sl.id], builtTypes)) b[sl.id] = S.DEFAULT_BUILD[sl.id];
  return b;
}

// slots: the beacon in the centre, six on a near ring (16 m), six on a far ring (30 m)
export const RINGS = { near: { r: 16, from: 1, bonus: 1.2, name: 'Nah', note: '16 m · +20 % Prämie' }, far: { r: 30, from: 7, bonus: 1, name: 'Weit', note: '30 m · sicherer' } };
export function slotPos(i) {
  if (i === 0) return [0, 0];
  const ring = i < 7 ? 16 : 30, a = ((i - 1) % 6) * (Math.PI / 3) + (i < 7 ? 0.5 : 0.9);
  return [Math.round(Math.cos(a) * ring * 10) / 10, Math.round(Math.sin(a) * ring * 10) / 10];
}
/** the next free slot on a ring (null if full) */
export function freeSlot(base, ring) {
  if (ring === 'center') return base.modules.some((m) => m.slot === 0) ? null : 0;
  const from = RINGS[ring].from;
  for (let i = from; i < from + 6; i++) if (!base.modules.some((m) => m.slot === i)) return i;
  return null;
}
/** older saves: modules without a slot get the nearest one */
export function migrate(base) {
  const b = { ...(base ?? {}), modules: [...(base?.modules ?? [])] };
  delete b.step;
  b.modules = b.modules.map((m) => {
    if (m.slot !== undefined) return m;
    let best = 0, bd = Infinity;
    for (let i = 0; i < 13; i++) { const [x, z] = slotPos(i), d = Math.hypot(m.x - x, m.z - z); if (d < bd && !b.modules.some((o) => o.slot === i)) { bd = d; best = i; } }
    return { ...m, slot: best };
  });
  return b;
}

/** missions the base can fly now (prerequisites standing, not built yet), and the ones still locked */
export function missions(base) {
  const built = new Set(base.modules.map((m) => m.type));
  const open = [], locked = [];
  for (const t of S.MISSIONS) {
    if (built.has(t)) continue;
    const need = REQS[t].filter((r) => !built.has(r));
    (need.length ? locked : open).push({ type: t, need });
  }
  return { open, locked, done: built.size, total: S.MISSIONS.length };
}

// ---------- career across planets and supply contracts ----------
/** career order: Luna first, then Mars, then Terra and Brontes (either) */
export const PLANET_NEEDS = { 'luna-orbit': null, 'mars-orbit': 'luna-orbit', 'terra-orbit': 'mars-orbit', 'brontes-orbit': 'mars-orbit' };
export const isComplete = (base) => S.MISSIONS.every((t) => base.modules.some((m) => m.type === t));
/** may this planet's base be worked on yet (career); loadBase(id) gives a base */
export function planetOpen(id, loadBase) {
  const need = PLANET_NEEDS[id];
  return !need || isComplete(loadBase(need));
}

const SUPPLY = ['fuel', 'parts', 'science', 'crewswap'];
// deterministic small random from a seed
const rand = (seed) => { let x = (seed * 2654435761) >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };
/** three supply offers for a finished base: a cargo and a drop point right next to one of its modules.
 *  The offers change after every delivery (base.cseed). */
export function contracts(base) {
  const r = rand(1 + (base.cseed ?? 0) * 7919 + base.modules.length), out = [];
  const mods = base.modules.filter((m) => S.CARGO[m.type] && !S.CARGO[m.type].supply);
  for (let k = 0; k < 3 && mods.length; k++) {
    const left = SUPPLY.filter((t) => !out.some((o) => o.type === t)); // three different cargos
    const type = left[Math.floor(r() * left.length)];
    // a free spot ~9 m from a module, away from all the others
    let best = null;
    for (let tries = 0; tries < 40 && !best; tries++) {
      const m = mods[Math.floor(r() * mods.length)], a = r() * Math.PI * 2, d = 8.5 + r() * 2;
      const x = Math.round((m.x + Math.cos(a) * d) * 10) / 10, z = Math.round((m.z + Math.sin(a) * d) * 10) / 10;
      const clear = base.modules.every((o) => Math.hypot(o.x - x, o.z - z) > (S.CARGO[o.type]?.r ?? 2) + 5) && out.every((o) => Math.hypot(o.x - x, o.z - z) > 6);
      if (clear) best = { type, x, z, near: m.type };
    }
    if (best) out.push(best);
  }
  return out;
}
