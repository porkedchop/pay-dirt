import { Expedition, TOWNS } from './expedition.js';
import { WeatherDice } from './entropy.js';
import { SPIRITS, fnv1a } from './sim.js';
import { Cave, MINER_COLORS } from './cave.js';
import { DecisionLog, rowFor } from './log.js';

const $ = (id) => document.getElementById(id);
const ROMAN = ['I', 'II', 'III'];
const SERIES = ['Apprentice', 'Parrot', 'Oracle'];
const NICK = { Oracle: 'Old Timer', Apprentice: 'Rookie', Parrot: 'Bookworm' }; // code names stay oracle / apprentice / parrot
const nick = (n) => NICK[n] || n;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const pct = (p) => (p === null || p === undefined ? '' : `${Math.round(p * 100)}%`);
const verb = (a) => (a === 'switch' ? 'switches' : 'stays');

const state = { speed: 1, paused: false, turbo: false };
const PACE = 1.6; // seconds per step at 1x are multiplied by this
let ex, cave, dice, log;

// for screenshots and bug reports: ?seed=7&skip=1300&freeze=knock replays the exact same run and stops there
const DEV = (() => { try { const q = new URLSearchParams(location.search); return { seed: q.get('seed'), skip: +q.get('skip') || 0, freeze: q.get('freeze') }; } catch { return {}; } })();
const freeze = (phase) => (DEV.freeze === phase ? new Promise(() => {}) : null);

const wait = (s) => new Promise((r) => {
  const go = () => (state.paused ? setTimeout(go, 120) : setTimeout(r, (s * 1000 * PACE) / state.speed));
  go();
});
const say = (text) => { $('narration').textContent = text; };
const townOf = (R) => TOWNS[R.town];
const weatherOf = (R) => dice.weather[R.town];

async function forkCycle() {
  const { f, calls, region } = ex.open();
  cave.setRegion(region, weatherOf(region));
  cave.build(f);
  $('fade').classList.remove('on');
  renderPlace(region);
  $('calls').innerHTML = '';

  say(`The crew picks tunnel ${ROMAN[f.pick]}.`);
  cave.pick(f.pick);
  await freeze('pick');
  await wait(1.1);

  if (f.k !== null) {
    say(f.ring ? `Knock knock knock. Tunnel ${ROMAN[f.k]} caves in, and something shiny got buried.` : `Knock knock knock. Tunnel ${ROMAN[f.k]} caves in.`);
    cave.knock(f.k, f.ring);
  } else {
    say('Silence. Nobody knocked.');
  }
  await wait(0.9);
  await freeze('knock');
  await wait(0.6);

  cave.showCalls(calls, f);
  renderCalls(calls);
  say(Object.entries(calls).map(([n, c]) => `${nick(n)} ${verb(c.action)}.`).join(' '));
  await wait(0.5);
  await freeze('calls');
  await wait(1.1);

  const res = ex.resolve();
  log.add(rowFor(ex, res, log.run));
  cave.reveal(f);
  const winners = Object.entries(calls).filter(([, c]) => (c.action === 'switch' ? f.switchWins : f.stayWins)).map(([n]) => nick(n));
  say(f.ring ? `The gold was in tunnel ${ROMAN[f.ore]}, and now it’s buried. Nobody gets it.`
    : `The gold was in tunnel ${ROMAN[f.ore]}. ${winners.length ? `${winners.join(' and ')} got it.` : 'Nobody got it.'}`);
  renderAll();
  await wait(0.9);
  await freeze('reveal');
  await wait(0.6);

  cave.advance(calls.Apprentice.action === 'switch' ? f.target : f.pick);
  await wait(1.0);
  $('fade').classList.add('on');
  await wait(0.45);
  cave.stopWalk();
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
      cave.setRegion(R, weatherOf(R));
      cave.build(last.f);
      cave.showCalls(last.calls, last.f);
      renderPlace(R);
      renderCalls(last.calls);
      renderAll();
      say(`Fast forward: pick ${(last.f.index + 1).toLocaleString()}. The Rookie is practicing as fast as it can.`);
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
}

function renderPlace(R) {
  const t = townOf(R), w = weatherOf(R);
  $('regionName').textContent = `Part ${R.index + 1} of the mine`;
  $('regionMeta').textContent = `Under ${t.city}, ${t.country} · ${w.temperature_2m.toFixed(0)}°C, wind ${Math.round(w.wind_speed_10m)} km/h · pick ${R.forksDone} of ${R.length}`;
}

function renderCalls(calls) {
  $('calls').innerHTML = Object.entries(calls).map(([n, c]) => {
    const p = c.action === 'switch' ? c.pSwitch : c.pStay;
    return `<span class="chip"><i style="background:${hex(MINER_COLORS[n])}"></i>${nick(n)} ${verb(c.action)}${p === null ? '' : ` <span class="p">${pct(p)} sure</span>`}</span>`;
  }).join('');
}

function renderAll() {
  renderBelief(); renderScores(); renderChart(); renderQuizzes(); renderLog(); renderFeed();
}

function renderBelief() {
  const b = ex.oracle.belief || SPIRITS.map(() => 1 / SPIRITS.length);
  const top = b.indexOf(Math.max(...b));
  $('belief').innerHTML = SPIRITS.map((s, i) => `<div class="brow${i === top ? ' top' : ''}"><span>${s.name}</span>
    <progress class="nes-progress${i === top ? ' is-warning' : ''}" value="${Math.round(b[i] * 100)}" max="100" aria-label="${s.name}"></progress><span class="bval">${pct(b[i])}</span></div>`).join('');
}

function renderScores() {
  $('scores').innerHTML = `<thead><tr><th>Miner</th><th>Gold</th><th>Missed</th></tr></thead><tbody>${SERIES.map((n) => {
    const s = ex.stats[n], r = ex.recent(n);
    return `<tr><td><i style="background:${hex(MINER_COLORS[n])}"></i>${nick(n)}</td><td>${s.ore}</td><td>${r === null ? '' : r.toFixed(1)}</td></tr>`;
  }).join('')}</tbody>`;
  $('forkCount').textContent = `${ex.world.forkCount.toLocaleString()} pick${ex.world.forkCount === 1 ? '' : 's'}`;
}

let chart = null;
function renderChart() {
  const W = 340, H = 170, L = 34, R = 66, T = 10, B = 24;
  const thin = (s, max = 220) => (s.length <= max ? s : [...Array.from({ length: max }, (_, i) => s[Math.floor((i * s.length) / max)]), s.at(-1)]);
  const series = SERIES.map((n) => ({ n, pts: thin(ex.stats[n].series) })).filter((x) => x.pts.length);
  const xmax = Math.max(10, ex.world.forkCount);
  const ymax = Math.max(1, ...series.map((x) => x.pts.at(-1)[1])) * 1.08;
  const xs = (x) => L + (x / xmax) * (W - L - R), ys = (y) => T + (1 - y / ymax) * (H - T - B);
  let svg = '';
  for (const t of ticks(ymax, 4)) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${ys(t)}" y2="${ys(t)}"/><text class="tick" x="${L - 6}" y="${ys(t) + 3}" text-anchor="end">${short(t)}</text>`;
  for (const t of ticks(xmax, 3)) svg += `<text class="tick" x="${xs(t)}" y="${H - 8}" text-anchor="middle">${short(t)}</text>`;
  svg += `<line class="axis" x1="${L}" x2="${W - R}" y1="${ys(0)}" y2="${ys(0)}"/>`;
  const labels = [];
  for (const { n, pts } of series) {
    svg += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${xs(p[0]).toFixed(1)},${ys(p[1]).toFixed(1)}`).join('')}" fill="none" stroke="${hex(MINER_COLORS[n])}" stroke-width="2"/>`;
    const lp = pts.at(-1);
    svg += `<circle cx="${xs(lp[0])}" cy="${ys(lp[1])}" r="3" fill="${hex(MINER_COLORS[n])}"/>`;
    labels.push({ n, y: ys(lp[1]) });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 11);
  for (const l of labels) svg += `<text class="dlabel" x="${W - R + 6}" y="${l.y + 3}">${nick(l.n)}</text>`;
  svg += `<line id="cross" class="cross" y1="${T}" y2="${ys(0)}" visibility="hidden"/><rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>`;
  $('chart').innerHTML = svg;
  chart = { xs, L, R, W, xmax };
}
function ticks(max, n) {
  const raw = max / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}
const short = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v * 10) / 10}`);

function bindChartHover() {
  const svg = $('chart'), tip = $('chartTip');
  const hide = () => { tip.hidden = true; svg.querySelector('#cross')?.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointermove', (e) => {
    if (!chart) return;
    const box = svg.getBoundingClientRect(), px = ((e.clientX - box.left) / box.width) * 340;
    if (px < chart.L || px > chart.W - chart.R) return hide();
    const fork = Math.round(((px - chart.L) / (chart.W - chart.L - chart.R)) * chart.xmax);
    tip.innerHTML = `<div class="tt">After ${fork.toLocaleString()} picks</div>` + SERIES.map((n) => {
      const s = ex.stats[n].series;
      let lo = 0, hi = s.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid][0] <= fork) lo = mid; else hi = mid - 1; }
      return s.length ? `<div><i style="background:${hex(MINER_COLORS[n])}"></i>${nick(n)}<b>${s[lo][1].toFixed(1)}</b></div>` : '';
    }).join('');
    tip.hidden = false;
    tip.style.left = `${Math.min(box.width - 150, Math.max(0, e.clientX - box.left + 12))}px`;
    const c = svg.querySelector('#cross');
    c.setAttribute('visibility', 'visible'); c.setAttribute('x1', chart.xs(fork)); c.setAttribute('x2', chart.xs(fork));
  });
}

function renderQuizzes() {
  $('quizzes').innerHTML = ex.quizzes.map((q) => {
    const said = q.pSwitch > q.pStay ? 'switch' : 'stay';
    const right = q.expect === 'either' ? 'either one' : q.expect;
    const rookie = q.expect === 'either' ? (q.pass ? 'about 50/50' : `${said}, too sure`) : said;
    return `<li class="${q.pass ? 'pass' : 'fail'}"><span>${q.spirit} knocks</span><span>${right}</span><span>${rookie}</span><b>${q.pass ? '✓' : '✗'}</b></li>`;
  }).join('');
  $('quizCount').textContent = `${ex.quizzes.filter((q) => q.pass).length} of ${ex.quizzes.length} right`;
}

function renderLog() {
  $('logCount').textContent = log.db
    ? `${(log.stored + log.pending.length).toLocaleString()} picks saved on this device.`
    : 'This browser won’t let the page save, so the log only lasts until you close the tab.';
  $('logRows').innerHTML = log.recent.slice(-5).reverse().map((r) => {
    const c = r.calls.rookie;
    const ev = r.knock === null ? 'silence' : `knock on ${ROMAN[r.knock]}`;
    return `<li><span>#${r.fork + 1}</span><span>${SPIRITS[r.spirit].name}, ${ev}. Rookie ${c.move === 'switch' ? 'switched' : 'stayed'}</span><span class="${c.hit ? 'hit' : 'miss'}">${c.hit ? 'gold' : 'empty'}</span></li>`;
  }).join('');
}

function renderFeed() {
  const time = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const R = ex.world.region;
  const here = R ? R.town : 0, t = TOWNS[here], w = dice.weather[here];
  const c = dice.calls[0];
  $('feedHere').textContent = `${t.city}, ${t.country}`;
  $('feedWx').textContent = `${w.temperature_2m.toFixed(1)}°C · rain ${w.precipitation.toFixed(1)} mm · wind ${w.wind_speed_10m.toFixed(1)} km/h · humidity ${Math.round(w.relative_humidity_2m)}%`;
  $('callLine').innerHTML = !c
    ? ''
    : `<span class="verb">GET</span> <span class="url">${c.url.replace('https://', '')}</span><br>${time(c.at)} · ${c.ok ? `<span class="verb">${c.status} OK</span>` : `<span class="bad">couldn’t connect</span>`} · ${c.ms} ms`;
  $('callNote').textContent = !c
    ? 'Replay mode uses weather saved on Oct 21, so the run comes out the same every time.'
    : w.saved
    ? 'Couldn’t reach the weather service from here, so this uses weather saved on Oct 21, mixed with your browser’s own randomness.'
    : `Live weather from ${w.time.replace('T', ' ')} UTC.${dice.nextCheck ? ` Checks again in ${Math.max(1, Math.ceil((dice.nextCheck - Date.now()) / 60000))} min.` : ''}`;
  $('rolls').innerHTML = dice.rolls.slice(0, 3).map((r) => {
    const rw = dice.weather[r.town];
    return `<li>${TOWNS[r.town].city}: ${rw.temperature_2m}°C, wind ${rw.wind_speed_10m} → <b>${r.seed.toString(16).padStart(8, '0')}</b></li>`;
  }).join('');
  $('callBody').textContent = JSON.stringify({ city: t.city, country: t.country, time: w.time, temperature_2m: w.temperature_2m, precipitation: w.precipitation, wind_speed_10m: w.wind_speed_10m, relative_humidity_2m: w.relative_humidity_2m }, null, 1);
}

function bindControls() {
  $('btnPause').addEventListener('click', () => {
    state.paused = !state.paused;
    $('btnPause').textContent = state.paused ? 'Resume' : 'Pause';
    $('btnPause').classList.toggle('is-warning', state.paused);
  });
  document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    state.turbo = b.dataset.speed === 'turbo';
    state.speed = state.turbo ? 4 : +b.dataset.speed;
    document.querySelectorAll('[data-speed]').forEach((x) => { x.setAttribute('aria-pressed', String(x === b)); x.classList.toggle('is-warning', x === b); });
  }));
  $('btnDownload').addEventListener('click', async () => {
    const rows = await log.all();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map((r) => JSON.stringify(r)).join('\n') + '\n'], { type: 'application/x-ndjson' }));
    a.download = `pay-dirt-${new Date().toISOString().slice(0, 10)}.jsonl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  $('btnClearLog').addEventListener('click', async () => { await log.clear(); renderLog(); });
}

async function boot() {
  bindControls();
  bindChartHover();
  say('Checking the weather…');
  log = await new DecisionLog().open();
  if (DEV.seed) {
    dice = new WeatherDice();
    let n = 0;
    ex = new Expedition({ seedSource: () => ({ seed: fnv1a(`dev:${DEV.seed}:${n}`), town: n++ % TOWNS.length, source: 'fixed seed' }) });
  } else {
    dice = await new WeatherDice().start();
    ex = new Expedition({ seedSource: () => dice.take() });
  }
  for (let i = 0; i < DEV.skip; i++) log.add(rowFor(ex, ex.step(), log.run));
  cave = new Cave($('cave'));
  renderAll();
  if (location.hash === '#turbo') document.querySelector('[data-speed="turbo"]').click();
  setInterval(renderFeed, 10000);
  const loop = () => { requestAnimationFrame(loop); try { cave.tick(); } catch (e) { console.error(e); } };
  requestAnimationFrame(loop);
  runLoop();
}

boot();
