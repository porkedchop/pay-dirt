// one world, every miner at the same fork, running scorecard = the continuous test
// headless. the page and the evaluator both drive it

import { World, Oracle, Parrot, regretOf, won, fnv1a, RegionHistory } from './sim.js';
import { Apprentice, weatherFeatures, runCanaries } from './apprentice.js';

// each region is cut under a real mine. its live weather shapes the cave and is fed to the apprentice as a red herring
export const SITES = [
  { name: 'Botallack', place: 'Cornwall', lat: 50.14, lon: -5.687, ore: 'tin and copper' },
  { name: 'Kiruna', place: 'Sweden', lat: 67.856, lon: 20.225, ore: 'iron' },
  { name: 'Cerro Rico', place: 'Potosí, Bolivia', lat: -19.62, lon: -65.75, ore: 'silver' },
  { name: 'Super Pit', place: 'Kalgoorlie, Australia', lat: -30.78, lon: 121.5, ore: 'gold' },
  { name: 'Berkeley Pit', place: 'Butte, Montana', lat: 46.017, lon: -112.513, ore: 'copper' },
  { name: 'Wieliczka', place: 'Poland', lat: 49.983, lon: 20.056, ore: 'rock salt' },
  { name: 'Chuquicamata', place: 'Chile', lat: -22.3, lon: -68.9, ore: 'copper' },
  { name: 'Falun', place: 'Sweden', lat: 60.6, lon: 15.61, ore: 'copper' },
];

// open-meteo snapshot 2026-10-21 00:15 utc. used when live fetch is blocked or offline
export const RECORDED_WEATHER = [
  { temperature_2m: 10.9, precipitation: 0.2, wind_speed_10m: 36.4, relative_humidity_2m: 88, surface_pressure: 987.3 },
  { temperature_2m: 0.5, precipitation: 0.0, wind_speed_10m: 9.4, relative_humidity_2m: 100, surface_pressure: 960.4 },
  { temperature_2m: 4.7, precipitation: 0.0, wind_speed_10m: 9.4, relative_humidity_2m: 15, surface_pressure: 583.8 },
  { temperature_2m: 24.0, precipitation: 0.0, wind_speed_10m: 20.1, relative_humidity_2m: 43, surface_pressure: 977.3 },
  { temperature_2m: 14.6, precipitation: 0.0, wind_speed_10m: 3.9, relative_humidity_2m: 29, surface_pressure: 841.7 },
  { temperature_2m: 7.3, precipitation: 0.0, wind_speed_10m: 2.5, relative_humidity_2m: 97, surface_pressure: 988.4 },
  { temperature_2m: 13.2, precipitation: 0.0, wind_speed_10m: 5.0, relative_humidity_2m: 31, surface_pressure: 741.6 },
  { temperature_2m: 4.4, precipitation: 0.0, wind_speed_10m: 8.6, relative_humidity_2m: 99, surface_pressure: 1010.3 },
].map((w) => ({ ...w, recorded: '2026-10-21T00:15Z' }));

const CANARY_EVERY = 10;

export class Expedition {
  constructor({ worldCfg = {}, apprenticeCfg = {}, weather = RECORDED_WEATHER, seedSource = null } = {}) {
    this.world = new World(worldCfg);
    this.weather = weather;
    // seedSource() -> { seed, source, detail } or null to chain from last seed
    this.seedSource = seedSource;
    this.oracle = new Oracle(this.world);
    this.apprentice = new Apprentice(apprenticeCfg);
    this.parrot = new Parrot();
    this.miners = { Oracle: this.oracle, Apprentice: this.apprentice, Parrot: this.parrot };
    this.stats = {};
    for (const name of [...Object.keys(this.miners), 'You']) {
      this.stats[name] = { ore: 0, forks: 0, regret: 0, series: [] };
    }
    this.ledger = []; // region seed + where it came from, replays the run
    this.closed = []; // finished regions, true knocker vs oracle's last guess
    this.canaries = runCanaries(this.apprentice, this.weather.map(weatherFeatures));
    this.canaryLog = [];
    this.calib = [];
    this.adaptation = [];
    this.recentAgree = []; // apprentice == oracle, only forks where the choice matters
  }

  beginRegion() {
    const prev = this.world.region;
    if (prev && this.oracle.belief) {
      const b = this.oracle.belief;
      this.closed.push({ region: prev.index, tribe: prev.tribe, guess: b.indexOf(Math.max(...b)), site: SITES[prev.site].name });
    }
    const fresh = this.seedSource ? this.seedSource() : null;
    const seed = fresh ? fresh.seed : this.world.chainedSeed();
    const R = this.world.beginRegion(seed, fresh ? fresh.source : 'chained');
    // separate hash so world draw order and python parity stay untouched
    R.site = fnv1a(`site:${seed}`) % SITES.length;
    R.wx = this.weather[R.site];
    R.history = new RegionHistory(R.strata);
    this.oracle.beginRegion(R);
    this.apprentice.beginRegion(R, weatherFeatures(R.wx));
    this.ledger.push({
      region: R.index, seed: R.seed, source: R.source, detail: fresh ? fresh.detail : null,
      site: SITES[R.site].name, startFork: R.startFork,
    });
    return R;
  }

  // split in two so the page can animate between and a human can play along
  open() {
    if (this.world.needsRegion()) this.beginRegion();
    const f = this.world.nextFork();
    const calls = {};
    for (const [name, m] of Object.entries(this.miners)) calls[name] = m.act(f);
    this.pending = { f, calls, region: this.world.region };
    return this.pending;
  }

  resolve(youAction = null) {
    const { f, calls, region } = this.pending;
    if (youAction) calls.You = { action: youAction };
    for (const [name, c] of Object.entries(calls)) {
      const s = this.stats[name];
      s.forks += 1;
      if (won(f, c.action)) s.ore += 1;
      s.regret += regretOf(f, c.action);
      s.series.push([f.index, s.regret]);
    }
    const a = calls.Apprentice;
    const p = a.action === 'switch' ? a.pSwitch : a.pStay;
    this.calib.push([p, won(f, a.action) ? 1 : 0]);
    if (this.calib.length > 1000) this.calib.shift();

    if (Math.abs(f.trueStay - f.trueSwitch) > 0.05) {
      this.recentAgree.push(a.action === calls.Oracle.action ? 1 : 0);
      if (this.recentAgree.length > 50) this.recentAgree.shift();
    }
    this.trackAdaptation(f, regretOf(f, a.action));

    for (const m of Object.values(this.miners)) m.learn(f);
    region.history.record(f);

    if ((f.index + 1) % CANARY_EVERY === 0) {
      this.canaries = runCanaries(this.apprentice, this.weather.map(weatherFeatures));
      this.canaryLog.push({ fork: f.index, alive: this.canaries.filter((c) => c.alive).length });
    }
    this.pending = null;
    return { f, calls };
  }

  step() { this.open(); return this.resolve(); }

  // drift test. forks after a migration until 100-fork regret is back to pre move level
  trackAdaptation(f, r) {
    this.regretWindow = this.regretWindow || [];
    this.regretWindow.push(r);
    if (this.regretWindow.length > 100) this.regretWindow.shift();
    const rate = this.regretWindow.reduce((x, y) => x + y, 0) / this.regretWindow.length;
    const lastMig = this.world.migrations.at(-1);
    if (lastMig === undefined) { this.baselineRate = rate; return; }
    let open = this.adaptation.find((d) => d.at === lastMig);
    if (!open) {
      open = { at: lastMig, before: this.baselineRate ?? rate, recoveredAfter: null };
      this.adaptation.push(open);
    }
    const since = f.index - lastMig;
    if (open.recoveredAfter === null && since >= 100 && rate <= open.before * 1.1 + 0.005) {
      open.recoveredAfter = since;
    }
    if (open.recoveredAfter !== null) this.baselineRate = rate;
  }

  migrateNow() { this.world.migrate(); }

  summary(lastN = 500) {
    const out = {};
    for (const [name, s] of Object.entries(this.stats)) {
      if (!s.forks) continue;
      const tail = s.series.slice(-lastN - 1);
      const span = tail.length > 1 ? tail.at(-1)[0] - tail[0][0] : 1;
      out[name] = {
        forks: s.forks, ore: s.ore, winRate: s.ore / s.forks,
        regret: s.regret, recentRegretPer100: tail.length > 1 ? (100 * (tail.at(-1)[1] - tail[0][1])) / span : null,
      };
    }
    const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, hits: 0 }));
    for (const [p, w] of this.calib) { const b = bins[Math.min(9, Math.floor(p * 10))]; b.n++; b.p += p; b.hits += w; }
    const ece = bins.reduce((acc, b) => acc + (b.n ? Math.abs(b.p - b.hits) : 0), 0) / Math.max(1, this.calib.length);
    return {
      miners: out,
      canariesAlive: this.canaries.filter((c) => c.alive).length,
      canaries: this.canaries.length,
      calibrationError: ece,
      calibration: bins.map((b) => (b.n ? { n: b.n, predicted: b.p / b.n, observed: b.hits / b.n } : { n: 0 })),
      weatherSway: this.apprentice.weatherSway(this.apprentice.recentInputs(48), this.weather.map(weatherFeatures)),
      agreement: this.recentAgree.length ? this.recentAgree.reduce((a, b) => a + b, 0) / this.recentAgree.length : null,
      migrations: this.world.migrations.slice(),
      adaptation: this.adaptation.map((d) => ({ ...d })),
    };
  }
}
