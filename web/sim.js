// the world, the knockers, the exact bayes oracle
// no dom no three so browser and node --test run the same code. python/pay_dirt/sim.py is a port, tests/golden.json keeps them honest

// mulberry32. tiny and ports bit for bit to python. fixed draw order per fork so a seed replays
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// same blast, opposite meaning depending on who lit it. in code a blast is still k (the knocked tunnel)
export const TOMMY = 0; // monty hall
export const CREAKS = 1; // monty fall
export const JOKER = 2; // monty from hell

export const SPIRITS = [
  { id: TOMMY, name: 'Tommy', short: 'Tommy',
    rule: 'The friendly foreman. He knows where the gold is and always blows up an empty tunnel you didn’t pick.',
    lesson: 'Switch. He knows, so switching wins 2 out of 3 times.' },
  { id: CREAKS, name: 'Loose Fuse', short: 'Loose Fuse',
    rule: 'Old dynamite left behind that goes off at random. Sometimes it buries the gold.',
    lesson: 'Coin flip. A random blast tells you nothing.' },
  { id: JOKER, name: 'The Joker', short: 'Joker',
    rule: 'A prankster who only blows up a tunnel when you already picked the gold, hoping you’ll leave.',
    lesson: 'Blast means stay. No blast means switch.' },
];

export const DEFAULTS = { prior: [0.4, 0.3, 0.3], regionMin: 12, regionSpan: 20 };

export function othersOf(pick) {
  return [0, 1, 2].filter((t) => t !== pick);
}

// k = blown up tunnel or null for no blast. ring = the blast buried the gold (loose fuse only)
export function knock(spirit, ore, pick, u) {
  const o = othersOf(pick);
  const coin = o[u < 0.5 ? 0 : 1];
  const emptyOther = o[0] === ore ? o[1] : o[0];
  if (spirit === TOMMY) return { k: ore === pick ? coin : emptyOther, ring: false };
  if (spirit === CREAKS) return { k: coin, ring: coin === ore };
  return ore === pick ? { k: coin, ring: false } : { k: null, ring: false };
}

// after a knock one tunnel is left. after silence its a coin between the two
export function switchTarget(pick, k, switchU) {
  const o = othersOf(pick);
  if (k === null) return o[switchU < 0.5 ? 0 : 1];
  return o[0] === k ? o[1] : o[0];
}

// p(knock | spirit, ore, pick). exact
export function likelihood(spirit, ore, pick, k, ring) {
  if (k !== null && k === pick) return 0;
  const orePicked = ore === pick;
  if (spirit === TOMMY) {
    if (ring || k === null) return 0;
    return orePicked ? 0.5 : k !== ore ? 1 : 0;
  }
  if (spirit === CREAKS) {
    if (k === null) return 0;
    return ring === (k === ore) ? 0.5 : 0;
  }
  if (ring) return 0;
  if (orePicked) return k !== null ? 0.5 : 0;
  return k === null ? 1 : 0;
}

// belief over spirits + knock -> exact p(stay wins), p(switch wins), updated belief
export function decide(belief, pick, k, ring) {
  let stay = 0, sw = 0, z = 0;
  const post = belief.map(() => 0);
  for (let t = 0; t < belief.length; t++) {
    if (belief[t] === 0) continue;
    for (let s = 0; s < 3; s++) {
      const w = belief[t] * (1 / 3) * likelihood(t, s, pick, k, ring);
      if (w === 0) continue;
      z += w;
      post[t] += w;
      if (ring) continue;
      if (s === pick) stay += w;
      else if (k === null) sw += 0.5 * w;
      else sw += w;
    }
  }
  if (z === 0) return { pStay: 0, pSwitch: 0, post: belief.slice() };
  return { pStay: stay / z, pSwitch: sw / z, post: post.map((p) => p / z) };
}

export function revealUpdate(belief, ore, pick, k, ring) {
  const post = belief.map((b, t) => b * likelihood(t, ore, pick, k, ring));
  const z = post.reduce((a, b) => a + b, 0);
  return z === 0 ? belief.slice() : post.map((p) => p / z);
}

export const oneHot = (t) => SPIRITS.map((_, i) => (i === t ? 1 : 0));

function sampleIndex(probs, u) {
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (u < acc) return i;
  }
  return probs.length - 1;
}

// region = one stretch of mine with one spirit. seed comes from outside (the weather) so a run replays
export class World {
  constructor(cfg = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.forkCount = 0;
    this.regionIndex = -1;
    this.region = null;
  }

  beginRegion(seed, source = 'chained') {
    const rng = mulberry32(seed);
    const spirit = sampleIndex(this.cfg.prior, rng());
    const length = this.cfg.regionMin + Math.floor(rng() * this.cfg.regionSpan);
    this.regionIndex += 1;
    this.region = { index: this.regionIndex, seed: seed >>> 0, source, rng, spirit, length, forksDone: 0 };
    return this.region;
  }

  needsRegion() { return !this.region || this.region.forksDone >= this.region.length; }

  chainedSeed() {
    return fnv1a(`${this.region ? this.region.seed : 0x9e3779b9}:${this.regionIndex + 1}`);
  }

  // draw order fixed: ore pick knock coin switch coin
  nextFork() {
    if (this.needsRegion()) throw new Error('region over: call beginRegion first');
    const R = this.region;
    const ore = Math.floor(R.rng() * 3);
    const pick = Math.floor(R.rng() * 3);
    const u = R.rng();
    const switchU = R.rng();
    const { k, ring } = knock(R.spirit, ore, pick, u);
    const target = switchTarget(pick, k, switchU);
    const truth = decide(oneHot(R.spirit), pick, k, ring); // odds if you knew the spirit
    const f = {
      index: this.forkCount, region: R.index, inRegion: R.forksDone, spirit: R.spirit,
      ore, pick, k, ring, target,
      stayWins: !ring && ore === pick, switchWins: !ring && target === ore,
      trueStay: truth.pStay, trueSwitch: truth.pSwitch,
    };
    R.forksDone += 1;
    this.forkCount += 1;
    return f;
  }
}

// every miner faces the same fork, same pick, same knock. only the next move differs

// old timer. knows the three habits, never which spirit is here
export class Oracle {
  constructor(world) { this.world = world; this.belief = null; }
  beginRegion() { this.belief = this.world.cfg.prior.slice(); }
  act(f) {
    const d = decide(this.belief, f.pick, f.k, f.ring);
    return { action: d.pSwitch > d.pStay ? 'switch' : 'stay', pStay: d.pStay, pSwitch: d.pSwitch };
  }
  learn(f) { this.belief = revealUpdate(this.belief, f.ore, f.pick, f.k, f.ring); }
}

// bookworm. the memorised textbook answer, switch whenever a door opens
export class Parrot {
  beginRegion() {}
  act(f) { return { action: f.k !== null ? 'switch' : 'stay', pStay: null, pSwitch: null }; }
  learn() {}
}

export function regretOf(f, action) {
  return Math.max(f.trueStay, f.trueSwitch) - (action === 'switch' ? f.trueSwitch : f.trueStay);
}

export function won(f, action) {
  return action === 'switch' ? f.switchWins : f.stayWins;
}
