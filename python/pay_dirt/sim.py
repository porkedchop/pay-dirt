# port of web/sim.js. same draws same floats, tests/golden.json checks it
from __future__ import annotations

from dataclasses import dataclass

TOMMY, CREAKS, JOKER = 0, 1, 2
SPIRIT_NAMES = ["The Foreman", "Loose Fuse", "The Joker"]
DEFAULTS = dict(prior=(0.4, 0.3, 0.3), region_min=12, region_span=20)
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


def knock(spirit: int, ore: int, pick: int, u: float):
    o = others_of(pick)
    coin = o[0 if u < 0.5 else 1]
    empty_other = o[1] if o[0] == ore else o[0]
    if spirit == TOMMY:
        return (coin if ore == pick else empty_other), False
    if spirit == CREAKS:
        return coin, coin == ore
    return (coin, False) if ore == pick else (None, False)


def switch_target(pick: int, k, switch_u: float) -> int:
    o = others_of(pick)
    if k is None:
        return o[0 if switch_u < 0.5 else 1]
    return o[1] if o[0] == k else o[0]


def likelihood(spirit: int, ore: int, pick: int, k, ring: bool) -> float:
    if k is not None and k == pick:
        return 0.0
    ore_picked = ore == pick
    if spirit == TOMMY:
        if ring or k is None:
            return 0.0
        return 0.5 if ore_picked else (1.0 if k != ore else 0.0)
    if spirit == CREAKS:
        if k is None:
            return 0.0
        return 0.5 if ring == (k == ore) else 0.0
    if ring:
        return 0.0
    if ore_picked:
        return 0.5 if k is not None else 0.0
    return 1.0 if k is None else 0.0


def decide(belief, pick: int, k, ring: bool):
    stay = sw = z = 0.0
    post = [0.0] * len(belief)
    for t in range(len(belief)):
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


def reveal_update(belief, ore, pick, k, ring):
    post = [b * likelihood(t, ore, pick, k, ring) for t, b in enumerate(belief)]
    z = 0.0
    for p in post:
        z += p
    return list(belief) if z == 0 else [p / z for p in post]


def one_hot(t: int):
    return [1.0 if i == t else 0.0 for i in range(len(SPIRIT_NAMES))]


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
    spirit: int
    length: int
    forks_done: int = 0


@dataclass
class Fork:
    index: int
    region: int
    spirit: int
    ore: int
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
        self.fork_count = 0
        self.region_index = -1
        self.region: Region | None = None

    def begin_region(self, seed: int, source: str = "chained") -> Region:
        rng = mulberry32(seed)
        spirit = _sample_index(self.cfg["prior"], rng())
        length = self.cfg["region_min"] + int(rng() * self.cfg["region_span"])
        self.region_index += 1
        self.region = Region(self.region_index, seed & M32, source, rng, spirit, length)
        return self.region

    def needs_region(self) -> bool:
        return self.region is None or self.region.forks_done >= self.region.length

    def chained_seed(self) -> int:
        prev = self.region.seed if self.region else 0x9E3779B9
        return fnv1a(f"{prev}:{self.region_index + 1}")

    def next_fork(self) -> Fork:
        if self.needs_region():
            raise RuntimeError("region over: call begin_region first")
        R = self.region
        ore = int(R.rng() * 3)
        pick = int(R.rng() * 3)
        u = R.rng()
        switch_u = R.rng()
        k, ring = knock(R.spirit, ore, pick, u)
        target = switch_target(pick, k, switch_u)
        ts, tw, _ = decide(one_hot(R.spirit), pick, k, ring)
        f = Fork(self.fork_count, R.index, R.spirit, ore, pick, k, ring, target,
                 (not ring) and ore == pick, (not ring) and target == ore, ts, tw)
        R.forks_done += 1
        self.fork_count += 1
        return f


class Oracle:
    """old timer. knows the three habits, never which spirit is here"""

    def __init__(self, world: World):
        self.world = world
        self.belief = None

    def begin_region(self, R: Region):
        self.belief = list(self.world.cfg["prior"])

    def act(self, f: Fork):
        ps, pw, _ = decide(self.belief, f.pick, f.k, f.ring)
        return ("switch" if pw > ps else "stay"), ps, pw

    def learn(self, f: Fork):
        self.belief = reveal_update(self.belief, f.ore, f.pick, f.k, f.ring)


def regret_of(f: Fork, action: str) -> float:
    return max(f.true_stay, f.true_switch) - (f.true_switch if action == "switch" else f.true_stay)


def won(f: Fork, action: str) -> bool:
    return f.switch_wins if action == "switch" else f.stay_wins
