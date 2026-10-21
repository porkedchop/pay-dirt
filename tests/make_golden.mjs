// writes tests/golden.json. python must reproduce it bit for bit
import { writeFileSync } from 'node:fs';
import { World, Oracle, mulberry32, fnv1a } from '../web/sim.js';

const w = new World({ migrateEvery: 150 });
const o = new Oracle(w);
const forks = [];
for (let i = 0; i < 600; i++) {
  if (w.needsRegion()) { const R = w.beginRegion(w.chainedSeed()); o.beginRegion(R); }
  const f = w.nextFork();
  const d = o.act(f);
  forks.push({
    seed: w.region.seed, tribe: f.tribe, strata: f.strata, seam: f.seam, pick: f.pick, k: f.k, ring: f.ring,
    target: f.target, trueStay: f.trueStay, trueSwitch: f.trueSwitch, oracleStay: d.pStay, oracleSwitch: d.pSwitch,
  });
  o.learn(f);
}
const r = mulberry32(12345);
const draws = Array.from({ length: 8 }, () => r());
writeFileSync(new URL('./golden.json', import.meta.url), JSON.stringify({
  draws, fnv: [fnv1a('site:1'), fnv1a('2654435769:0')], migrations: w.migrations, forks,
}));
console.log(`golden: ${forks.length} forks, ${w.migrations.length} migrations`);
