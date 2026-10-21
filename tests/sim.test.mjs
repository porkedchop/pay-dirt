// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDE, SETTLING, TRICKSTER, WARDEN, knock, switchTarget, decide, oneHot, likelihood,
  mulberry32, World, Oracle, Parrot, regretOf, won,
} from '../web/sim.js';

// enumerate every seam pick coin. exact, no monte carlo
function exactRates(tribe) {
  let stay = 0, sw = 0, parrot = 0, best = 0;
  for (let seam = 0; seam < 3; seam++) for (let pick = 0; pick < 3; pick++) for (const u of [0.25, 0.75]) for (const su of [0.25, 0.75]) {
    const w = 1 / 36;
    const { k, ring } = knock(tribe, seam, pick, u);
    const target = switchTarget(pick, k, su);
    const stayWin = !ring && seam === pick;
    const swWin = !ring && target === seam;
    stay += w * stayWin; sw += w * swWin;
    parrot += w * (k !== null ? swWin : stayWin);
    const d = decide(oneHot(tribe), pick, k, ring);
    best += w * (d.pSwitch > d.pStay ? swWin : stayWin);
  }
  return { stay, sw, parrot, best };
}

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg}: ${a} vs ${b}`);

test('The Guide is classic Monty Hall: switching wins 2/3', () => {
  const r = exactRates(GUIDE);
  close(r.stay, 1 / 3, 'stay'); close(r.sw, 2 / 3, 'switch'); close(r.best, 2 / 3, 'best');
});

test('The Settling is Monty Fall: a hollow knock leaves a coin flip', () => {
  const r = exactRates(SETTLING);
  close(r.stay, 1 / 3, 'stay'); close(r.sw, 1 / 3, 'switch'); // 1/3 of knocks bury the seam
  const d = decide(oneHot(SETTLING), 0, 1, false);
  close(d.pStay, 0.5, 'hollow stay'); close(d.pSwitch, 0.5, 'hollow switch');
});

test('The Trickster punishes the textbook answer', () => {
  const r = exactRates(TRICKSTER);
  close(r.parrot, 0, 'parrot never wins against the trickster');
  close(r.best, 2 / 3, 'stay on knock, switch on silence');
  const knocked = decide(oneHot(TRICKSTER), 0, 1, false);
  close(knocked.pStay, 1, 'a trickster knock means you were right');
});

test('The Warden rewards anyone who knows it is the Warden', () => {
  const r = exactRates(WARDEN);
  close(r.best, 1, 'never miss'); close(r.parrot, 1, 'switch-on-knock happens to be perfect here');
});

test('likelihoods are proper distributions over what a knocker can do', () => {
  for (const t of [GUIDE, SETTLING, TRICKSTER, WARDEN]) for (let seam = 0; seam < 3; seam++) for (let pick = 0; pick < 3; pick++) {
    let total = 0;
    for (const k of [null, 0, 1, 2]) for (const ring of [false, true]) total += likelihood(t, seam, pick, k, ring);
    close(total, 1, `tribe ${t} seam ${seam} pick ${pick}`);
  }
});

test('mulberry32 is deterministic and matches the golden first draws', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
  const r = mulberry32(1);
  assert.equal(Math.round(r() * 1e9), 627073941); // also asserted in python/tests
});

test('the Oracle never does worse than the Parrot on average', () => {
  const w = new World({ migrateEvery: 0 });
  const o = new Oracle(w), p = new Parrot();
  let ro = 0, rp = 0;
  for (let i = 0; i < 20000; i++) {
    if (w.needsRegion()) { const R = w.beginRegion(w.chainedSeed()); o.beginRegion(R); }
    const f = w.nextFork();
    ro += regretOf(f, o.act(f).action); rp += regretOf(f, p.act(f).action);
    o.learn(f);
  }
  assert.ok(ro < rp * 0.25, `oracle regret ${ro} vs parrot ${rp}`);
});

test('a fork replays exactly from its region seed', () => {
  const run = () => {
    const w = new World();
    const out = [];
    for (let i = 0; i < 300; i++) {
      if (w.needsRegion()) w.beginRegion(w.chainedSeed());
      const f = w.nextFork();
      out.push([f.tribe, f.seam, f.pick, f.k, f.ring, f.target]);
    }
    return JSON.stringify(out);
  };
  assert.equal(run(), run());
});

test('shared fork: stay and switch outcomes are consistent with the seam', () => {
  const w = new World();
  for (let i = 0; i < 2000; i++) {
    if (w.needsRegion()) w.beginRegion(w.chainedSeed());
    const f = w.nextFork();
    assert.ok(!(f.stayWins && f.switchWins), 'both cannot win');
    if (f.k !== null) assert.notEqual(f.k, f.pick);
    assert.equal(won(f, 'stay'), f.seam === f.pick && !f.ring);
  }
});
