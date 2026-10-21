// the model's own ci. backprop is right, and it actually learns
import test from 'node:test';
import assert from 'node:assert/strict';
import { Apprentice, N_INPUT } from '../web/apprentice.js';
import { Expedition } from '../web/expedition.js';

test('hand written backprop matches finite differences', () => {
  const m = new Apprentice({ seed: 3 });
  const x = Float64Array.from({ length: N_INPUT }, (_, i) => ((i * 37) % 11) / 11 - 0.4);
  const s = { x, y: [1, 0] };
  m.grad(s);
  const loss = () => {
    const out = m.forward(x).at(-1);
    return -(Math.log(out[0]) + Math.log(1 - out[1]));
  };
  let worst = 0;
  for (const L of m.layers) {
    for (const i of [0, 5, 17, L.W.length - 1]) {
      const keep = L.W[i];
      L.W[i] = keep + 1e-5; const up = loss();
      L.W[i] = keep - 1e-5; const down = loss();
      L.W[i] = keep;
      const numeric = (up - down) / 2e-5;
      worst = Math.max(worst, Math.abs(numeric - L.gW[i]) / Math.max(1e-6, Math.abs(numeric) + Math.abs(L.gW[i])));
    }
  }
  assert.ok(worst < 1e-5, `relative gradient error ${worst}`);
});

test('the apprentice learns who is knocking and survives a migration', () => {
  const ex = new Expedition({ worldCfg: { migrateEvery: 2500 } });
  for (let i = 0; i < 6000; i++) ex.step();
  const s = ex.summary(2000);
  const a = s.miners.Apprentice.recentRegretPer100, p = s.miners.Parrot.recentRegretPer100;
  assert.ok(a < 3.5, `apprentice late regret ${a.toFixed(2)} per 100`);
  assert.ok(a < 0.35 * p, `apprentice ${a.toFixed(2)} vs parrot ${p.toFixed(2)}`);
  assert.ok(s.calibrationError < 0.08, `calibration error ${s.calibrationError}`);
  assert.ok(s.canariesAlive >= 4, `${s.canariesAlive} canaries alive`);
  assert.ok(s.adaptation.every((d) => d.recoveredAfter !== null), JSON.stringify(s.adaptation));
});
