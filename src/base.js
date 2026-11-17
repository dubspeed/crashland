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

// ---------- research (career): parts bought once with science points, for every base ----------
/** the research tree: one node per builder part; branches run left to right, need = nodes bought before */
export const RESEARCH = [
  { id: 'engine.eco', branch: 'drive', cost: 3, need: [] },
  { id: 'engine.strong', branch: 'drive', cost: 5, need: ['engine.eco'] },
  { id: 'engine.cluster', branch: 'drive', cost: 8, need: ['engine.strong'] },
  { id: 'tanks.large', branch: 'tanks', cost: 3, need: [] },
  { id: 'tanks.huge', branch: 'tanks', cost: 6, need: ['tanks.large'] },
  { id: 'solar.large', branch: 'power', cost: 2, need: [] },
  { id: 'battery.large', branch: 'power', cost: 2, need: ['solar.large'] },
  { id: 'legs.wide', branch: 'land', cost: 2, need: [] },
  { id: 'legs.heavy', branch: 'land', cost: 5, need: ['legs.wide'] },
  { id: 'chute.large', branch: 'land', cost: 2, need: [] },
  { id: 'shield.light', branch: 'heat', cost: 3, need: [] },
  { id: 'shield.shield', branch: 'heat', cost: 6, need: ['shield.light'] },
];
export const BRANCHES = { drive: 'Antrieb', tanks: 'Tanks', power: 'Energie', land: 'Landung', heat: 'Hitzeschutz' };
const NODE = Object.fromEntries(RESEARCH.map((n) => [n.id, n]));
export const researchNode = (slot, option) => NODE[`${slot}.${option}`] ?? null;
/** a node's state: 'done', 'open' (buyable now, if the points suffice) or 'locked' (an earlier node is missing) */
export function researchState(id, done) {
  if (done.has(id)) return 'done';
  return NODE[id].need.every((n) => done.has(n)) ? 'open' : 'locked';
}
/** buy a node: { sp, done } -> new state, or null if it cannot be bought */
export function research(state, id) {
  const n = NODE[id], done = new Set(state.done ?? []);
  if (!n || researchState(id, done) !== 'open' || (state.sp ?? 0) < n.cost) return null;
  return { sp: state.sp - n.cost, done: [...done, id] };
}
/** is a builder option available, given the research done (a Set of node ids) */
export function isUnlocked(slot, option, done) {
  const n = researchNode(slot, option);
  return !n || done.has(n.id);
}
/** a build with every locked choice replaced by the standard part */
export function allowedBuild(build, done) {
  const b = { ...build };
  for (const sl of S.BUILD_SLOTS) if (!isUnlocked(sl.id, b[sl.id], done)) b[sl.id] = S.DEFAULT_BUILD[sl.id];
  return b;
}
/** older saves: the parts their built modules unlocked count as researched */
const OLD_UNLOCKS = { beacon: ['legs.wide', 'chute.large'], solar: ['solar.large', 'battery.large'], depot: ['tanks.large'], lab: ['engine.eco', 'shield.light'], rover: ['legs.heavy'], refinery: ['engine.strong', 'engine.cluster', 'tanks.huge', 'shield.shield'] };
export const migratedResearch = (builtTypes) => RESEARCH.map((n) => n.id).filter((id) => [...builtTypes].some((t) => OLD_UNLOCKS[t]?.includes(id)));

/** science points a delivered cargo brings (damaged: half); research labs and rovers on that base add one each */
export const SCIENCE = { beacon: 1, solar: 1, depot: 1, lab: 3, rover: 2, refinery: 2, rocket: 2, crew: 4, science: 3, parts: 1, crewswap: 2, fuel: 0 };
export const PLANET_SCIENCE = { 'luna-orbit': 1, 'mars-orbit': 1.5, 'terra-orbit': 2, 'brontes-orbit': 2 };
export const RESCUE_SCIENCE = 1;
export function sciencePoints(type, planetId, modules = [], damaged = false) {
  const base = SCIENCE[type] ?? 0;
  if (!base) return 0;
  const extra = modules.filter((m) => !m.damaged && (m.type === 'lab' || m.type === 'rover')).length;
  const v = Math.round((base + extra) * (PLANET_SCIENCE[planetId] ?? 1));
  return damaged ? Math.floor(v / 2) : v;
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

/** every base sits on its own kind of landing site */
export const BASE_SITES = { 'luna-orbit': 'crater', 'mars-orbit': 'canyon', 'terra-orbit': 'mesa', 'brontes-orbit': 'crater' };

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
