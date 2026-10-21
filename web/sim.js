// the world, the knockers, the exact bayes oracle
// no dom no three so browser and node --test run the same code. python/whos_knocking/sim.py is a port, tests/golden.json keeps them honest

// mulberry32. tiny and ports bit for bit to python. fixed draw order per fork so a seed replays
export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.state = () => a >>> 0;
  return next;
}

// chains a region seed when no fresh beacon came in
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// the knockers. same knock, opposite meaning depending on who knocked
export const GUIDE = 0;     // monty hall
export const SETTLING = 1;  // monty fall
export const TRICKSTER = 2; // monty from hell
export const WARDEN = 3;    // angelic monty

export const TRIBES = [
  {
    id: GUIDE, name: 'The Guide', variant: 'Monty Hall',
    rule: 'Knows where the seam runs. Always knocks on an empty tunnel you did not pick.',
    lesson: 'Switch. The knock was chosen with knowledge, so it moves the odds to 2/3.',
  },
  {
    id: SETTLING, name: 'The Settling', variant: 'Monty Fall',
    rule: 'No spirit at all. Timbers and air pockets settle at random, sometimes on the seam itself.',
    lesson: 'A coin flip. A random knock that happens to sound hollow tells you nothing.',
  },
  {
    id: TRICKSTER, name: 'The Trickster', variant: 'Monty from Hell',
    rule: 'Knocks only when your pick is already the seam, hoping to lure you off it.',
    lesson: 'Stay when it knocks. Switch when it is silent.',
  },
  {
    id: WARDEN, name: 'The Warden', variant: 'Angelic Monty',
    rule: 'Knocks only when your pick is wrong, sealing the other empty tunnel.',
    lesson: 'Switch when it knocks, stay when it is silent, and you never miss.',
  },
];

// rock is a real but unstable cue. each knocker has a home rock until they migrate
export const STRATA = [
  { name: 'Granite', note: 'pink feldspar, coarse grain' },
  { name: 'Killas', note: 'blue-grey slate, the Cornish country rock' },
  { name: 'Elvan', note: 'pale quartz porphyry dyke' },
  { name: 'Greenstone', note: 'dark altered basalt' },
];

export const DEFAULTS = {
  tribePrior: [0.3, 0.3, 0.2, 0.2],
  cueReliability: 0.8, // p(rock is home rock) else uniform
  regionMin: 12,
  regionSpan: 24,
  migrateEvery: 600,   // drift test, 0 = never
};

// tunnels 0 1 2. k = knocked tunnel or null for silence. ring = knock buried the seam (settling only)
export function othersOf(pick) {
  return [0, 1, 2].filter((t) => t !== pick);
}

export function knock(tribe, seam, pick, u) {
  const o = othersOf(pick);
  const coin = o[u < 0.5 ? 0 : 1];
  const emptyOther = o[0] === seam ? o[1] : o[0]; // only valid when seam != pick
  switch (tribe) {
    case GUIDE:
      return { k: seam === pick ? coin : emptyOther, ring: false };
    case SETTLING:
      return { k: coin, ring: coin === seam };
    case TRICKSTER:
      return seam === pick ? { k: coin, ring: false } : { k: null, ring: false };
    case WARDEN:
      return seam === pick ? { k: null, ring: false } : { k: emptyOther, ring: false };
    default:
      throw new Error(`unknown tribe ${tribe}`);
  }
}

// after a knock one tunnel is left. after silence its a coin between the two
export function switchTarget(pick, k, switchU) {
  const o = othersOf(pick);
  if (k === null) return o[switchU < 0.5 ? 0 : 1];
  return o[0] === k ? o[1] : o[0];
}

// p(knock | tribe, seam, pick). exact
export function likelihood(tribe, seam, pick, k, ring) {
  const seamPicked = seam === pick;
  if (k !== null && k === pick) return 0;
  switch (tribe) {
    case GUIDE:
      if (ring || k === null) return 0;
      return seamPicked ? 0.5 : k !== seam ? 1 : 0;
    case SETTLING:
      if (k === null) return 0;
      return ring === (k === seam) ? 0.5 : 0;
    case TRICKSTER:
      if (ring) return 0;
      if (seamPicked) return k !== null ? 0.5 : 0;
      return k === null ? 1 : 0;
    case WARDEN:
      if (ring) return 0;
      if (seamPicked) return k === null ? 1 : 0;
      return k !== null && k !== seam ? 1 : 0;
    default:
      return 0;
  }
}

// belief over tribes + knock -> exact p(stay wins), p(switch wins), updated belief
export function decide(belief, pick, k, ring) {
  let stay = 0, sw = 0, z = 0;
  const post = [0, 0, 0, 0];
  for (let t = 0; t < 4; t++) {
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
  if (z === 0) return { pStay: 0, pSwitch: 0, post: belief.slice(), impossible: true };
  return { pStay: stay / z, pSwitch: sw / z, post: post.map((p) => p / z), impossible: false };
}

export function revealUpdate(belief, seam, pick, k, ring) {
  const post = belief.map((b, t) => b * likelihood(t, seam, pick, k, ring));
  const z = post.reduce((a, b) => a + b, 0);
  return z === 0 ? belief.slice() : post.map((p) => p / z);
}

export function oneHot(t) {
  const v = [0, 0, 0, 0];
  v[t] = 1;
  return v;
}

export function strataPrior(strata, cueMap, cfg = DEFAULTS) {
  const r = cfg.cueReliability;
  const p = cfg.tribePrior.map((pt, t) => pt * ((cueMap[t] === strata ? r : 0) + (1 - r) / 4));
  const z = p.reduce((a, b) => a + b, 0);
  return p.map((x) => x / z);
}

function sampleIndex(probs, u) {
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (u < acc) return i;
  }
  return probs.length - 1;
}

// region = one rock one knocker. seed comes from outside (drand, weather, chain) so any run replays from its ledger
export class World {
  constructor(cfg = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.cueMap = [0, 1, 2, 3];
    this.forkCount = 0;
    this.regionIndex = -1;
    this.region = null;
    this.migrations = [];
  }

  // home rocks shift one over. cue stays strong but points at the wrong knocker
  migrate() {
    this.cueMap = this.cueMap.map((s) => (s + 1) % 4);
    this.migrations.push(this.forkCount);
  }

  beginRegion(seed, source = 'chained') {
    const rng = mulberry32(seed);
    const tribe = sampleIndex(this.cfg.tribePrior, rng());
    const length = this.cfg.regionMin + Math.floor(rng() * this.cfg.regionSpan);
    const strata = rng() < this.cfg.cueReliability ? this.cueMap[tribe] : Math.floor(rng() * 4);
    this.regionIndex += 1;
    this.region = {
      index: this.regionIndex, seed: seed >>> 0, source, rng, tribe, length, strata,
      forksDone: 0, startFork: this.forkCount,
    };
    return this.region;
  }

  needsRegion() {
    return !this.region || this.region.forksDone >= this.region.length;
  }

  chainedSeed() {
    const prev = this.region ? this.region.seed : 0x9e3779b9;
    return fnv1a(`${prev}:${this.regionIndex + 1}`);
  }

  // draw order fixed: seam pick knock coin switch coin
  nextFork() {
    if (this.cfg.migrateEvery > 0 && this.forkCount > 0 && this.forkCount % this.cfg.migrateEvery === 0
        && this.migrations[this.migrations.length - 1] !== this.forkCount) {
      this.migrate();
    }
    if (this.needsRegion()) throw new Error('region exhausted: call beginRegion first');
    const R = this.region;
    const seam = Math.floor(R.rng() * 3);
    const pick = Math.floor(R.rng() * 3);
    const u = R.rng();
    const switchU = R.rng();
    const { k, ring } = knock(R.tribe, seam, pick, u);
    const target = switchTarget(pick, k, switchU);
    const fork = {
      index: this.forkCount, region: R.index, inRegion: R.forksDone, tribe: R.tribe, strata: R.strata,
      seam, pick, k, ring, target,
      stayWins: !ring && seam === pick,
      switchWins: !ring && target === seam,
    };
    // odds if you knew the knocker. regret is measured against this
    const truth = decide(oneHot(R.tribe), pick, k, ring);
    fork.trueStay = truth.pStay;
    fork.trueSwitch = truth.pSwitch;
    R.forksDone += 1;
    this.forkCount += 1;
    return fork;
  }
}

// every miner faces the same fork, same pick, same knock. only the next move differs
export class RegionHistory {
  constructor(strata) {
    this.strata = strata;
    this.n = 0; this.knocks = 0; this.rings = 0;
    this.knockStay = 0;
    this.silents = 0; this.silentStay = 0;
  }
  record(f) {
    this.n += 1;
    if (f.k === null) {
      this.silents += 1;
      if (f.seam === f.pick) this.silentStay += 1;
    } else {
      this.knocks += 1;
      if (f.ring) this.rings += 1;
      else if (f.seam === f.pick) this.knockStay += 1;
    }
  }
}

// ceiling. knows the four rules and the rock map, never which knocker it is
export class Oracle {
  constructor(world) { this.world = world; this.belief = null; }
  name() { return 'Oracle'; }
  beginRegion(R) { this.belief = strataPrior(R.strata, this.world.cueMap, this.world.cfg); }
  act(f) {
    const d = decide(this.belief, f.pick, f.k, f.ring);
    this.last = d;
    return { action: d.pSwitch > d.pStay ? 'switch' : 'stay', pStay: d.pStay, pSwitch: d.pSwitch, belief: d.post };
  }
  learn(f) { this.belief = revealUpdate(this.belief, f.seam, f.pick, f.k, f.ring); }
}

// the memorised textbook answer. switch whenever a door opens
export class Parrot {
  name() { return 'Parrot'; }
  beginRegion() {}
  act(f) { return { action: f.k !== null ? 'switch' : 'stay', pStay: null, pSwitch: null }; }
  learn() {}
}

export function regretOf(f, action) {
  const best = Math.max(f.trueStay, f.trueSwitch);
  return best - (action === 'switch' ? f.trueSwitch : f.trueStay);
}

export function won(f, action) {
  return action === 'switch' ? f.switchWins : f.stayWins;
}
