// the rookie's own ci. backprop is right, and it actually learns
import test from 'node:test';
import assert from 'node:assert/strict';
import { Apprentice, N_INPUT } from '../web/apprentice.js';
import { Expedition } from '../web/expedition.js';

test('hand written backprop matches finite differences', () => {
  const m = new Apprentice({ seed: 3 });
  const x = Float64Array.from({ length: N_INPUT }, (_, i) => ((i * 37) % 11) / 11);
  m.grad({ x, y: [1, 0] });
  const loss = () => { const out = m.forward(x)[2]; return -(Math.log(out[0]) + Math.log(1 - out[1])); };
  let worst = 0;
  for (const L of m.layers) for (const i of [0, 3, 9, L.W.length - 1]) {
    const keep = L.W[i];
    L.W[i] = keep + 1e-5; const up = loss();
    L.W[i] = keep - 1e-5; const down = loss();
    L.W[i] = keep;
    const num = (up - down) / 2e-5;
    worst = Math.max(worst, Math.abs(num - L.gW[i]) / Math.max(1e-6, Math.abs(num) + Math.abs(L.gW[i])));
  }
  assert.ok(worst < 1e-5, `relative gradient error ${worst}`);
});

test('the rookie learns who is knocking', () => {
  const ex = new Expedition();
  for (let i = 0; i < 5000; i++) ex.step();
  const rookie = ex.recent('Apprentice', 2000), bookworm = ex.recent('Parrot', 2000);
  assert.ok(rookie < 2.5, `rookie missed ${rookie.toFixed(2)} per 100`);
  assert.ok(rookie < 0.2 * bookworm, `rookie ${rookie.toFixed(2)} vs bookworm ${bookworm.toFixed(2)}`);
  assert.ok(ex.quizzes.filter((q) => q.pass).length >= 2, JSON.stringify(ex.quizzes.map((q) => [q.spirit, q.pStay, q.pSwitch])));
});
