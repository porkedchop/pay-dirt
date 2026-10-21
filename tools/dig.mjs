// headless run with a monitor line every n forks. writes every decision to jsonl
//   node tools/dig.mjs --forks 20000 --every 1000 --out runs/today.jsonl
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Expedition } from '../web/expedition.js';
import { rowFor } from '../web/log.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const forks = +arg('forks', 10000), every = +arg('every', 1000), out = arg('out', null);
const ex = new Expedition(), run = `cli-${Date.now().toString(36)}`;
let file = null;
if (out) { mkdirSync(dirname(out), { recursive: true }); file = createWriteStream(out); }

const pad = (s, n) => String(s).padStart(n);
console.log(`${pad('fork', 7)} ${pad('rookie', 7)} ${pad('bookworm', 9)} ${pad('old timer', 10)} ${pad('quiz', 5)}   (ore missed per 100, last ${every})`);
for (let i = 1; i <= forks; i++) {
  const res = ex.step();
  file?.write(JSON.stringify(rowFor(ex, res, run)) + '\n');
  if (i % every === 0) {
    const m = (n) => ex.recent(n, every).toFixed(2);
    console.log(`${pad(i, 7)} ${pad(m('Apprentice'), 7)} ${pad(m('Parrot'), 9)} ${pad(m('Oracle'), 10)} ${pad(`${ex.quizzes.filter((q) => q.pass).length}/3`, 5)}`);
  }
}
file?.end();
if (out) console.log(`log: ${out}`);
