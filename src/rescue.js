// Rescue missions: a lander that is not yours, an orbit you did not choose, and one of your bases to reach.
// Nothing is really random: a scenario is one of a few predefined landers and orbits, picked by a seed,
// and every combination offered is flown by the test pilot (tests/rescue.test.mjs). Pure data.
import * as S from './sim.js';

/** landers that need help. agency: someone else's (flown by remote control), else your own crew vehicle.
 *  d: how much harder it makes the flight; fuelK: fuel left; planets: where it can be (null = everywhere) */
export const LANDERS = {
  shuttle: { name: 'Fähre Pelikan', icon: '🚀', d: 0, fuelK: 1,
    build: { capsule: 'hab', engine: 'std', tanks: 'large', solar: 'std', battery: 'std', chute: 'std', shield: 'light', legs: 'wide' }, note: '4 Plätze, breite Beine' },
  kestrel: { name: 'Kestrel', agency: 'Agentur Nordlicht', icon: '🦅', d: 1, fuelK: 1,
    build: { capsule: 'duo', engine: 'mini', tanks: 'large', solar: 'small', battery: 'std', chute: 'small', shield: 'none', legs: 'light' }, note: 'leicht, schwaches Triebwerk, empfindliche Beine' },
  brick: { name: 'Bulldog', agency: 'Orion Mining', icon: '🚜', d: 1, fuelK: 1,
    build: { capsule: 'armored', engine: 'strong', tanks: 'large', solar: 'small', battery: 'large', chute: 'large', shield: 'light', legs: 'heavy' }, note: 'schwer und stark, kleine Paneele' },
  leaky: { name: 'Albatros', agency: 'Union Spatiale', icon: '💧', d: 2, fuelK: 0.8,
    build: { capsule: 'std', engine: 'eco', tanks: 'std', solar: 'std', battery: 'small', chute: 'std', shield: 'none', legs: 'std' }, note: 'Tankleck: nur 80 % Treibstoff' },
};
/** where it starts: factors on the planet's own orbit. vK < 1: slower than circular, the orbit already falls */
export const ORBITS = {
  // miss: the orbit runs past the base (a sideways burn, Seite, swings it over)
  low: { name: 'Parkbahn', d: 0, alt: 1, dr: 1, miss: true },
  station: { name: 'Station', d: 1, alt: 1.5, dr: 1.2, station: true, miss: true },
  high: { name: 'Hoher Orbit', d: 1, alt: 2.2, dr: 1.6, miss: true },
  late: { name: 'Spät abgedockt', d: 2, alt: 1, dr: 0.65 },
  falling: { name: 'Absturzbahn', d: 2, alt: 1.3, dr: 0.9, vK: 0.97 },
  // planets with air: arriving on a long ellipse whose low point grazes the air; each pass brakes a little
  // (aerobraking, a few laps with the time warp) - or burn the whole way down with the engine
  aero: { name: 'Einfangbahn', d: 1, aero: true },
};
/** aerobraking orbits: [high point, low point] in m above the ground (2-4 passes; planet.aero.land: low enough to land) */
export const AERO = { 'mars-orbit': [6500, 4300], 'terra-orbit': [20000, 7000], 'brontes-orbit': [22000, 8200] };
const STATIONS = ['Kepler', 'Halley', 'Vega', 'Tycho'];
export const LEVELS = [{ name: 'Leicht', cls: 'ok' }, { name: 'Mittel', cls: 'warn' }, { name: 'Schwer', cls: 'bad' }];

/** the orbit override (settings.orbit) for a planet */
export function orbitFor(planet, id, sign = 1) {
  const o = ORBITS[id];
  if (o.aero) return { alt: AERO[planet.id][0], pe: AERO[planet.id][1], downrange: planet.downrange, ...(planet.deorbitAt ? { deorbitAt: planet.deorbitAt } : {}) };
  const out = { alt: Math.round(planet.alt * o.alt), downrange: Math.round(planet.downrange * o.dr) };
  if (planet.deorbitAt) out.deorbitAt = Math.round(planet.deorbitAt * Math.min(o.dr, 1 + (o.alt - 1) * 0.5));
  if (o.vK) out.vK = o.vK;
  // (not where the deorbit point is so far out that there is no room for the side burn before it: Brontes, high)
  if (o.miss && (out.deorbitAt ?? 0) + 6000 < 0.9 * Math.PI * planet.R) Object.assign(out, S.missOrbit({ ...planet, alt: out.alt, deorbitAt: out.deorbitAt }, sign, 12));
  return out;
}

/** every combination a planet offers (the test pilot lands each one; SKIP: the ones that run dry) */
export const SKIP = new Set(['terra-orbit:leaky:late', 'brontes-orbit:shuttle:late', 'brontes-orbit:brick:late', 'brontes-orbit:leaky:late', 'luna-orbit:brick:station']);
export function combos(planetId) {
  const out = [];
  for (const l of Object.keys(LANDERS)) for (const o of Object.keys(ORBITS)) if (!SKIP.has(`${planetId}:${l}:${o}`) && (!ORBITS[o].aero || AERO[planetId])) out.push([l, o]);
  return out;
}

const rand = (seed) => S.seededRandom((seed * 7919 + 13) >>> 0);
/** the scenario number n of a planet: lander, orbit, story, difficulty, reward factor */
export function scenario(planet, n) {
  const h = [...planet.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  // the first call on a planet is an easy one
  const all = combos(planet.id), easy = all.filter(([l, o]) => LANDERS[l].d + ORBITS[o].d <= 1);
  const list = n === 0 && easy.length ? easy : all, r = rand((n * 131 + h) >>> 0);
  const [lid, oid] = list[Math.floor(r() * list.length)];
  const L = LANDERS[lid], O = ORBITS[oid], d = L.d + O.d, level = d <= 1 ? 0 : d <= 2 ? 1 : 2;
  const where = O.station ? `Station ${STATIONS[Math.floor(r() * STATIONS.length)]}` : O.name;
  const story = O.aero && !L.agency ? `Die ${L.name} kommt aus dem All und streift die Atmosphäre. Brems sie über ein paar Runden in der Luft ab (Zeitraffer) und lande an der Basis.`
    : L.agency
    ? `${L.agency} hat den Kontakt zu ihrem Lander ${L.name} verloren (${where}). Übernimm per Fernsteuerung und bring ihn zu unserer Basis.`
    : O.station ? `Die Crew der ${where} muss evakuiert werden. Die ${L.name} dockt ab, bring sie zur Basis.`
      : `Eine Crew sitzt im ${O.name} fest. Hol sie mit der ${L.name} runter zur Basis.`;
  return { n, lander: lid, orbit: oid, L, O, d, level, where, story, title: L.agency ? `${L.name} bergen` : O.station ? 'Station evakuieren' : 'Crew abholen',
    build: S.normalizeBuild(L.build), fuelK: L.fuelK, orbitSet: orbitFor(planet, oid, r() < 0.5 ? 1 : -1), pay: 1 + d * 0.35 };
}
