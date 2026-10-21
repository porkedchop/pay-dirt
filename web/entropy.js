// the randomness comes from real weather. same idea as cloudflare's wall of lava lamps
// one free open-meteo call (no key) gets the weather in all the mining towns right now, refreshed every 15 min
// each part of the mine takes the next town, hashes that town's reading with sha-256, and that's the seed

import { TOWNS, SAVED_WEATHER } from './expedition.js';

const VARS = 'temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m';
export const WEATHER_URL = `https://api.open-meteo.com/v1/forecast?latitude=${TOWNS.map((t) => t.lat).join(',')}&longitude=${TOWNS.map((t) => t.lon).join(',')}&current=${VARS}`;
const EVERY = 15 * 60 * 1000;

async function sha256Seed(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
}

export class WeatherDice {
  constructor() {
    this.weather = SAVED_WEATHER.map((w) => ({ ...w }));
    this.live = false;
    this.calls = []; // every request, newest first
    this.rolls = []; // every seed made, newest first
    this.queue = [];
    this.n = 0;
    this.salt = '';
    this.nextCheck = null;
  }

  async fetchWeather() {
    const call = { url: WEATHER_URL, at: new Date(), status: null, ms: null, ok: false };
    this.calls.unshift(call);
    if (this.calls.length > 12) this.calls.pop();
    const t0 = performance.now();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(WEATHER_URL, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(timer);
      call.status = r.status;
      const j = await r.json();
      const rows = Array.isArray(j) ? j : [j];
      call.ok = r.ok && rows.length === TOWNS.length;
      if (call.ok) { rows.forEach((x, i) => Object.assign(this.weather[i], x.current, { saved: false })); this.live = true; }
    } catch {
      call.status = 'blocked';
    }
    call.ms = Math.round(performance.now() - t0);
  }

  async start() {
    await this.fetchWeather();
    // couldnt reach the api: the saved reading never changes, so mix in the browser's own randomness
    if (!this.live) { const a = new Uint32Array(1); crypto.getRandomValues(a); this.salt = `|browser ${a[0]}`; }
    await this.refill();
    if (this.live) {
      this.nextCheck = Date.now() + EVERY;
      setInterval(async () => { this.nextCheck = Date.now() + EVERY; await this.fetchWeather(); }, EVERY);
    }
    return this;
  }

  reading(i) {
    const w = this.weather[i];
    return `${TOWNS[i].city}|${w.time}|${w.temperature_2m}|${w.precipitation}|${w.wind_speed_10m}|${w.relative_humidity_2m}`;
  }

  async refill() {
    if (this.filling) return;
    this.filling = true;
    while (this.queue.length < 3) {
      const town = this.n % TOWNS.length;
      const input = `${this.reading(town)}${this.salt}|part ${this.n + 1}`;
      const seed = await sha256Seed(input);
      this.queue.push({ seed, town, source: this.live ? 'live weather' : 'saved weather' });
      this.rolls.unshift({ input, seed, town });
      if (this.rolls.length > 6) this.rolls.pop();
      this.n += 1;
    }
    this.filling = false;
  }

  // sync for the expedition. if empty it chains from the last seed, never waits
  take() {
    const s = this.queue.shift() || null;
    this.refill();
    return s;
  }
}
