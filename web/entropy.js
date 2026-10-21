// where the randomness comes from. lavarand idea: hash a chaotic physical thing into a seed
// drand = public verifiable beacon (league of entropy, cloudflare runs a node)
// weather above real mines = the lava lamp. both free, no keys
// sha-256 flattens them to uniform bits so the monty hall odds stay exact
// every seed is logged with its round so anyone can replay or audit the run

import { SITES, RECORDED_WEATHER } from './expedition.js';

const QUICKNET = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const DRAND_HOSTS = ['https://drand.cloudflare.com', 'https://api.drand.sh'];

async function fetchJson(url, ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

export async function latestBeacon() {
  for (const host of DRAND_HOSTS) {
    try {
      const b = await fetchJson(`${host}/${QUICKNET}/public/latest`);
      return { round: b.round, randomness: b.randomness, host };
    } catch { /* next host */ }
  }
  return null;
}

export async function liveWeather() {
  const lat = SITES.map((s) => s.lat).join(',');
  const lon = SITES.map((s) => s.lon).join(',');
  const vars = 'temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m,surface_pressure';
  try {
    const d = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=${vars}`, 6000);
    return (Array.isArray(d) ? d : [d]).map((x) => ({ ...x.current, recorded: null, time: x.current.time }));
  } catch {
    return null;
  }
}

async function sha256Seed(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
}

function localSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] >>> 0;
}

// keeps a small queue of fresh seeds. expedition pulls one per region, sync
// if the queue is empty the world chains from its last seed, never blocks
export class EntropyWell {
  constructor() {
    this.queue = [];
    this.weather = RECORDED_WEATHER;
    this.weatherLive = false;
    this.beaconLive = false;
    this.lastBeacon = null;
    this.status = 'starting';
  }

  async start() {
    const [wx, beacon] = await Promise.all([liveWeather(), latestBeacon()]);
    if (wx && wx.length === SITES.length) { this.weather = wx; this.weatherLive = true; }
    await this.mint(beacon);
    this.status = this.beaconLive ? 'live' : 'local';
    if (this.beaconLive) this.timer = setInterval(() => this.refill(), 15000);
    return this;
  }

  async refill() {
    if (this.queue.length >= 4) return;
    await this.mint(await latestBeacon());
  }

  async mint(beacon) {
    const wxText = JSON.stringify(this.weather.map((w) => [w.temperature_2m, w.precipitation, w.wind_speed_10m, w.surface_pressure]));
    if (beacon) {
      this.beaconLive = true;
      if (this.lastBeacon && beacon.round === this.lastBeacon.round) return;
      this.lastBeacon = beacon;
      const seed = await sha256Seed(`${beacon.randomness}|${beacon.round}|${wxText}`);
      this.queue.push({ seed, source: 'drand', detail: { round: beacon.round, host: beacon.host } });
    } else {
      const salt = localSeed();
      const seed = await sha256Seed(`${salt}|${wxText}`);
      this.queue.push({ seed, source: 'local', detail: { salt } });
    }
  }

  // sync for the expedition
  take() {
    const s = this.queue.shift() || null;
    if (this.queue.length < 2) this.refill();
    return s;
  }
}
