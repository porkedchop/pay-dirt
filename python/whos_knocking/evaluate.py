# continuous test as a cli. runs a policy over many caves and seeds, reports the same checks as the live screen
# exits 1 if --max-regret is broken so it can gate ci
#   python -m whos_knocking.evaluate --policy parrot --forks 3000 --seeds 5
#   python -m whos_knocking.evaluate --policy mypkg.agents:MyAgent --max-regret 3
from __future__ import annotations

import argparse
import importlib
import json
import statistics
import sys

import numpy as np

from .env import KnockersEnv


class OraclePolicy:
    """cheats on purpose. reads the oracle action from info, sets the ceiling"""
    name = "oracle"

    def __init__(self):
        self.next_action = 0

    def act(self, obs):
        return self.next_action

    def observe(self, obs, action, reward, info, next_obs):
        pass


class ParrotPolicy:
    """the textbook answer. switch when knocked"""
    name = "parrot"

    def act(self, obs):
        return 1 if obs[0] > 0.5 else 0

    def observe(self, *a):
        pass


class RandomPolicy:
    name = "random"

    def __init__(self, seed=0):
        self.rng = np.random.default_rng(seed)

    def act(self, obs):
        return int(self.rng.integers(2))

    def observe(self, *a):
        pass


BUILTIN = {"oracle": OraclePolicy, "parrot": ParrotPolicy, "random": RandomPolicy}


def load_policy(spec: str):
    if spec in BUILTIN:
        return BUILTIN[spec]()
    mod, _, attr = spec.partition(":")
    return getattr(importlib.import_module(mod), attr)()


def run(policy_spec: str, forks: int, seed: int, migrate_every: int):
    env = KnockersEnv(episode_forks=forks, migrate_every=migrate_every)
    policy = load_policy(policy_spec)
    obs, info = env.reset(seed=seed)
    regrets, ore = [], 0.0
    oracle_peek = isinstance(policy, OraclePolicy)
    for _ in range(forks):
        if oracle_peek:
            act, _, _ = env.oracle.act(env.fork)
            policy.next_action = 1 if act == "switch" else 0
        a = policy.act(obs)
        nxt, r, term, trunc, info = env.step(a)
        policy.observe(obs, a, r, info, nxt)
        regrets.append(info["regret"])
        ore += r
        obs = nxt
        if term or trunc:
            break
    migrations = info["migrations"]
    return regrets, ore, migrations


def recovery(regrets, migrations, window=100):
    out = []
    r = np.asarray(regrets)
    for m in migrations:
        if m < window or m + window > len(r):
            continue
        before = r[m - window:m].mean()
        rec = None
        for t in range(m + window, len(r) + 1):
            if r[t - window:t].mean() <= before * 1.1 + 0.005:
                rec = t - m
                break
        out.append({"at": int(m), "recovered_after": rec})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="who's knocking continuous evaluation")
    ap.add_argument("--policy", default="parrot")
    ap.add_argument("--forks", type=int, default=3000)
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--migrate-every", type=int, default=1000)
    ap.add_argument("--max-regret", type=float, default=None, help="fail if regret per 100 forks over the last third exceeds this")
    args = ap.parse_args(argv)

    per_seed = []
    for s in range(args.seeds):
        regrets, ore, migs = run(args.policy, args.forks, s, args.migrate_every)
        tail = regrets[-max(1, len(regrets) // 3):]
        per_seed.append({
            "seed": s, "ore": ore, "win_rate": ore / len(regrets),
            "regret_per_100": 100 * sum(regrets) / len(regrets),
            "late_regret_per_100": 100 * sum(tail) / len(tail),
            "recovery": recovery(regrets, migs),
        })
    late = [p["late_regret_per_100"] for p in per_seed]
    report = {
        "policy": args.policy, "forks": args.forks, "seeds": args.seeds,
        "late_regret_per_100": {"mean": statistics.mean(late), "max": max(late)},
        "win_rate": statistics.mean(p["win_rate"] for p in per_seed),
        "per_seed": per_seed,
    }
    print(json.dumps(report, indent=2))
    if args.max_regret is not None and report["late_regret_per_100"]["mean"] > args.max_regret:
        print(f"FAIL: late regret {report['late_regret_per_100']['mean']:.2f} > {args.max_regret}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
