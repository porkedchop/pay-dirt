import json
from pathlib import Path

import numpy as np

from whos_knocking.sim import World, Oracle, mulberry32, fnv1a, decide, one_hot, GUIDE, TRICKSTER
from whos_knocking.env import KnockersEnv, N_INPUT
from whos_knocking.evaluate import main as evaluate

GOLDEN = json.loads((Path(__file__).parents[2] / "tests" / "golden.json").read_text())


def test_rng_matches_js_bit_for_bit():
    r = mulberry32(12345)
    assert [r() for _ in range(8)] == GOLDEN["draws"]
    assert [fnv1a("site:1"), fnv1a("2654435769:0")] == GOLDEN["fnv"]


def test_world_and_oracle_match_js_trace():
    w = World(migrate_every=150)
    o = Oracle(w)
    for g in GOLDEN["forks"]:
        if w.needs_region():
            o.begin_region(w.begin_region(w.chained_seed()))
        f = w.next_fork()
        _, ps, pw = o.act(f)
        got = dict(seed=w.region.seed, tribe=f.tribe, strata=f.strata, seam=f.seam, pick=f.pick, k=f.k, ring=f.ring, target=f.target)
        assert got == {k: g[k] for k in got}, f.index
        for a, b in [(f.true_stay, g["trueStay"]), (f.true_switch, g["trueSwitch"]), (ps, g["oracleStay"]), (pw, g["oracleSwitch"])]:
            assert abs(a - b) < 1e-12, f.index
        o.learn(f)
    assert w.migrations == GOLDEN["migrations"]


def test_monty_hall_numbers():
    ps, pw, _ = decide(one_hot(GUIDE), 0, 1, False)
    assert abs(pw - 2 / 3) < 1e-12
    ps, pw, _ = decide(one_hot(TRICKSTER), 0, 1, False)
    assert ps == 1.0


def test_env_contract():
    env = KnockersEnv(episode_forks=50)
    obs, _ = env.reset(seed=3)
    assert obs.shape == (N_INPUT,) and env.observation_space.contains(obs)
    total = 0
    for _ in range(50):
        obs, r, term, trunc, info = env.step(env.action_space.sample())
        assert 0 <= info["regret"] <= 1
        total += r
    assert trunc
    a, _ = KnockersEnv().reset(seed=3)
    b, _ = KnockersEnv().reset(seed=3)
    assert np.array_equal(a, b)


def test_gate_separates_oracle_from_parrot():
    assert evaluate(["--policy", "oracle", "--forks", "1500", "--seeds", "2", "--max-regret", "1"]) == 0
    assert evaluate(["--policy", "parrot", "--forks", "1500", "--seeds", "2", "--max-regret", "5"]) == 1
