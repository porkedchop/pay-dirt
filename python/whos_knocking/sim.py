# port of web/sim.js. same draws same floats, tests/golden.json checks it
from __future__ import annotations

from dataclasses import dataclass, field

GUIDE, SETTLING, TRICKSTER, WARDEN = 0, 1, 2, 3
TRIBE_NAMES = ["Tommy", "The Creaks", "The Joker", "Grandpa"]
STRATA_NAMES = ["Granite", "Killas", "Elvan", "Greenstone"]

DEFAULTS = dict(
    tribe_prior=(0.3, 0.3, 0.2, 0.2),
    cue_reliability=0.8,
    region_min=12,
    region_span=24,
    migrate_every=600,
)

M32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    return (a * b) & M32


def mulberry32(seed: int):
    a = seed & M32

    def nxt() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & M32
        t = _imul(a ^ (a >> 15), 1 | a)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return nxt


def fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = _imul(h, 0x01000193)
    return h & M32


def others_of(pick: int) -> list[int]:
    return [t for t in (0, 1, 2) if t != pick]


def knock(tribe: int, seam: int, pick: int, u: float):
    o = others_of(pick)
    coin = o[0 if u < 0.5 else 1]
    empty_other = o[1] if o[0] == seam else o[0]
    if tribe == GUIDE:
        return (coin if seam == pick else empty_other), False
    if tribe == SETTLING:
        return coin, coin == seam
    if tribe == TRICKSTER:
        return (coin, False) if seam == pick else (None, False)
    if tribe == WARDEN:
        return (None, False) if seam == pick else (empty_other, False)
    raise ValueError(tribe)


def switch_target(pick: int, k, switch_u: float) -> int:
    o = others_of(pick)
    if k is None:
        return o[0 if switch_u < 0.5 else 1]
    return o[1] if o[0] == k else o[0]


def likelihood(tribe: int, seam: int, pick: int, k, ring: bool) -> float:
    seam_picked = seam == pick
    if k is not None and k == pick:
        return 0.0
    if tribe == GUIDE:
        if ring or k is None:
            return 0.0
        return 0.5 if seam_picked else (1.0 if k != seam else 0.0)
    if tribe == SETTLING:
        if k is None:
            return 0.0
        return 0.5 if ring == (k == seam) else 0.0
    if tribe == TRICKSTER:
        if ring:
            return 0.0
        if seam_picked:
            return 0.5 if k is not None else 0.0
        return 1.0 if k is None else 0.0
    if tribe == WARDEN:
        if ring:
            return 0.0
        if seam_picked:
            return 1.0 if k is None else 0.0
        return 1.0 if (k is not None and k != seam) else 0.0
    return 0.0


def decide(belief, pick: int, k, ring: bool):
    stay = sw = z = 0.0
    post = [0.0, 0.0, 0.0, 0.0]
    for t in range(4):
        if belief[t] == 0:
            continue
        for s in range(3):
            w = belief[t] * (1 / 3) * likelihood(t, s, pick, k, ring)
            if w == 0:
                continue
            z += w
            post[t] += w
            if ring:
                continue
            if s == pick:
                stay += w
            elif k is None:
                sw += 0.5 * w
            else:
                sw += w
    if z == 0:
        return 0.0, 0.0, list(belief)
    return stay / z, sw / z, [p / z for p in post]


def reveal_update(belief, seam, pick, k, ring):
    post = [b * likelihood(t, seam, pick, k, ring) for t, b in enumerate(belief)]
    z = sum(post)
    return list(belief) if z == 0 else [p / z for p in post]


def one_hot(t: int):
    v = [0.0, 0.0, 0.0, 0.0]
    v[t] = 1.0
    return v


def strata_prior(strata: int, cue_map, cfg=DEFAULTS):
    r = cfg["cue_reliability"]
    p = [pt * ((r if cue_map[t] == strata else 0) + (1 - r) / 4) for t, pt in enumerate(cfg["tribe_prior"])]
    z = 0.0
    for x in p:
        z += x
    return [x / z for x in p]


def _sample_index(probs, u):
    acc = 0.0
    for i, p in enumerate(probs):
        acc += p
        if u < acc:
            return i
    return len(probs) - 1


@dataclass
class Region:
    index: int
    seed: int
    source: str
    rng: object
    tribe: int
    length: int
    strata: int
    forks_done: int = 0
    start_fork: int = 0


@dataclass
class Fork:
    index: int
    region: int
    tribe: int
    strata: int
    seam: int
    pick: int
    k: int | None
    ring: bool
    target: int
    stay_wins: bool
    switch_wins: bool
    true_stay: float
    true_switch: float


class World:
    def __init__(self, **cfg):
        self.cfg = {**DEFAULTS, **cfg}
        self.cue_map = [0, 1, 2, 3]
        self.fork_count = 0
        self.region_index = -1
        self.region: Region | None = None
        self.migrations: list[int] = []

    def migrate(self):
        self.cue_map = [(s + 1) % 4 for s in self.cue_map]
        self.migrations.append(self.fork_count)

    def begin_region(self, seed: int, source: str = "chained") -> Region:
        rng = mulberry32(seed)
        tribe = _sample_index(self.cfg["tribe_prior"], rng())
        length = self.cfg["region_min"] + int(rng() * self.cfg["region_span"])
        strata = self.cue_map[tribe] if rng() < self.cfg["cue_reliability"] else int(rng() * 4)
        self.region_index += 1
        self.region = Region(self.region_index, seed & M32, source, rng, tribe, length, strata, 0, self.fork_count)
        return self.region

    def needs_region(self) -> bool:
        return self.region is None or self.region.forks_done >= self.region.length

    def chained_seed(self) -> int:
        prev = self.region.seed if self.region else 0x9E3779B9
        return fnv1a(f"{prev}:{self.region_index + 1}")

    def next_fork(self) -> Fork:
        me = self.cfg["migrate_every"]
        if me > 0 and self.fork_count > 0 and self.fork_count % me == 0 and (not self.migrations or self.migrations[-1] != self.fork_count):
            self.migrate()
        if self.needs_region():
            raise RuntimeError("region exhausted: call begin_region first")
        R = self.region
        seam = int(R.rng() * 3)
        pick = int(R.rng() * 3)
        u = R.rng()
        switch_u = R.rng()
        k, ring = knock(R.tribe, seam, pick, u)
        target = switch_target(pick, k, switch_u)
        ts, tw, _ = decide(one_hot(R.tribe), pick, k, ring)
        f = Fork(self.fork_count, R.index, R.tribe, R.strata, seam, pick, k, ring, target,
                 (not ring) and seam == pick, (not ring) and target == seam, ts, tw)
        R.forks_done += 1
        self.fork_count += 1
        return f


class Oracle:
    def __init__(self, world: World):
        self.world = world
        self.belief = None

    def begin_region(self, R: Region):
        self.belief = strata_prior(R.strata, self.world.cue_map, self.world.cfg)

    def act(self, f: Fork):
        ps, pw, post = decide(self.belief, f.pick, f.k, f.ring)
        return ("switch" if pw > ps else "stay"), ps, pw

    def learn(self, f: Fork):
        self.belief = reveal_update(self.belief, f.seam, f.pick, f.k, f.ring)


def regret_of(f: Fork, action: str) -> float:
    best = max(f.true_stay, f.true_switch)
    return best - (f.true_switch if action == "switch" else f.true_stay)


def won(f: Fork, action: str) -> bool:
    return f.switch_wins if action == "switch" else f.stay_wins
