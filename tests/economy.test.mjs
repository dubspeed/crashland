// Base career money: prices, costs, payouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';
import * as E from '../src/economy.js';
import { makePilot } from './pilots.mjs';
import { recordPilot } from './replay-lib.mjs';

test('every builder option has a price, the cargo core replaces the capsule', () => {
  for (const sl of S.BUILD_SLOTS) for (const o of sl.options) assert.ok(E.PRICES[sl.id][o.id] !== undefined, `${sl.id}.${o.id}`);
  assert.equal(E.partsPrice({ payload: 'beacon' }) - E.partsPrice({}), E.CARGO_CORE - E.PRICES.capsule.std);
  assert.ok(E.partsPrice({ engine: 'cluster' }) > E.partsPrice({}) && E.partsPrice({ engine: 'mini' }) < E.partsPrice({}));
});

test('a good standard flight pays off, a crash costs the whole lander, the cheapest lander fits the start money', () => {
  const P = S.ORBIT_PLANETS[2], econ = E.baseEconomy([]);
  const b = { payload: 'beacon' }, cost = E.flightCost(b, P, 1, econ.fuelPrice);
  assert.ok(cost.total < E.START_MONEY);
  assert.ok(E.cheapestCost('beacon', P, 1, econ.fuelPrice) < cost.total);
  const { s } = recordPilot(P, 0, 5, makePilot(S, P, {}), 900, {}, b);
  const pay = E.payout(s, 'beacon', 'intact', cost, econ);
  const net = pay.total - cost.total;
  assert.ok(net > 2000 && net < 15000, `net ${net}`);
  assert.equal(E.payout(s, 'beacon', 'lost', cost, econ).lines.filter((l) => /Prämie/.test(l[0])).length, 0);
  // modules: cheaper fuel, income
  const e2 = E.baseEconomy([{ type: 'depot' }, { type: 'refinery' }, { type: 'lab' }, { type: 'rover', damaged: true }]);
  assert.ok(Math.abs(e2.fuelPrice - E.FUEL_PRICE * 0.85 * 0.7) < 1e-9 && e2.income === 3000);
});
