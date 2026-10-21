// decision log. one row per fork, every miner's call + what happened
// browser keeps it in indexeddb (survives reloads, stays on this device). node writes the same rows as jsonl

import { regretOf, won } from './sim.js';

const DB = 'pay-dirt', STORE = 'forks', KEEP = 200000;
const NAMES = { Oracle: 'oldTimer', Apprentice: 'rookie', Parrot: 'bookworm' };
const r4 = (x) => (x === null || x === undefined ? null : Math.round(x * 1e4) / 1e4);

export function rowFor(ex, { f, calls }, run) {
  const led = ex.ledger.at(-1);
  const row = {
    run, at: new Date().toISOString(), fork: f.index, region: f.region, spirit: f.spirit,
    seed: led.seed, seedFrom: led.source,
    pick: f.pick, knock: f.k, buried: f.ring, ore: f.ore,
    stayWins: f.stayWins, switchWins: f.switchWins, trueStay: r4(f.trueStay), trueSwitch: r4(f.trueSwitch),
    calls: {},
  };
  for (const [name, c] of Object.entries(calls)) {
    row.calls[NAMES[name]] = { move: c.action, pStay: r4(c.pStay), pSwitch: r4(c.pSwitch), hit: won(f, c.action), missed: r4(regretOf(f, c.action)) };
  }
  return row;
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class DecisionLog {
  constructor() {
    this.run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.recent = []; this.pending = []; this.thisRun = 0; this.stored = 0; this.db = null;
  }

  async open() {
    try {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, { autoIncrement: true });
      // never hold up the page for storage. if it isnt open in 1.5s, keep picks in memory
      this.db = await Promise.race([req(open), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 1500))]);
      this.stored = await req(this.db.transaction(STORE).objectStore(STORE).count());
    } catch {
      this.db = null; // private window or blocked storage. still works in memory
    }
    return this;
  }

  add(row) {
    this.recent.push(row);
    if (this.recent.length > 500) this.recent.shift();
    this.thisRun += 1;
    if (!this.db) return;
    this.pending.push(row);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 1500);
  }

  flush() {
    this.timer = null;
    if (!this.db || !this.pending.length) return;
    const batch = this.pending.splice(0);
    try {
      const tx = this.db.transaction(STORE, 'readwrite');
      for (const r of batch) tx.objectStore(STORE).add(r);
      tx.oncomplete = () => { this.stored += batch.length; if (this.stored > KEEP * 1.1) this.prune(); };
    } catch { /* quota or closed, keep going in memory */ }
  }

  prune() {
    let drop = this.stored - KEEP;
    const cur = this.db.transaction(STORE, 'readwrite').objectStore(STORE).openCursor();
    cur.onsuccess = () => { const c = cur.result; if (c && drop-- > 0) { c.delete(); c.continue(); } else this.stored = KEEP; };
  }

  async all() {
    if (!this.db) return this.recent.slice();
    this.flush();
    try { return await req(this.db.transaction(STORE).objectStore(STORE).getAll()); } catch { return this.recent.slice(); }
  }

  async clear() {
    this.recent = []; this.pending = []; this.stored = 0;
    if (this.db) try { await req(this.db.transaction(STORE, 'readwrite').objectStore(STORE).clear()); } catch { /* ignore */ }
  }
}
