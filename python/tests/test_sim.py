import json
from pathlib import Path

import numpy as np

from pay_dirt.sim import World, Oracle, mulberry32, fnv1a, decide, one_hot, TOMMY, JOKER
from pay_dirt.env import KnockersEnv, N_INPUT
from pay_dirt.evaluate import main as evaluate

GOLDEN = json.loads((Path(__file__).parents[2] / "tests" / "golden.json").read_text())


def test_rng_matches_js_bit_for_bit():
    r = mulberry32(12345)
    assert [r() for _ in range(8)] == GOLDEN["draws"]
    assert fnv1a("2654435769:0") == GOLDEN["fnv"]


def test_world_and_old_timer_match_js_trace():
    w = World()
    o = Oracle(w)
    for g in GOLDEN["forks"]:
        if w.needs_region():
            o.begin_region(w.begin_region(w.chained_seed()))
        f = w.next_fork()
        _, ps, pw = o.act(f)
        got = dict(seed=w.region.seed, spirit=f.spirit, ore=f.ore, pick=f.pick, k=f.k, ring=f.ring, target=f.target)
        assert got == {k: g[k] for k in got}, f.index
        for a, b in [(f.true_stay, g["trueStay"]), (f.true_switch, g["trueSwitch"]), (ps, g["oldStay"]), (pw, g["oldSwitch"])]:
            assert abs(a - b) < 1e-12, f.index
        o.learn(f)


def test_monty_hall_numbers():
    assert abs(decide(one_hot(TOMMY), 0, 1, False)[1] - 2 / 3) < 1e-12
    assert decide(one_hot(JOKER), 0, 1, False)[0] == 1.0


def test_env_contract():
    env = KnockersEnv(episode_forks=50)
    obs, _ = env.reset(seed=3)
    assert obs.shape == (N_INPUT,) and env.observation_space.contains(obs)
    for _ in range(50):
        obs, r, term, trunc, info = env.step(env.action_space.sample())
        assert 0 <= info["regret"] <= 1
    assert trunc
    assert np.array_equal(KnockersEnv().reset(seed=3)[0], KnockersEnv().reset(seed=3)[0])


def test_gate_separates_old_timer_from_bookworm():
    assert evaluate(["--policy", "oldtimer", "--forks", "1500", "--seeds", "2", "--max-regret", "1"]) == 0
    assert evaluate(["--policy", "bookworm", "--forks", "1500", "--seeds", "2", "--max-regret", "5"]) == 1
