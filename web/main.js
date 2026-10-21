import { Expedition, SITES } from './expedition.js';
import { EntropyWell } from './entropy.js';
import { TRIBES, STRATA } from './sim.js';
import { Cave, MINER_COLORS } from './cave.js';
import { CANARIES } from './apprentice.js';

const $ = (id) => document.getElementById(id);
const ROMAN = ['I', 'II', 'III'];
const SERIES = ['Apprentice', 'Parrot', 'Oracle', 'You'];
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

const state = { speed: 1, paused: false, playAlong: false, sound: false, turbo: false };
let ex, cave, well, audio;
let lastRegion = -1;
let youResolve = null;

// ---------- sound. synthesized, nothing to download
function initAudio() {
  if (audio) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  audio = { ctx, master };
}
function knockSound(times = 3, metal = false) {
  if (!state.sound || !audio) return;
  const { ctx, master } = audio;
  for (let i = 0; i < times; i++) {
    const t = ctx.currentTime + i * 0.2;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.25);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * (1 - j / d.length) ** 3;
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = buf; f.type = 'bandpass'; f.frequency.value = 1100; ng.gain.value = 0.6;
    n.connect(f).connect(ng).connect(master);
    n.start(t);
  }
  if (metal) {
    const t = ctx.currentTime + times * 0.2;
    for (const fr of [880, 1318, 1760]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = fr;
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      o.connect(g).connect(master); o.start(t); o.stop(t + 1.5);
    }
  }
}
function dripSound() {
  if (!state.sound || !audio) return;
  const { ctx, master } = audio;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(1500 + Math.random() * 900, t);
  o.frequency.exponentialRampToValueAtTime(700, t + 0.08);
  g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
  o.connect(g).connect(master); o.start(t); o.stop(t + 0.14);
}

// ---------- timing
const wait = (s) => new Promise((r) => {
  const step = () => {
    if (state.paused) return setTimeout(step, 120);
    setTimeout(r, (s * 1000) / state.speed);
  };
  step();
});

function narrate(text) { $('narration').textContent = text; }

function fmtPct(p) { return p === null || p === undefined ? '' : `${Math.round(p * 100)}%`; }

// ---------- one fork, animated
async function forkCycle() {
  const pending = ex.open();
  const { f, calls, region } = pending;
  onRegion(region);
  cave.build(f, region);
  $('fade').classList.remove('on');
  renderFork(f, region, null);

  narrate(`The crew draws lots for tunnel ${ROMAN[f.pick]}.`);
  cave.pick(f.pick);
  await wait(1.1);

  if (f.k !== null) {
    narrate(f.ring
      ? `Knock, knock, knock. Tunnel ${ROMAN[f.k]} caves in, and it rang like metal as it fell.`
      : `Knock, knock, knock. Tunnel ${ROMAN[f.k]} sounds hollow and caves in.`);
    knockSound(3, f.ring);
    cave.knock(f.k, f.ring);
  } else {
    narrate('Silence. Nobody knocks.');
  }
  await wait(1.5);

  let you = null;
  if (state.playAlong && !state.turbo) {
    $('playAlong').hidden = false;
    $('yourMove').textContent = f.k !== null ? `Stay in ${ROMAN[f.pick]} or switch to ${ROMAN[f.target]}?` : `Stay in ${ROMAN[f.pick]} or gamble on another tunnel?`;
    narrate('Your call.');
    you = await new Promise((r) => { youResolve = r; });
    $('playAlong').hidden = true;
  }
  const shown = { ...calls };
  if (you) shown.You = { action: you };
  cave.showCalls(shown, f);
  renderCalls(shown, f);
  narrate(callLine(shown, f));
  await wait(1.6);

  const res = ex.resolve(you);
  cave.reveal(f);
  narrate(resultLine(res, f));
  renderAll();
  await wait(1.5);

  const appTunnel = calls.Apprentice.action === 'switch' ? f.target : f.pick;
  cave.advance(appTunnel);
  await wait(1.0);
  $('fade').classList.add('on');
  await wait(0.45);
  cave.stopWalk();
}

function callLine(calls, f) {
  const parts = Object.entries(calls).map(([n, c]) => `${n} ${c.action === 'switch' ? 'switches' : 'stays'}`);
  return parts.join(', ') + '.';
}

function resultLine({ calls }, f) {
  if (f.ring) return `The seam was in ${ROMAN[f.seam]}, now buried. Nobody strikes ore here.`;
  const winners = Object.entries(calls).filter(([, c]) => (c.action === 'switch' ? f.switchWins : f.stayWins)).map(([n]) => n);
  const site = SITES[ex.world.region.site];
  return `The seam ran through ${ROMAN[f.seam]}. ${winners.length ? `${winners.join(' and ')} struck ${site.ore}.` : 'Nobody struck ore.'}`;
}

// ---------- turbo: many forks per frame, no animation
function turboFrame() {
  const t0 = performance.now();
  let last;
  for (let n = 0; n < 300 && performance.now() - t0 < 14; n++) {
    last = ex.step();
    if (ex.world.region.index !== lastRegion) onRegion(ex.world.region);
  }
  return last;
}

async function runLoop() {
  let lastPaint = 0;
  for (;;) {
    if (state.paused) { await new Promise((r) => setTimeout(r, 150)); continue; }
    if (state.turbo) {
      const last = turboFrame();
      const now = performance.now();
      if (now - lastPaint > 350) {
        lastPaint = now;
        renderAll();
        if (last) {
          cave.build(last.f, ex.world.region);
          renderFork(last.f, ex.world.region, last.calls);
          cave.showCalls(last.calls, last.f);
          renderCalls(last.calls, last.f);
          narrate(`Turbo: fork ${last.f.index + 1}. The Apprentice is training as fast as your CPU allows.`);
        }
      }
      await new Promise((r) => requestAnimationFrame(r));
    } else {
      await forkCycle();
    }
  }
}

// ---------- region change
function onRegion(R) {
  if (R.index === lastRegion) return;
  lastRegion = R.index;
  cave.setWeather(R.wx);
}

// ---------- rendering
function renderFork(f, R, calls) {
  const site = SITES[R.site];
  const wx = R.wx;
  $('regionName').textContent = `${STRATA[R.strata].name} under ${site.name}`;
  $('regionWhere').textContent = `${site.place} · ${site.ore}`;
  $('regionMeta').textContent = `Region ${R.index + 1} · fork ${R.forksDone} of ${R.length} · ${wx.temperature_2m.toFixed(1)}°C · rain ${wx.precipitation.toFixed(1)} mm · wind ${Math.round(wx.wind_speed_10m)} km/h`;
  $('wxSource').textContent = wx.recorded ? 'recorded weather' : 'live weather';
  if (!calls) $('calls').innerHTML = '';
}

function renderCalls(calls, f) {
  $('calls').innerHTML = Object.entries(calls).map(([name, c]) => {
    const t = c.action === 'switch' ? f.target : f.pick;
    const p = c.action === 'switch' ? c.pSwitch : c.pStay;
    const conf = p === null || p === undefined ? '' : `<span class="p">${fmtPct(p)}</span>`;
    return `<span class="chip"><i style="background:${hex(MINER_COLORS[name])}"></i>${name} <b>${c.action}</b> → ${ROMAN[t]}${conf}</span>`;
  }).join('');
}

function renderAll() {
  const s = ex.summary(300);
  renderBelief();
  renderScores(s);
  renderChart();
  renderCanaries(s);
  renderMetrics(s);
  renderLedger();
  renderPast();
}

function renderBelief() {
  const b = ex.oracle.belief || [0.25, 0.25, 0.25, 0.25];
  const top = b.indexOf(Math.max(...b));
  $('belief').innerHTML = TRIBES.map((t, i) => `
    <div class="brow${i === top ? ' top' : ''}">
      <span class="bname">${t.name}</span>
      <span class="btrack"><span class="bfill" style="width:${(b[i] * 100).toFixed(1)}%"></span></span>
      <span class="bval">${fmtPct(b[i])}</span>
    </div>`).join('');
}

function renderScores(s) {
  const rows = SERIES.filter((n) => s.miners[n]).map((n) => {
    const m = s.miners[n];
    return `<tr><td><i style="background:${hex(MINER_COLORS[n])}"></i>${n}</td>
      <td>${m.ore}</td><td>${fmtPct(m.winRate)}</td>
      <td>${m.recentRegretPer100 === null ? '' : m.recentRegretPer100.toFixed(1)}</td></tr>`;
  }).join('');
  $('scores').innerHTML = `<thead><tr><th>Miner</th><th>Ore</th><th>Win rate</th><th>Regret per 100</th></tr></thead><tbody>${rows}</tbody>`;
  $('forkCount').textContent = `${ex.world.forkCount.toLocaleString()} forks`;
}

function downsample(series, max = 220) {
  if (series.length <= max) return series;
  const step = series.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(series[Math.floor(i * step)]);
  out.push(series[series.length - 1]);
  return out;
}

let chartGeom = null;
function renderChart() {
  const W = 340, H = 180, L = 34, R = 66, T = 10, B = 24;
  const series = SERIES.map((n) => ({ n, pts: downsample(ex.stats[n].series) })).filter((x) => x.pts.length);
  const xmax = Math.max(10, ex.world.forkCount);
  const ymax = Math.max(1, ...series.map((x) => x.pts.at(-1)?.[1] ?? 0)) * 1.08;
  const xs = (x) => L + (x / xmax) * (W - L - R);
  const ys = (y) => T + (1 - y / ymax) * (H - T - B);
  const ticks = niceTicks(ymax, 4);
  const xt = niceTicks(xmax, 3);
  let svg = '';
  for (const t of ticks) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${ys(t)}" y2="${ys(t)}"/><text class="tick" x="${L - 6}" y="${ys(t) + 3}" text-anchor="end">${fmtNum(t)}</text>`;
  for (const t of xt) svg += `<text class="tick" x="${xs(t)}" y="${H - 8}" text-anchor="middle">${fmtNum(t)}</text>`;
  svg += `<line class="axis" x1="${L}" x2="${W - R}" y1="${ys(0)}" y2="${ys(0)}"/>`;
  for (const m of ex.world.migrations) {
    svg += `<line class="mig" x1="${xs(m)}" x2="${xs(m)}" y1="${T}" y2="${ys(0)}"/><text class="migl" x="${xs(m) + 3}" y="${T + 8}">moved</text>`;
  }
  const labels = [];
  for (const { n, pts } of series) {
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(p[0]).toFixed(1)},${ys(p[1]).toFixed(1)}`).join('');
    svg += `<path d="${d}" fill="none" stroke="${hex(MINER_COLORS[n])}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const lp = pts.at(-1);
    svg += `<circle cx="${xs(lp[0])}" cy="${ys(lp[1])}" r="3" fill="${hex(MINER_COLORS[n])}" stroke="var(--panel)" stroke-width="2"/>`;
    labels.push({ n, y: ys(lp[1]), x: xs(lp[0]) });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 11) labels[i].y = labels[i - 1].y + 11;
  for (const l of labels) svg += `<text class="dlabel" x="${W - R + 6}" y="${l.y + 3}">${l.n}</text>`;
  svg += `<g id="hover" visibility="hidden"><line class="cross" y1="${T}" y2="${ys(0)}"/></g><rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>`;
  $('chart').innerHTML = svg;
  chartGeom = { xs, ys, L, R, W, xmax, series };
}

function niceTicks(max, n) {
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}
function fmtNum(v) { return v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `${Math.round(v * 10) / 10}`; }

function bindChartHover() {
  const svg = $('chart');
  const tip = $('chartTip');
  svg.addEventListener('pointermove', (e) => {
    if (!chartGeom) return;
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * 340;
    const { xs, L, R, W, xmax } = chartGeom;
    if (px < L || px > W - R) { tip.hidden = true; svg.querySelector('#hover')?.setAttribute('visibility', 'hidden'); return; }
    const fork = Math.round(((px - L) / (W - L - R)) * xmax);
    const rows = SERIES.filter((n) => ex.stats[n].series.length).map((n) => {
      const s = ex.stats[n].series;
      let lo = 0, hi = s.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid][0] <= fork) lo = mid; else hi = mid - 1; }
      return `<div><i style="background:${hex(MINER_COLORS[n])}"></i>${n}<b>${s[lo][1].toFixed(1)}</b></div>`;
    }).join('');
    tip.innerHTML = `<div class="tt">Fork ${fork.toLocaleString()}</div>${rows}`;
    tip.hidden = false;
    const left = Math.min(box.width - 150, Math.max(0, e.clientX - box.left + 12));
    tip.style.left = `${left}px`;
    const g = svg.querySelector('#hover');
    g.setAttribute('visibility', 'visible');
    g.querySelector('line').setAttribute('x1', xs(fork)); g.querySelector('line').setAttribute('x2', xs(fork));
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; svg.querySelector('#hover')?.setAttribute('visibility', 'hidden'); });
}

const CANARY_SVG = (alive) => `<svg viewBox="0 0 32 28" aria-hidden="true">
  <path d="M5 17c0-6 5-10 11-10 3 0 5 1 6 3l5-1-3 3c1 5-3 10-9 10H9l-5 4 2-6c-1-1-1-2-1-3z" fill="${alive ? 'var(--canary)' : 'var(--dead)'}"/>
  ${alive ? '<circle cx="20" cy="12" r="1.4" fill="var(--bg)"/>' : '<path d="M18.5 10.5l3 3M21.5 10.5l-3 3" stroke="var(--bg)" stroke-width="1.3"/>'}
  <path d="M27 9l3-1-2 3z" fill="${alive ? 'var(--beak)' : 'var(--dead)'}"/></svg>`;

function renderCanaries(s) {
  $('canaries').innerHTML = ex.canaries.map((c) => {
    const want = c.expect === 'either' ? 'call it a coin flip' : `should ${c.expect}`;
    const got = `stay ${fmtPct(c.pStay)}, switch ${fmtPct(c.pSwitch)}`;
    const ev = c.knocked ? 'knock' : 'silence';
    return `<div class="canary${c.alive ? '' : ' dead'}" tabindex="0" title="${c.tribe}, ${ev}: ${want}. Apprentice says ${got}.">
      ${CANARY_SVG(c.alive)}<span>${c.tribe.replace('The ', '')}<br>${ev}</span></div>`;
  }).join('');
  $('canaryCount').textContent = `${s.canariesAlive} of ${s.canaries} alive`;
}

function renderMetrics(s) {
  const last = s.adaptation.at(-1);
  const adapt = !last ? 'no migration yet' : last.recoveredAfter === null ? `recovering, ${ex.world.forkCount - last.at} forks in` : `${last.recoveredAfter} forks`;
  $('metrics').innerHTML = [
    ['Calibration error', s.calibrationError.toFixed(3), 'When it says 70%, does it win 70% of the time? Lower is better.'],
    ['Weather sway', s.weatherSway.toFixed(3), 'How much its odds move if the same fork had another mine’s weather. Weather never matters, so this should shrink.'],
    ['Agrees with the Oracle', s.agreement === null ? '' : fmtPct(s.agreement), 'On the last 50 forks where the choice mattered.'],
    ['Recovery after migration', adapt, 'Forks until its regret is back to the level before the knockers moved.'],
  ].map(([k, v, h]) => `<div class="metric"><dt>${k}</dt><dd>${v}</dd><p>${h}</p></div>`).join('');
  $('params').textContent = ex.apprentice.parameterCount().toLocaleString();
}

function renderLedger() {
  const rows = ex.ledger.slice(-5).reverse().map((r) => {
    const src = r.source === 'drand' ? `drand round ${r.detail.round.toLocaleString()}` : r.source === 'local' ? 'browser crypto' : 'chained hash';
    return `<li><span>Region ${r.region + 1}</span><span>${src}</span><span>${r.site}</span><code>${r.seed.toString(16).padStart(8, '0')}</code></li>`;
  }).join('');
  $('ledger').innerHTML = rows;
  $('entropyStatus').textContent = well.status === 'live'
    ? 'Live: seeds come from the drand beacon mixed with the weather above eight real mines.'
    : 'This sandbox blocks live requests, so seeds come from your browser’s crypto and the weather is a recorded snapshot. Run it locally for the drand beacon and live weather.';
}

function renderPast() {
  $('past').innerHTML = ex.closed.slice(-14).reverse().map((p) => {
    const t = TRIBES[p.tribe];
    const ok = p.guess === p.tribe;
    return `<li title="${t.name} under ${p.site}. Oracle's last guess: ${TRIBES[p.guess].name}"><span class="pt">${t.name.replace('The ', '')}</span><span class="${ok ? 'ok' : 'miss'}">${ok ? 'named' : 'fooled'}</span></li>`;
  }).join('') || '<li class="empty">The first region is still open. Its knocker is named when the crew leaves.</li>';
}

// ---------- controls
function bindControls() {
  $('btnPause').addEventListener('click', () => {
    state.paused = !state.paused;
    $('btnPause').textContent = state.paused ? 'Resume' : 'Pause';
    $('btnPause').setAttribute('aria-pressed', String(state.paused));
  });
  document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.speed;
    state.turbo = v === 'turbo';
    state.speed = state.turbo ? 4 : Number(v);
    document.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (state.turbo && youResolve) { youResolve(null); youResolve = null; $('playAlong').hidden = true; }
  }));
  $('btnSound').addEventListener('click', () => {
    initAudio();
    audio.ctx.resume();
    state.sound = !state.sound;
    $('btnSound').textContent = state.sound ? 'Sound on' : 'Sound off';
    $('btnSound').setAttribute('aria-pressed', String(state.sound));
  });
  $('btnMigrate').addEventListener('click', () => {
    ex.migrateNow();
    narrate('The knockers have moved house. Every rock now hides a different spirit.');
    renderAll();
  });
  $('chkPlay').addEventListener('change', (e) => { state.playAlong = e.target.checked; });
  $('btnStay').addEventListener('click', () => { youResolve?.('stay'); youResolve = null; });
  $('btnSwitch').addEventListener('click', () => { youResolve?.('switch'); youResolve = null; });
  setInterval(() => { if (!state.paused && Math.random() < (cave?.weather.drip ?? 0.2)) dripSound(); }, 900);
}

function renderTribes() {
  $('tribes').innerHTML = TRIBES.map((t) => `<li><b>${t.name}</b> <span class="variant">${t.variant}</span><p>${t.rule}</p><p class="lesson">${t.lesson}</p></li>`).join('');
}

async function boot() {
  bindControls();
  bindChartHover();
  renderTribes();
  narrate('Listening for the beacon…');
  well = new EntropyWell();
  await well.start();
  ex = new Expedition({ weather: well.weather, seedSource: () => well.take() });
  cave = new Cave($('cave'));
  renderAll();
  const start = location.hash.slice(1);
  if (start === 'turbo') document.querySelector('[data-speed="turbo"]').click();
  if (start === 'play') $('chkPlay').click();
  const loop = () => { requestAnimationFrame(loop); try { cave.tick(); } catch (e) { console.error(e); } };
  requestAnimationFrame(loop);
  runLoop();
}

boot();
