# gymnasium env. one step = one fork. bring any agent (sb3, cleanrl, your own)
# obs matches web/apprentice.js encode() so a policy trained here could run in the browser
from __future__ import annotations

import numpy as np
import gymnasium as gym
from gymnasium import spaces

from .sim import World, Oracle, fnv1a, regret_of, won

WINDOW = 16
EVENT_KINDS = 5
N_INPUT = 6 + 3 + EVENT_KINDS + 1

# open-meteo snapshot 2026-10-21 00:15 utc, same order as SITES in web/expedition.js
SITE_NAMES = ["Botallack", "Kiruna", "Cerro Rico", "Super Pit", "Berkeley Pit", "Wieliczka", "Chuquicamata", "Falun"]
RECORDED_WEATHER = [
    (10.9, 0.2, 36.4), (0.5, 0.0, 9.4), (4.7, 0.0, 9.4), (24.0, 0.0, 20.1),
    (14.6, 0.0, 3.9), (7.3, 0.0, 2.5), (13.2, 0.0, 5.0), (4.4, 0.0, 8.6),
]


def weather_features(temp, precip, wind):
    return [float(np.tanh((temp - 10) / 12)), float(np.tanh(precip / 2) * 2 - 1), float(np.tanh((wind - 15) / 15))]


def event_kind(f) -> int:
    if f.k is None:
        return 3 if f.seam == f.pick else 4
    if f.ring:
        return 2
    return 0 if f.seam == f.pick else 1


def encode(k, ring, strata, weather, history) -> np.ndarray:
    x = np.zeros(N_INPUT, dtype=np.float32)
    x[0] = 1.0 if k is not None else 0.0
    x[1] = 1.0 if ring else 0.0
    if strata is not None:
        x[2 + strata] = 1.0
    x[6:9] = weather
    seen = history[-WINDOW:]
    for e in seen:
        x[9 + e] += 1 / WINDOW
    x[9 + EVENT_KINDS] = len(seen) / WINDOW
    return x


class KnockersEnv(gym.Env):
    """stay (0) or switch (1) at each fork. reward 1 for ore. info has regret vs perfect knowledge"""

    metadata = {"render_modes": []}

    def __init__(self, episode_forks: int = 1000, migrate_every: int = 600, weather=RECORDED_WEATHER):
        self.episode_forks = episode_forks
        self.migrate_every = migrate_every
        self.weather = weather
        self.observation_space = spaces.Box(-1.0, 1.0, shape=(N_INPUT,), dtype=np.float32)
        self.action_space = spaces.Discrete(2)

    def _begin_region(self):
        seed = self._first_seed if self._first_seed is not None else self.world.chained_seed()
        self._first_seed = None
        R = self.world.begin_region(seed)
        self.site = fnv1a(f"site:{seed}") % len(self.weather)
        self.wx = weather_features(*self.weather[self.site])
        self.history = []
        self.oracle.begin_region(R)

    def _next(self):
        if self.world.needs_region():
            self._begin_region()
        self.fork = self.world.next_fork()
        f = self.fork
        return encode(f.k, f.ring, f.strata, self.wx, self.history)

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self.world = World(migrate_every=self.migrate_every)
        self.oracle = Oracle(self.world)
        # seed moves the start of the seed chain. same seed same caves
        self._first_seed = fnv1a(f"reset:{seed}") if seed is not None else None
        self.t = 0
        return self._next(), self._info()

    def _info(self, f=None):
        f = f or self.fork
        return {"fork": f.index, "region": f.region, "site": SITE_NAMES[self.site % len(SITE_NAMES)],
                "migrations": list(self.world.migrations)}

    def step(self, action):
        f = self.fork
        act = "switch" if int(action) == 1 else "stay"
        o_act, _, _ = self.oracle.act(f)
        reward = 1.0 if won(f, act) else 0.0
        info = self._info(f)
        info.update(regret=regret_of(f, act), oracle_action=o_act, oracle_regret=regret_of(f, o_act),
                    stay_wins=f.stay_wins, switch_wins=f.switch_wins,
                    # privileged, for analysis only. a fair agent never reads these
                    tribe=f.tribe, true_stay=f.true_stay, true_switch=f.true_switch)
        self.oracle.learn(f)
        self.history.append(event_kind(f))
        self.t += 1
        truncated = self.t >= self.episode_forks
        obs = self._next()
        return obs, reward, False, truncated, info
