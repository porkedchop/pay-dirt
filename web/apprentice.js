// the rookie. small neural net, starts knowing nothing, never told the rules or the spirit names
// sees the knock in front of it + what happened at recent forks. predicts p(stay wins) and p(switch wins)
// hand written backprop + adam + replay buffer, no library

import { mulberry32 } from './sim.js';

export const WINDOW = 16;
export const KIND = { KNOCK_HIT: 0, KNOCK_MISS: 1, BURIED: 2, SILENT: 3 }; // hit = the first pick had the ore
const N_KINDS = 4;
export const N_INPUT = 2 + N_KINDS + 1;

export function eventKind(f) {
  if (f.k === null) return KIND.SILENT;
  if (f.ring) return KIND.BURIED;
  return f.ore === f.pick ? KIND.KNOCK_HIT : KIND.KNOCK_MISS;
}

// history pooled not ordered. same as a shared slot encoder + sum (deep sets)
export function encode(knocked, buried, history) {
  const x = new Float64Array(N_INPUT);
  x[0] = knocked ? 1 : 0;
  x[1] = buried ? 1 : 0;
  const seen = history.slice(-WINDOW);
  for (const e of seen) x[2 + e] += 1 / WINDOW;
  x[2 + N_KINDS] = seen.length / WINDOW;
  return x;
}

function randn(rng) {
  const u = Math.max(rng(), 1e-12), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

class Dense {
  constructor(nIn, nOut, rng) {
    this.nIn = nIn; this.nOut = nOut;
    const scale = Math.sqrt(1 / nIn);
    this.W = Float64Array.from({ length: nIn * nOut }, () => randn(rng) * scale);
    this.b = new Float64Array(nOut);
    for (const k of ['mW', 'vW', 'gW']) this[k] = new Float64Array(nIn * nOut);
    for (const k of ['mb', 'vb', 'gb']) this[k] = new Float64Array(nOut);
  }
  forward(x) {
    const y = new Float64Array(this.nOut);
    for (let o = 0; o < this.nOut; o++) {
      let s = this.b[o];
      for (let i = 0, row = o * this.nIn; i < this.nIn; i++) s += this.W[row + i] * x[i];
      y[o] = s;
    }
    return y;
  }
  backward(x, dy) {
    const dx = new Float64Array(this.nIn);
    for (let o = 0; o < this.nOut; o++) {
      const g = dy[o];
      if (g === 0) continue;
      this.gb[o] += g;
      for (let i = 0, row = o * this.nIn; i < this.nIn; i++) {
        this.gW[row + i] += g * x[i];
        dx[i] += g * this.W[row + i];
      }
    }
    return dx;
  }
  step(lr, t, batch) {
    const b1 = 0.9, b2 = 0.999, c1 = 1 - b1 ** t, c2 = 1 - b2 ** t;
    const upd = (P, G, M, V) => {
      for (let i = 0; i < P.length; i++) {
        const g = G[i] / batch;
        M[i] = b1 * M[i] + (1 - b1) * g;
        V[i] = b2 * V[i] + (1 - b2) * g * g;
        P[i] -= (lr * (M[i] / c1)) / (Math.sqrt(V[i] / c2) + 1e-8);
        G[i] = 0;
      }
    };
    upd(this.W, this.gW, this.mW, this.vW);
    upd(this.b, this.gb, this.mb, this.vb);
  }
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

export class Apprentice {
  constructor({ seed = 7, hidden = 16, lr = 0.004, batch = 32, stepsPerFork = 3, bufferSize = 3000 } = {}) {
    this.rng = mulberry32(seed);
    this.layers = [new Dense(N_INPUT, hidden, this.rng), new Dense(hidden, 2, this.rng)];
    Object.assign(this, { lr, batch, stepsPerFork, bufferSize });
    this.buffer = []; this.bufPos = 0; this.t = 0; this.history = [];
  }

  parameterCount() { return this.layers.reduce((a, L) => a + L.W.length + L.b.length, 0); }

  forward(x) {
    const h = this.layers[0].forward(x).map(Math.tanh);
    return [x, h, this.layers[1].forward(h).map(sigmoid)];
  }

  predict(x) {
    const out = this.forward(x)[2];
    return { pStay: out[0], pSwitch: out[1] };
  }

  beginRegion() { this.history = []; }

  act(f) {
    this.lastX = encode(f.k !== null, f.ring, this.history);
    const p = this.predict(this.lastX);
    return { action: p.pSwitch > p.pStay ? 'switch' : 'stay', pStay: p.pStay, pSwitch: p.pSwitch };
  }

  // the ore gets dug out after, so both moves get a label
  learn(f) {
    const sample = { x: this.lastX, y: [f.stayWins ? 1 : 0, f.switchWins ? 1 : 0] };
    if (this.buffer.length < this.bufferSize) this.buffer.push(sample);
    else { this.buffer[this.bufPos] = sample; this.bufPos = (this.bufPos + 1) % this.bufferSize; }
    for (let s = 0; s < this.stepsPerFork; s++) this.trainStep(sample);
    this.history.push(eventKind(f));
  }

  // accumulates grads into the layers. bce + sigmoid so dL/dz = p - y
  grad({ x, y }) {
    const [, h, out] = this.forward(x);
    const dOut = Float64Array.from(out, (p, i) => p - y[i]);
    const dh = this.layers[1].backward(h, dOut);
    this.layers[0].backward(x, dh.map((g, i) => g * (1 - h[i] ** 2)));
  }

  // newest sample + random replays
  trainStep(newest) {
    const n = Math.min(this.batch, this.buffer.length);
    for (let b = 0; b < n; b++) this.grad(b === 0 ? newest : this.buffer[Math.floor(this.rng() * this.buffer.length)]);
    this.t += 1;
    for (const L of this.layers) L.step(this.lr, this.t, n);
  }
}

// pop quizzes. fixed histories only one spirit could make, tested on never trained on
const fill = (...kinds) => Array.from({ length: WINDOW }, (_, i) => kinds[i % kinds.length]);
export const QUIZZES = [
  { spirit: 'Tommy', knocked: true, expect: 'switch', history: fill(KIND.KNOCK_MISS, KIND.KNOCK_HIT, KIND.KNOCK_MISS) },
  { spirit: 'Loose Fuse', knocked: true, expect: 'either', history: fill(KIND.KNOCK_MISS, KIND.BURIED, KIND.KNOCK_HIT) },
  { spirit: 'The Joker', knocked: true, expect: 'stay', history: fill(KIND.SILENT, KIND.KNOCK_HIT, KIND.SILENT) },
];

export function runQuizzes(model) {
  return QUIZZES.map((q) => {
    const p = model.predict(encode(q.knocked, false, q.history));
    const pass = q.expect === 'either' ? Math.abs(p.pStay - p.pSwitch) < 0.2 : (q.expect === 'switch') === (p.pSwitch > p.pStay);
    return { ...q, ...p, pass };
  });
}
