// the apprentice. small neural net, starts knowing nothing
// never told the rules or the tribe names. sees raw events, rock, weather, the knock
// predicts p(stay wins) and p(switch wins). hand written backprop + adam + replay, no library

import { mulberry32 } from './sim.js';

export const WINDOW = 16;
const EVENT_KINDS = 5; // knock+seam picked, knock+not, rang, silent+seam picked, silent+not
const N_WEATHER = 3;
const BASE = 6 + N_WEATHER;
export const N_INPUT = BASE + EVENT_KINDS + 1;

export function eventKind(f) {
  if (f.k === null) return f.seam === f.pick ? 3 : 4;
  if (f.ring) return 2;
  return f.seam === f.pick ? 0 : 1;
}

// history is pooled not ordered. equivalent to a shared linear slot encoder + sum (deep sets)
export function encode({ k, ring, strata, weather, history }) {
  const x = new Float64Array(N_INPUT);
  x[0] = k !== null ? 1 : 0;
  x[1] = ring ? 1 : 0;
  if (strata !== null && strata !== undefined) x[2 + strata] = 1;
  const w = weather || [0, 0, 0];
  for (let i = 0; i < N_WEATHER; i++) x[6 + i] = w[i];
  const seen = history.slice(-WINDOW);
  for (const e of seen) x[BASE + e] += 1 / WINDOW;
  x[BASE + EVENT_KINDS] = seen.length / WINDOW;
  return x;
}

// real weather, causally unrelated to any knocker. red herring on purpose
export function weatherFeatures(wx) {
  if (!wx) return [0, 0, 0];
  return [
    Math.tanh((wx.temperature_2m - 10) / 12),
    Math.tanh(wx.precipitation / 2) * 2 - 1,
    Math.tanh((wx.wind_speed_10m - 15) / 15),
  ];
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
    this.mW = new Float64Array(nIn * nOut); this.vW = new Float64Array(nIn * nOut);
    this.mb = new Float64Array(nOut); this.vb = new Float64Array(nOut);
    this.gW = new Float64Array(nIn * nOut); this.gb = new Float64Array(nOut);
  }
  forward(x) {
    const y = new Float64Array(this.nOut);
    for (let o = 0; o < this.nOut; o++) {
      let s = this.b[o];
      const row = o * this.nIn;
      for (let i = 0; i < this.nIn; i++) s += this.W[row + i] * x[i];
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
      const row = o * this.nIn;
      for (let i = 0; i < this.nIn; i++) {
        this.gW[row + i] += g * x[i];
        dx[i] += g * this.W[row + i];
      }
    }
    return dx;
  }
  step(lr, t, batch, l2) {
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const c1 = 1 - b1 ** t, c2 = 1 - b2 ** t;
    const upd = (P, G, M, V, decay) => {
      for (let i = 0; i < P.length; i++) {
        const g = G[i] / batch + (decay ? l2 * P[i] : 0);
        M[i] = b1 * M[i] + (1 - b1) * g;
        V[i] = b2 * V[i] + (1 - b2) * g * g;
        P[i] -= (lr * (M[i] / c1)) / (Math.sqrt(V[i] / c2) + eps);
        G[i] = 0;
      }
    };
    upd(this.W, this.gW, this.mW, this.vW, true);
    upd(this.b, this.gb, this.mb, this.vb, false);
  }
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

export class Apprentice {
  constructor({ seed = 7, hidden = [24, 12], lr = 0.003, batch = 32, stepsPerFork = 4, bufferSize = 4000, l2 = 1e-4 } = {}) {
    this.rng = mulberry32(seed);
    const sizes = [N_INPUT, ...hidden, 2];
    this.layers = sizes.slice(1).map((n, i) => new Dense(sizes[i], n, this.rng));
    Object.assign(this, { lr, batch, stepsPerFork, bufferSize, l2 });
    this.buffer = []; this.bufPos = 0; this.t = 0;
    this.history = []; this.strata = null; this.weather = [0, 0, 0];
    this.lossEma = null;
  }
  name() { return 'Apprentice'; }

  parameterCount() {
    return this.layers.reduce((a, L) => a + L.W.length + L.b.length, 0);
  }

  forward(x) {
    const acts = [x];
    let h = x;
    this.layers.forEach((L, i) => {
      const z = L.forward(h);
      h = i < this.layers.length - 1 ? z.map(Math.tanh) : z.map(sigmoid);
      acts.push(h);
    });
    return acts;
  }

  predict(x) {
    const out = this.forward(x).at(-1);
    return { pStay: out[0], pSwitch: out[1] };
  }

  beginRegion(R, weather) {
    this.history = [];
    this.strata = R.strata;
    this.weather = weather || [0, 0, 0];
  }

  features(f) {
    return encode({ k: f.k, ring: f.ring, strata: this.strata, weather: this.weather, history: this.history });
  }

  act(f) {
    this.lastX = this.features(f);
    const p = this.predict(this.lastX);
    return { action: p.pSwitch > p.pStay ? 'switch' : 'stay', pStay: p.pStay, pSwitch: p.pSwitch };
  }

  // seam gets dug out after, so both actions get a label
  learn(f) {
    const y = [f.stayWins ? 1 : 0, f.switchWins ? 1 : 0];
    const sample = { x: this.lastX ?? this.features(f), y };
    if (this.buffer.length < this.bufferSize) this.buffer.push(sample);
    else { this.buffer[this.bufPos] = sample; this.bufPos = (this.bufPos + 1) % this.bufferSize; }
    for (let s = 0; s < this.stepsPerFork; s++) this.trainStep(sample);
    this.history.push(eventKind(f));
    this.lastX = null;
  }

  // accumulates grads into the layers, returns summed bce
  grad(s) {
    const acts = this.forward(s.x);
    const out = acts.at(-1);
    let loss = 0;
    let d = Float64Array.from(out, (p, i) => p - s.y[i]); // bce + sigmoid
    out.forEach((p, i) => {
      const q = Math.min(Math.max(p, 1e-7), 1 - 1e-7);
      loss -= s.y[i] * Math.log(q) + (1 - s.y[i]) * Math.log(1 - q);
    });
    for (let li = this.layers.length - 1; li >= 0; li--) {
      const dx = this.layers[li].backward(acts[li], d);
      if (li > 0) d = dx.map((g, i) => g * (1 - acts[li][i] ** 2));
    }
    return loss;
  }

  // newest sample + random replays so drift shows fast but old lessons stick
  trainStep(newest) {
    const n = Math.min(this.batch, this.buffer.length);
    let loss = 0;
    for (let b = 0; b < n; b++) loss += this.grad(b === 0 ? newest : this.buffer[Math.floor(this.rng() * this.buffer.length)]);
    this.t += 1;
    for (const L of this.layers) L.step(this.lr, this.t, n, this.l2);
    const mean = loss / (2 * n);
    this.lossEma = this.lossEma === null ? mean : 0.98 * this.lossEma + 0.02 * mean;
  }

  // counterfactual test. same fork under every mine's weather, how far does p move
  // weather never matters so a good learner should drive this toward zero
  weatherSway(samples, options) {
    if (!samples.length || !options?.length) return 0;
    let total = 0;
    for (const x of samples) {
      const preds = options.map((w) => {
        const xi = Float64Array.from(x);
        for (let i = 0; i < N_WEATHER; i++) xi[6 + i] = w[i];
        return this.predict(xi);
      });
      const mean = (key) => preds.reduce((a, p) => a + p[key], 0) / preds.length;
      const ms = mean('pStay'), mw = mean('pSwitch');
      total += preds.reduce((a, p) => a + (Math.abs(p.pStay - ms) + Math.abs(p.pSwitch - mw)) / 2, 0) / preds.length;
    }
    return total / samples.length;
  }

  recentInputs(n = 64) {
    return this.buffer.slice(-n).map((s) => s.x);
  }
}

// canaries. fixed probe forks, tested on never trained on
// each history could only come from one knocker. asked under every rock and every mines weather, averaged
// so the cue cant carry it and the input stays in distribution
const K_HIT = 0, K_MISS = 1, RING = 2, S_HIT = 3, S_MISS = 4;
const pattern = (...kinds) => Array.from({ length: WINDOW }, (_, i) => kinds[i % kinds.length]);

export const CANARIES = [
  { id: 'guide-knock', tribe: 'The Guide', knocked: true, expect: 'switch', history: pattern(K_MISS, K_HIT, K_MISS) },
  { id: 'settling-knock', tribe: 'The Settling', knocked: true, expect: 'either', history: pattern(K_MISS, RING, K_HIT) },
  { id: 'trickster-knock', tribe: 'The Trickster', knocked: true, expect: 'stay', history: pattern(S_MISS, K_HIT, S_MISS) },
  { id: 'trickster-silent', tribe: 'The Trickster', knocked: false, expect: 'switch', history: pattern(S_MISS, K_HIT, S_MISS) },
  { id: 'warden-knock', tribe: 'The Warden', knocked: true, expect: 'switch', history: pattern(K_MISS, S_HIT, K_MISS) },
  { id: 'warden-silent', tribe: 'The Warden', knocked: false, expect: 'stay', history: pattern(K_MISS, S_HIT, K_MISS) },
];

export function runCanaries(model, weathers = [[0, 0, 0]]) {
  return CANARIES.map((c) => {
    const p = { pStay: 0, pSwitch: 0 };
    const n = 4 * weathers.length;
    for (let strata = 0; strata < 4; strata++) for (const weather of weathers) {
      const q = model.predict(encode({ k: c.knocked ? 1 : null, ring: false, strata, weather, history: c.history }));
      p.pStay += q.pStay / n; p.pSwitch += q.pSwitch / n;
    }
    const alive = c.expect === 'either'
      ? Math.abs(p.pStay - p.pSwitch) < 0.15
      : (c.expect === 'switch') === (p.pSwitch > p.pStay);
    return { ...c, pStay: p.pStay, pSwitch: p.pSwitch, alive };
  });
}
