// the builder's "Δv needed" for base missions: the standard lander has it with every cargo (as the pilot shows,
// tests/rescue and landings), a lander that is clearly too small does not
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';

const dv = (P, b) => {
  const st = S.createState(P, { build: b, rnd: () => 0.5, windHeading: 0 }), m0 = S.massProps(st).m;
  return { dv: st.spec.isp * S.G0 * Math.log(m0 / (m0 - st.fuel0)), dry: m0 - st.fuel0 };
};
test('Δv needed: the standard lander has it for every cargo, a mini tank lander with a heavy cargo not', () => {
  for (const P of S.ORBIT_PLANETS) {
    for (const type of S.MISSIONS) {
      const c = S.CARGO[type], b = c.crew ? { ...S.DEFAULT_BUILD, capsule: 'hab' } : { ...S.DEFAULT_BUILD, payload: type };
      const r = dv(P, b);
      assert.ok(r.dv >= S.dvNeed(P, r.dry), `${P.id} ${type}: ${r.dv.toFixed(0)} < ${S.dvNeed(P, r.dry)}`);
    }
    const r = dv(P, { ...S.DEFAULT_BUILD, payload: 'refinery', tanks: 'mini' });
    assert.ok(r.dv < S.dvNeed(P, r.dry), `${P.id}: mini tanks with the refinery should fall short`);
  }
  assert.equal(S.dvNeed(S.PLANETS[0], 3000), null); // no figure for the approach levels
});
