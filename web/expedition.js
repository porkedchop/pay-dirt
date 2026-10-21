// one world, every miner at the same fork, running scorecard = the continuous test
// headless. the page, node tools and tests all drive it

import { World, Oracle, Parrot, regretOf, won, fnv1a } from './sim.js';
import { Apprentice, runQuizzes } from './apprentice.js';

// real mining towns. each part of the mine is shuffled with one town's weather right now
export const TOWNS = [
  { city: 'St Just', country: 'England', lat: 50.14, lon: -5.687 },
  { city: 'Kiruna', country: 'Sweden', lat: 67.856, lon: 20.225 },
  { city: 'Potosí', country: 'Bolivia', lat: -19.62, lon: -65.75 },
  { city: 'Kalgoorlie', country: 'Australia', lat: -30.78, lon: 121.5 },
  { city: 'Butte', country: 'USA', lat: 46.017, lon: -112.513 },
  { city: 'Wieliczka', country: 'Poland', lat: 49.983, lon: 20.056 },
  { city: 'Calama', country: 'Chile', lat: -22.3, lon: -68.9 },
  { city: 'Falun', country: 'Sweden', lat: 60.6, lon: 15.61 },
];

// open-meteo readings from 2026-10-21 00:15 utc. only used when the live call cant get through
export const SAVED_WEATHER = [
  [10.9, 0.2, 36.4, 88], [0.5, 0, 9.4, 100], [4.7, 0, 9.4, 15], [24, 0, 20.1, 43],
  [14.6, 0, 3.9, 29], [7.3, 0, 2.5, 97], [13.2, 0, 5, 31], [4.4, 0, 8.6, 99],
].map(([t, p, w, h]) => ({ time: '2026-10-21T00:15', temperature_2m: t, precipitation: p, wind_speed_10m: w, relative_humidity_2m: h, saved: true }));

export const townFor = (seed) => fnv1a(`town:${seed}`) % TOWNS.length;

const QUIZ_EVERY = 10;

export class Expedition {
  constructor({ worldCfg = {}, apprenticeCfg = {}, seedSource = null } = {}) {
    this.world = new World(worldCfg);
    this.seedSource = seedSource; // () -> { seed, source } or null to chain from the last seed
    this.miners = { Oracle: new Oracle(this.world), Apprentice: new Apprentice(apprenticeCfg), Parrot: new Parrot() };
    this.oracle = this.miners.Oracle;
    this.apprentice = this.miners.Apprentice;
    this.stats = {};
    for (const name of Object.keys(this.miners)) this.stats[name] = { ore: 0, forks: 0, missed: 0, series: [] };
    this.ledger = []; // region seeds, replays the run
    this.quizzes = runQuizzes(this.apprentice);
  }

  beginRegion() {
    const fresh = this.seedSource ? this.seedSource() : null;
    const R = this.world.beginRegion(fresh ? fresh.seed : this.world.chainedSeed(), fresh ? fresh.source : 'chained');
    for (const m of Object.values(this.miners)) m.beginRegion(R);
    R.town = fresh?.town ?? townFor(R.seed);
    this.ledger.push({ region: R.index, seed: R.seed, source: R.source, town: R.town });
    return R;
  }

  // split in two so the page can animate in between
  open() {
    if (this.world.needsRegion()) this.beginRegion();
    const f = this.world.nextFork();
    const calls = {};
    for (const [name, m] of Object.entries(this.miners)) calls[name] = m.act(f);
    this.pending = { f, calls, region: this.world.region };
    return this.pending;
  }

  resolve() {
    const { f, calls } = this.pending;
    for (const [name, c] of Object.entries(calls)) {
      const s = this.stats[name];
      s.forks += 1;
      if (won(f, c.action)) s.ore += 1;
      s.missed += regretOf(f, c.action);
      s.series.push([f.index, s.missed]);
    }
    for (const m of Object.values(this.miners)) m.learn(f);
    if ((f.index + 1) % QUIZ_EVERY === 0) this.quizzes = runQuizzes(this.apprentice);
    this.pending = null;
    return { f, calls };
  }

  step() { this.open(); return this.resolve(); }

  // ore missed per 100 forks over the last n, per miner
  recent(name, n = 500) {
    const s = this.stats[name].series;
    if (s.length < 2) return null;
    const a = s[Math.max(0, s.length - 1 - n)], b = s.at(-1);
    return (100 * (b[1] - a[1])) / Math.max(1, b[0] - a[0]);
  }
}
