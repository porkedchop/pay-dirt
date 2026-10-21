// writes tests/golden.json. python must reproduce it bit for bit. rerun when sim.js draw order changes
import { writeFileSync } from 'node:fs';
import { World, Oracle, mulberry32, fnv1a } from '../web/sim.js';

const w = new World(), o = new Oracle(w), forks = [];
for (let i = 0; i < 600; i++) {
  if (w.needsRegion()) o.beginRegion(w.beginRegion(w.chainedSeed()));
  const f = w.nextFork(), d = o.act(f);
  forks.push({ seed: w.region.seed, spirit: f.spirit, ore: f.ore, pick: f.pick, k: f.k, ring: f.ring, target: f.target,
    trueStay: f.trueStay, trueSwitch: f.trueSwitch, oldStay: d.pStay, oldSwitch: d.pSwitch });
  o.learn(f);
}
const r = mulberry32(12345);
writeFileSync(new URL('./golden.json', import.meta.url), JSON.stringify({ draws: Array.from({ length: 8 }, () => r()), fnv: fnv1a('2654435769:0'), forks }));
console.log(`golden: ${forks.length} forks`);
