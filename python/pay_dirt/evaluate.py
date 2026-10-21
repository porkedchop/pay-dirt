# the continuous test as a cli. run a policy over many mines, report ore missed per 100 forks
# exits 1 if --max-regret is broken so it can gate ci
#   python -m pay_dirt.evaluate --policy bookworm --forks 3000 --seeds 5
#   python -m pay_dirt.evaluate --policy my_pkg.agents:MyAgent --max-regret 2
from __future__ import annotations

import argparse
import importlib
import json
import statistics
import sys

import numpy as np

from .env import KnockersEnv


class OldTimer:
    """cheats on purpose, copies the oracle. sets the ceiling"""

    def act(self, obs, env):
        return 1 if env.oracle.act(env.fork)[0] == "switch" else 0


class Bookworm:
    """the textbook answer. switch when knocked"""

    def act(self, obs, env):
        return 1 if obs[0] > 0.5 else 0


class Coin:
    def __init__(self):
        self.rng = np.random.default_rng(0)

    def act(self, obs, env):
        return int(self.rng.integers(2))


BUILTIN = {"oldtimer": OldTimer, "bookworm": Bookworm, "coin": Coin}


def load_policy(spec: str):
    if spec in BUILTIN:
        return BUILTIN[spec]()
    mod, _, attr = spec.partition(":")
    return getattr(importlib.import_module(mod), attr)()


def run(spec: str, forks: int, seed: int):
    env, policy = KnockersEnv(episode_forks=forks), load_policy(spec)
    obs, _ = env.reset(seed=seed)
    regrets, ore = [], 0.0
    for _ in range(forks):
        a = policy.act(obs, env)
        nxt, r, _, trunc, info = env.step(a)
        if hasattr(policy, "observe"):
            policy.observe(obs, a, r, info, nxt)
        regrets.append(info["regret"])
        ore += r
        obs = nxt
        if trunc:
            break
    return regrets, ore


def main(argv=None):
    ap = argparse.ArgumentParser(description="pay dirt evaluation")
    ap.add_argument("--policy", default="bookworm")
    ap.add_argument("--forks", type=int, default=3000)
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--max-regret", type=float, default=None, help="fail if ore missed per 100 over the last third is above this")
    args = ap.parse_args(argv)
    per_seed = []
    for s in range(args.seeds):
        regrets, ore = run(args.policy, args.forks, s)
        tail = regrets[-max(1, len(regrets) // 3):]
        per_seed.append({"seed": s, "win_rate": ore / len(regrets), "missed_per_100": 100 * sum(regrets) / len(regrets),
                         "late_missed_per_100": 100 * sum(tail) / len(tail)})
    late = [p["late_missed_per_100"] for p in per_seed]
    report = {"policy": args.policy, "forks": args.forks, "seeds": args.seeds,
              "late_missed_per_100": {"mean": statistics.mean(late), "max": max(late)},
              "win_rate": statistics.mean(p["win_rate"] for p in per_seed), "per_seed": per_seed}
    print(json.dumps(report, indent=2))
    if args.max_regret is not None and report["late_missed_per_100"]["mean"] > args.max_regret:
        print(f"FAIL: late missed {report['late_missed_per_100']['mean']:.2f} > {args.max_regret}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
