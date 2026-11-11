// Money for the base career (prototype): every part has a price, fuel costs per kg, a delivered cargo pays a
// fee. Pure functions on top of the flight model, so the numbers can be tested and tuned without a browser.
// Amounts in credits (Cr).
import * as S from './sim.js';

// part prices per builder option (Cr); the cargo core replaces the capsule on cargo flights
export const PRICES = {
  capsule: { duo: 4000, std: 6000, armored: 9000, hab: 10000 },
  engine: { mini: 2000, eco: 7000, std: 6000, strong: 10000, cluster: 18000 },
  tanks: { mini: 800, small: 1200, std: 2000, large: 3000, huge: 4500 },
  solar: { none: 0, small: 1000, std: 2000, large: 4000 },
  battery: { small: 800, std: 1500, large: 3500 },
  chute: { none: 0, small: 800, std: 1500, large: 2500 },
  shield: { none: 0, light: 2000, shield: 4000 },
  legs: { light: 1000, std: 1500, wide: 2500, heavy: 3500 },
};
export const CARGO_CORE = 2000; // the uncrewed core that flies a cargo
export const FUEL_PRICE = 10; // Cr per kg
export const START_MONEY = 40000;
export const LOAN = 30000; // emergency credit, paid back from half of each payout
// what a delivered cargo pays (damaged: 40 %)
// later planets pay more (and are harder)
export const PLANET_PAY = { 'luna-orbit': 1, 'mars-orbit': 1.3, 'terra-orbit': 1.6, 'brontes-orbit': 2 };
export const FEES = { fuel: 16000, parts: 14000, science: 20000, crewswap: 26000, beacon: 14000, solar: 16000, depot: 18000, lab: 22000, rover: 19000, refinery: 22000, rocket: 24000, crew: 30000 };
export const RECOVER = { landed: 0.4, hard: 0.25 }; // share of the part value a landed descent stage brings back

/** what the base's intact modules do for money: cheaper fuel, income per later mission */
export function baseEconomy(modules = []) {
  let fuel = 1, income = 0;
  for (const m of modules) {
    if (m.damaged) continue;
    if (m.type === 'depot') fuel *= 0.85;
    if (m.type === 'refinery') fuel *= 0.7;
    if (m.type === 'lab') income += 3000;
    if (m.type === 'rover') income += 2000;
  }
  return { fuelPrice: FUEL_PRICE * fuel, income };
}

/** price of the parts of a build (without fuel) */
export function partsPrice(build) {
  const b = S.normalizeBuild(build);
  let sum = 0;
  for (const sl of S.BUILD_SLOTS) {
    if (sl.id === 'capsule' && b.payload) { sum += CARGO_CORE; continue; }
    sum += PRICES[sl.id]?.[b[sl.id]] ?? 0;
  }
  return sum;
}

/** what a flight costs: parts plus the fuel it is filled with on that planet */
export function flightCost(build, planet, fuelK = 1, fuelPrice = FUEL_PRICE) {
  const s = S.createState(planet, { build, fuelK, rnd: () => 0.5, windHeading: 0 });
  const parts = partsPrice(build), fuel = Math.round(s.fuel0 * fuelPrice);
  return { parts, fuel, total: parts + fuel };
}

/** the cheapest lander that can still fly a cargo (for the emergency credit) */
export function cheapestCost(type, planet, fuelK, fuelPrice) {
  const b = { capsule: 'duo', engine: 'mini', tanks: 'mini', solar: 'none', battery: 'small', chute: 'none', shield: 'none', legs: 'light' };
  return flightCost(S.CARGO[type].crew ? { ...b, capsule: 'hab' } : { ...b, payload: type }, planet, fuelK, fuelPrice).total;
}

/** what a finished mission brings in: fee, aim bonus, unburnt fuel, recovered parts, base income.
 *  result: 'intact' | 'damaged' | 'far' | 'lost' (as in main.js) */
export function payout(s, type, result, cost, econ, feeMult = 1) {
  const lines = [];
  const add = (label, v) => { if (Math.round(v)) lines.push([label, Math.round(v)]); };
  const delivered = result === 'intact' || result === 'damaged';
  if (delivered) add(result === 'intact' ? 'Prämie' : 'Prämie (beschädigt)', FEES[type] * feeMult * (result === 'intact' ? 1 : 0.4));
  if (delivered) { const d = Math.hypot(s.x, s.z); add('Präzision', d <= 3 ? 5000 : d <= 12 ? 2000 : 0); }
  if (s.status === 'landed') {
    add('Treibstoff zurück', S.fuel(s) * econ.fuelPrice);
    add('Bergung Lander', cost.parts * (s.touch.grade >= 2 ? RECOVER.hard : RECOVER.landed));
  }
  if (delivered) add('Basis-Einnahmen', econ.income);
  return { lines, total: lines.reduce((a, l) => a + l[1], 0) };
}

/** credits, shortened: 12.400 -> "12,4k" */
export const cr = (v) => `${v < 0 ? '−' : ''}${Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k` : Math.round(Math.abs(v)).toLocaleString('de-DE')} Cr`;
