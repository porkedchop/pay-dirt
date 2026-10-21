import { Expedition, TOWNS } from './expedition.js';
import { WeatherDice } from './entropy.js';
import { SPIRITS, fnv1a, won } from './sim.js';
import { Cave, MINER_COLORS } from './cave.js';
import { DecisionLog, rowFor } from './log.js';

const $ = (id) => document.getElementById(id);
const ROMAN = ['I', 'II', 'III'];
const SERIES = ['Apprentice', 'Oracle', 'Parrot'];
const NICK = { Oracle: 'Old Timer', Apprentice: 'Rookie', Parrot: 'Bookworm' }; // code names stay oracle / apprentice / parrot
const nick = (n) => NICK[n] || n;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const pct = (p) => (p === null || p === undefined ? '' : `${Math.round(p * 100)}%`);
const verb = (a) => (a === 'switch' ? 'switches' : 'stays');
const dot = (n) => `<i class="dot" style="background:${hex(MINER_COLORS[n])}"></i>`;

const state = { speed: 1, paused: false, turbo: false };
const PACE = 2; // seconds per step at 1x are multiplied by this
const READ = 24; // characters per second a caption gets to stay up, at 1x
let ex, cave, dice, log;
let lastPart = -1, tally = null, skipCard = null;

// for screenshots and bug reports: ?seed=7&skip=1300&freeze=blast replays the exact same run and stops there
const DEV = (() => { try { const q = new URLSearchParams(location.search); return { seed: q.get('seed'), skip: +q.get('skip') || 0, freeze: q.get('freeze') }; } catch { return {}; } })();
const freeze = (phase) => (DEV.freeze === phase ? new Promise(() => {}) : null);

const wait = (s) => new Promise((r) => {
  const go = () => (state.paused ? setTimeout(go, 120) : setTimeout(r, (s * 1000 * PACE) / state.speed));
  go();
});
// show a caption and keep it up long enough to read
const say = (text, min = 0) => { $('narration').textContent = text; return wait(Math.max(min, text.length / READ / PACE * 1.6)); };

async function forkCycle() {
  const { f, calls, region } = ex.open();
  if (region.index !== lastPart) {
    const done = tally;
    tally = { part: region.index, spirit: region.spirit, forks: 0, gold: { Apprentice: 0, Oracle: 0, Parrot: 0 } };
    lastPart = region.index;
    cave.setRegion(region, dice.weather[region.town]);
    cave.build(f);
    $('fade').classList.remove('on');
    renderTop(region);
    renderNotes();
    await recap(done, region);
  }
  cave.setRegion(region, dice.weather[region.town]);
  cave.build(f);
  $('fade').classList.remove('on');
  renderTop(region);
  $('calls').innerHTML = '';

  cave.pick(f.pick);
  await freeze('pick');
  await say(`The crew picks tunnel ${ROMAN[f.pick]}.`, 0.8);

  if (f.k !== null) {
    $('narration').textContent = `Someone lit dynamite in tunnel ${ROMAN[f.k]}…`;
    await cave.blast(f.k, f.ring, 2 / state.speed); // the boom line waits for the actual boom
    $('narration').textContent = f.ring ? `Boom! Tunnel ${ROMAN[f.k]} is gone, and the gold was in it.` : `Boom! Tunnel ${ROMAN[f.k]} is blown shut.`;
    await freeze('boom');
    await wait(1.0);
    cave.inspect(f.k);
    await say(f.ring ? `The gold is buried under the rubble in tunnel ${ROMAN[f.k]}. Nobody can get it now.` : `Nothing in tunnel ${ROMAN[f.k]} but rubble. That leaves tunnels ${ROMAN[f.pick]} and ${ROMAN[f.target]}.`, 1);
    await freeze('blast');
  } else {
    await say('No blast this time. All three tunnels are still open.', 1);
    await freeze('blast');
  }

  cave.showCalls(calls, f);
  renderCalls(calls);
  const callLine = Object.entries(calls).map(([n, c]) => `${nick(n)} ${verb(c.action)}.`).join(' ');
  $('narration').textContent = callLine;
  await freeze('calls');
  await say(callLine, 1.2);

  const res = ex.resolve();
  log.add(rowFor(ex, res, log.run));
  count(res);
  cave.reveal(f);
  const winners = Object.entries(calls).filter(([, c]) => won(f, c.action)).map(([n]) => nick(n));
  renderNotes();
  const result = f.ring ? 'Nobody gets gold this time.' : `The gold was in tunnel ${ROMAN[f.ore]}. ${winners.length ? `${winners.join(' and ')} got it!` : 'Nobody got it.'}`;
  $('narration').textContent = result;
  await freeze('reveal');
  await say(result, 1.2);

  cave.advance();
  await wait(1.1);
  $('fade').classList.add('on');
  await wait(0.4);
  cave.stopWalk();
}

function count({ f, calls }) {
  if (!tally || tally.part !== f.region) return;
  tally.forks += 1;
  for (const n of SERIES) if (won(f, calls[n].action)) tally.gold[n] += 1;
}

// between parts: close up on the crew, how the last part went, then how the next one was shuffled
async function recap(done, R) {
  if (state.turbo || !$('intro').hidden) return; // never block the live run while the welcome card is up
  cave.closeUp(true);
  $('narration').textContent = '';
  $('calls').innerHTML = '';
  const cards = [];
  if (done && done.forks) cards.push(() => doneCard(done));
  cards.push(() => shuffleCard(R));
  $('recap').hidden = false;
  for (let i = 0; i < cards.length; i++) {
    const last = i === cards.length - 1;
    $('recapCard').innerHTML = cards[i]() + `<div class="cardbtns"><span class="dots">${cards.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</span><button type="button" class="btn" id="btnNext">${last ? 'Start digging' : 'Next'}</button></div>`;
    $('btnNext').onclick = () => skipCard?.();
    await freeze(last ? 'shuffle' : 'done');
    await Promise.race([wait(10), new Promise((r) => { skipCard = r; })]); // waits for a click, moves on by itself after ~20s at 1x
  }
  $('recap').hidden = true;
  cave.closeUp(false);
  await wait(0.5);
}

function doneCard(t) {
  const s = SPIRITS[t.spirit];
  const rows = SERIES.map((n) => `<li><span>${dot(n)} ${nick(n)}</span><span class="bar"><span style="width:${(100 * t.gold[n]) / t.forks}%;background:${hex(MINER_COLORS[n])}"></span></span><span class="num">${t.gold[n]} of ${t.forks}</span></li>`).join('');
  const fooled = t.spirit === 2 && t.gold.Parrot < t.gold.Apprentice ? ' The Bookworm fell for it.' : '';
  return `<h2>Part ${t.part + 1} done</h2><p class="sub">It was <b>${s.name}</b> lighting the dynamite. ${s.lesson}${fooled}</p>
    <ul class="tally">${rows}</ul><p>Gold each miner found in that part of the mine.</p>`;
}

function apiLine() {
  const c = dice.calls[0];
  if (!c) return 'Replay mode: this uses weather saved on Oct 21, so the run comes out the same every time.';
  if (c.ok) return `We asked open-meteo.com, a free weather service, at ${c.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. It answered in ${c.ms} ms.`;
  return 'Couldn’t reach the weather service from here, so this uses weather saved on Oct 21 plus your browser’s own randomness.';
}

function shuffleCard(R) {
  const t = TOWNS[R.town], w = dice.weather[R.town];
  return `<h2>Shuffling part ${R.index + 1}</h2><p class="sub">Each part of the mine is shuffled with real weather, so nobody can predict it. Not even us.</p>
    <ol class="steps">
      <li><span class="n">1</span><div><h3>Check the weather in ${t.city}, ${t.country}</h3><p>${w.temperature_2m}°C, wind ${w.wind_speed_10m} km/h, humidity ${w.relative_humidity_2m}%, rain ${w.precipitation} mm</p><p class="api">${apiLine()}</p></div></li>
      <li><span class="n">2</span><div><h3>Scramble it into a number</h3><p class="big">${R.seed.toString(16).padStart(8, '0')}</p><p>Like shaking a jar of weather. Change one tiny thing and you get a completely different number.</p></div></li>
      <li><span class="n">3</span><div><h3>That number decides everything</h3><p>Who is lighting the dynamite here (kept secret from the miners), how long this part lasts (<b>${R.length} picks</b>), and where the gold is each time.</p></div></li>
    </ol>`;
}

async function runLoop() {
  let lastPaint = 0;
  for (;;) {
    if (state.paused) { await new Promise((r) => setTimeout(r, 150)); continue; }
    if (!state.turbo) { await forkCycle(); continue; }
    const t0 = performance.now();
    let last;
    for (let n = 0; n < 300 && performance.now() - t0 < 12; n++) { last = ex.step(); log.add(rowFor(ex, last, log.run)); }
    if (performance.now() - lastPaint > 500) {
      lastPaint = performance.now();
      const R = ex.world.region;
      lastPart = R.index; tally = null;
      cave.setRegion(R, dice.weather[R.town]);
      cave.build(last.f);
      cave.showCalls(last.calls, last.f);
      renderTop(R);
      renderCalls(last.calls);
      renderNotes();
      $('narration').textContent = `Fast forward: pick ${(last.f.index + 1).toLocaleString()}. The Rookie is practicing as fast as it can.`;
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
}

function renderTop(R) {
  const t = TOWNS[R.town], w = dice.weather[R.town];
  $('part').textContent = `Part ${R.index + 1} of the mine · pick ${R.forksDone} of ${R.length}`;
  $('town').textContent = `${t.city}, ${t.country}`;
  $('wx').textContent = `Shuffled with the weather there: ${Math.round(w.temperature_2m)}°C, wind ${Math.round(w.wind_speed_10m)} km/h`;
  renderBelief();
}

function renderCalls(calls) {
  $('calls').innerHTML = Object.entries(calls).map(([n, c]) => {
    const p = c.action === 'switch' ? c.pSwitch : c.pStay;
    return `<span class="chip"><i style="background:${hex(MINER_COLORS[n])}"></i>${nick(n)} ${verb(c.action)}${p === null ? '' : ` <span class="p">${pct(p)} sure</span>`}</span>`;
  }).join('');
}

function renderBelief() {
  const b = ex.oracle.belief || SPIRITS.map(() => 1 / SPIRITS.length);
  const top = b.indexOf(Math.max(...b));
  $('belief').innerHTML = SPIRITS.map((s, i) => `<div class="meter${i === top ? ' lead' : ''}"><span>${s.name}</span>
    <span class="bar"><span style="width:${(b[i] * 100).toFixed(0)}%;background:${i === top ? 'var(--gold)' : 'var(--dim)'}"></span></span><span class="v">${pct(b[i])}</span></div>`).join('');
}

function renderNotes() {
  renderBelief();
  $('score').innerHTML = `<span class="h">Miner</span><span class="h">Gold</span><span class="h">Missed per 100</span>`
    + SERIES.map((n) => { const r = ex.recent(n); return `<span class="who">${dot(n)}${nick(n)}</span><span class="n">${ex.stats[n].ore.toLocaleString()}</span><span class="n">${r === null ? '' : r.toFixed(1)}</span>`; }).join('');
  renderChart();
  $('quizzes').innerHTML = ex.quizzes.map((q) => {
    const said = q.pSwitch > q.pStay ? 'switch' : 'stay';
    const right = q.expect === 'either' ? 'either one' : q.expect;
    const rookie = q.expect === 'either' ? (q.pass ? 'about 50/50' : `${said}, too sure`) : said;
    return `<tr><td>${q.spirit} blasts</td><td>${right}</td><td>${rookie}</td><td class="${q.pass ? 'ok' : 'no'}">${q.pass ? '✓' : '✗'}</td></tr>`;
  }).join('');
  const R = ex.world.region;
  if (R) {
    const t = TOWNS[R.town], w = dice.weather[R.town];
    $('wxNote').innerHTML = `<p>Every part of the mine is shuffled with the real weather in a mining town right now. This part: <b>${t.city}, ${t.country}</b>, ${w.temperature_2m}°C with wind at ${w.wind_speed_10m} km/h.</p>
      <p>That reading gets scrambled into the number <span class="seed">${R.seed.toString(16).padStart(8, '0')}</span>, which secretly decides who’s lighting the dynamite, how long this part lasts, and where the gold goes.</p>
      <p class="api">${apiLine()}</p>`;
  }
  $('logCount').textContent = log.db
    ? `${(log.stored + log.pending.length).toLocaleString()} picks saved on this device. Download them to look through yourself.`
    : 'This browser won’t let the page save, so picks are only kept until you close the tab.';
  $('logRows').innerHTML = log.recent.slice(-4).reverse().map((r) => {
    const c = r.calls.rookie;
    const ev = r.knock === null ? 'no blast' : `blast in ${ROMAN[r.knock]}`;
    return `<li><span>#${r.fork + 1}</span><span>${SPIRITS[r.spirit].name}, ${ev}. Rookie ${c.move === 'switch' ? 'switched' : 'stayed'}</span><span class="${c.hit ? 'hit' : 'miss'}">${c.hit ? 'gold' : 'empty'}</span></li>`;
  }).join('');
}

function renderChart() {
  const W = 340, H = 170, L = 34, R = 70, T = 10, B = 24;
  const thin = (s, max = 220) => (s.length <= max ? s : [...Array.from({ length: max }, (_, i) => s[Math.floor((i * s.length) / max)]), s.at(-1)]);
  const series = SERIES.map((n) => ({ n, pts: thin(ex.stats[n].series) })).filter((x) => x.pts.length);
  const xmax = Math.max(10, ex.world.forkCount);
  const ymax = Math.max(1, ...series.map((x) => x.pts.at(-1)[1])) * 1.08;
  const xs = (x) => L + (x / xmax) * (W - L - R), ys = (y) => T + (1 - y / ymax) * (H - T - B);
  let svg = '';
  for (const t of ticks(ymax, 4)) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${ys(t)}" y2="${ys(t)}"/><text class="tick" x="${L - 6}" y="${ys(t) + 3}" text-anchor="end">${short(t)}</text>`;
  for (const t of ticks(xmax, 3)) svg += `<text class="tick" x="${xs(t)}" y="${H - 6}" text-anchor="middle">${short(t)}</text>`;
  svg += `<line class="axis" x1="${L}" x2="${W - R}" y1="${ys(0)}" y2="${ys(0)}"/>`;
  const labels = [];
  for (const { n, pts } of series) {
    svg += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${xs(p[0]).toFixed(1)},${ys(p[1]).toFixed(1)}`).join('')}" fill="none" stroke="${hex(MINER_COLORS[n])}" stroke-width="2.5" stroke-linejoin="round"/>`;
    const lp = pts.at(-1);
    svg += `<circle cx="${xs(lp[0])}" cy="${ys(lp[1])}" r="3.5" fill="${hex(MINER_COLORS[n])}"/>`;
    labels.push({ n, y: ys(lp[1]) });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 12);
  for (const l of labels) svg += `<text class="dlabel" x="${W - R + 7}" y="${l.y + 4}">${nick(l.n)}</text>`;
  $('chart').innerHTML = svg;
}
function ticks(max, n) {
  const raw = max / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}
const short = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v * 10) / 10}`);

function bindControls() {
  $('btnPause').addEventListener('click', () => {
    state.paused = !state.paused;
    $('btnPause').textContent = state.paused ? 'Resume' : 'Pause';
    $('btnPause').classList.toggle('off', !state.paused);
  });
  document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    state.turbo = b.dataset.speed === 'turbo';
    state.speed = state.turbo ? 3 : +b.dataset.speed;
    document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('off', x !== b));
    if (state.turbo) skipCard?.();
  }));
  $('btnNotes').addEventListener('click', () => {
    const bare = $('app').classList.toggle('bare');
    $('btnNotes').textContent = bare ? 'Show notes' : 'Hide notes';
  });
  $('btnDownload').addEventListener('click', async () => {
    const rows = await log.all();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map((r) => JSON.stringify(r)).join('\n') + '\n'], { type: 'application/x-ndjson' }));
    a.download = `pay-dirt-${new Date().toISOString().slice(0, 10)}.jsonl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  $('btnClearLog').addEventListener('click', async () => { await log.clear(); renderNotes(); });
}

async function boot() {
  bindControls();
  $('spirits').innerHTML = SPIRITS.map((s) => `<li><b>${s.name}</b>: ${s.rule} <em>${s.lesson}</em></li>`).join('');
  const gist = ['knows where the gold is → switch', 'random, could be anywhere → coin flip', 'only blasts when you’re right → stay'];
  $('introSpirits').innerHTML = SPIRITS.map((s, i) => `<li><b>${s.name}</b><span>${gist[i]}</span></li>`).join('');
  let seen = false;
  try { seen = localStorage.getItem('payDirtSeen') === '1'; } catch { /* storage blocked, show it */ }
  if (!seen && !DEV.seed) $('intro').hidden = false;
  $('btnIntro').addEventListener('click', () => {
    $('intro').hidden = true;
    try { localStorage.setItem('payDirtSeen', '1'); } catch { /* fine */ }
  });
  $('narration').textContent = 'Checking the weather…';
  log = await new DecisionLog().open();
  if (DEV.seed) {
    dice = new WeatherDice();
    let n = 0;
    ex = new Expedition({ seedSource: () => ({ seed: fnv1a(`dev:${DEV.seed}:${n}`), town: n++ % TOWNS.length, source: 'fixed seed' }) });
  } else {
    dice = await new WeatherDice().start();
    ex = new Expedition({ seedSource: () => dice.take() });
  }
  for (let i = 0; i < DEV.skip; i++) {
    const res = ex.step();
    if (res.f.region !== lastPart) { lastPart = res.f.region; tally = { part: res.f.region, spirit: res.f.spirit, forks: 0, gold: { Apprentice: 0, Oracle: 0, Parrot: 0 } }; }
    count(res);
    log.add(rowFor(ex, res, log.run));
  }
  cave = new Cave($('cave'));
  renderNotes();
  if (location.hash === '#turbo') document.querySelector('[data-speed="turbo"]').click();
  if (location.hash === '#bare') $('btnNotes').click(); // just the cave, for clips and streams
  const loop = () => { requestAnimationFrame(loop); try { cave.tick(); } catch (e) { console.error(e); } };
  requestAnimationFrame(loop);
  runLoop();
}

boot();
