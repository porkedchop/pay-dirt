# gymnasium env. one step = one fork. bring any agent (sb3, cleanrl, your own)
# obs matches web/apprentice.js encode() so a policy trained here sees what the rookie sees
from __future__ import annotations

import numpy as np
import gymnasium as gym
from gymnasium import spaces

from .sim import World, Oracle, fnv1a, regret_of, won

WINDOW = 16
KNOCK_HIT, KNOCK_MISS, BURIED, SILENT = 0, 1, 2, 3
N_INPUT = 2 + 4 + 1


def event_kind(f) -> int:
    if f.k is None:
        return SILENT
    if f.ring:
        return BURIED
    return KNOCK_HIT if f.ore == f.pick else KNOCK_MISS


def encode(knocked: bool, buried: bool, history) -> np.ndarray:
    x = np.zeros(N_INPUT, dtype=np.float32)
    x[0] = 1.0 if knocked else 0.0
    x[1] = 1.0 if buried else 0.0
    seen = history[-WINDOW:]
    for e in seen:
        x[2 + e] += 1 / WINDOW
    x[6] = len(seen) / WINDOW
    return x


class KnockersEnv(gym.Env):
    """stay (0) or switch (1) at each fork. reward 1 for ore. info has regret vs knowing the spirit"""

    metadata = {"render_modes": []}

    def __init__(self, episode_forks: int = 1000):
        self.episode_forks = episode_forks
        self.observation_space = spaces.Box(0.0, 1.0, shape=(N_INPUT,), dtype=np.float32)
        self.action_space = spaces.Discrete(2)

    def _next(self):
        if self.world.needs_region():
            seed = self._first if self._first is not None else self.world.chained_seed()
            self._first = None
            self.oracle.begin_region(self.world.begin_region(seed))
            self.history = []
        self.fork = self.world.next_fork()
        return encode(self.fork.k is not None, self.fork.ring, self.history)

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self.world = World()
        self.oracle = Oracle(self.world)
        self._first = fnv1a(f"reset:{seed}") if seed is not None else None  # same seed same mine
        self.t = 0
        return self._next(), {"fork": 0}

    def step(self, action):
        f = self.fork
        act = "switch" if int(action) == 1 else "stay"
        o_act, _, _ = self.oracle.act(f)
        info = {"fork": f.index, "region": f.region, "regret": regret_of(f, act), "oracle_action": o_act,
                "stay_wins": f.stay_wins, "switch_wins": f.switch_wins,
                # privileged, for analysis only. a fair agent never reads these
                "spirit": f.spirit, "true_stay": f.true_stay, "true_switch": f.true_switch}
        reward = 1.0 if won(f, act) else 0.0
        self.oracle.learn(f)
        self.history.append(event_kind(f))
        self.t += 1
        return self._next(), reward, False, self.t >= self.episode_forks, info
