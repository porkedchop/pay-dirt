// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOMMY, CREAKS, JOKER, knock, switchTarget, decide, oneHot, likelihood, World, Oracle, Parrot, regretOf, won } from '../web/sim.js';

// enumerate every ore pick coin. exact, no monte carlo
function rates(spirit) {
  let stay = 0, sw = 0, bookworm = 0, best = 0;
  for (let ore = 0; ore < 3; ore++) for (let pick = 0; pick < 3; pick++) for (const u of [0.25, 0.75]) for (const su of [0.25, 0.75]) {
    const w = 1 / 36;
    const { k, ring } = knock(spirit, ore, pick, u);
    const t = switchTarget(pick, k, su);
    const stayWin = !ring && ore === pick, swWin = !ring && t === ore;
    stay += w * stayWin; sw += w * swWin;
    bookworm += w * (k !== null ? swWin : stayWin);
    const d = decide(oneHot(spirit), pick, k, ring);
    best += w * (d.pSwitch > d.pStay ? swWin : stayWin);
  }
  return { stay, sw, bookworm, best };
}
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg}: ${a} vs ${b}`);

test('Tommy is classic Monty Hall: switching wins 2 in 3', () => {
  const r = rates(TOMMY);
  close(r.stay, 1 / 3, 'stay'); close(r.sw, 2 / 3, 'switch');
});

test('The Creaks is Monty Fall: a hollow knock is a coin flip', () => {
  const d = decide(oneHot(CREAKS), 0, 1, false);
  close(d.pStay, 0.5, 'stay'); close(d.pSwitch, 0.5, 'switch');
});

test('The Joker beats the textbook answer every time', () => {
  const r = rates(JOKER);
  close(r.bookworm, 0, 'bookworm'); close(r.best, 2 / 3, 'knowing the joker');
  close(decide(oneHot(JOKER), 0, 1, false).pStay, 1, 'a joker knock means you were right');
});

test('each spirit is a proper probability distribution over knocks', () => {
  for (const t of [TOMMY, CREAKS, JOKER]) for (let ore = 0; ore < 3; ore++) for (let pick = 0; pick < 3; pick++) {
    let total = 0;
    for (const k of [null, 0, 1, 2]) for (const ring of [false, true]) total += likelihood(t, ore, pick, k, ring);
    close(total, 1, `spirit ${t}`);
  }
});

test('old timer misses far less than the bookworm', () => {
  const w = new World(), o = new Oracle(w), p = new Parrot();
  let ro = 0, rp = 0;
  for (let i = 0; i < 20000; i++) {
    if (w.needsRegion()) o.beginRegion(w.beginRegion(w.chainedSeed()));
    const f = w.nextFork();
    ro += regretOf(f, o.act(f).action); rp += regretOf(f, p.act(f).action);
    o.learn(f);
  }
  assert.ok(ro < rp * 0.1, `old timer ${ro} vs bookworm ${rp}`);
});

test('a seed replays exactly and outcomes match the ore', () => {
  const run = () => {
    const w = new World(), out = [];
    for (let i = 0; i < 500; i++) {
      if (w.needsRegion()) w.beginRegion(w.chainedSeed());
      const f = w.nextFork();
      assert.equal(won(f, 'stay'), f.ore === f.pick && !f.ring);
      if (f.k !== null) assert.notEqual(f.k, f.pick);
      out.push([f.spirit, f.ore, f.pick, f.k, f.ring, f.target]);
    }
    return JSON.stringify(out);
  };
  assert.equal(run(), run());
});
