# Who's Knocking

An AI miner learns the Monty Hall problem the way it actually works: by figuring out **who opened the door**.

![The live screen: a miner at a three tunnel fork, with the scoreboard, canaries and Old Timer's guess](docs/screenshot.png)

Everyone knows the answer to Monty Hall: always switch. But that answer is only right because the host **knows** where the car is and never opens it. If the host opens a door at random, switching is a coin flip. If the host only offers a switch when you already picked the car, switching always loses. Same open door, opposite meaning.

That is the whole problem of machine learning in one game show. Data does not tell you what it means. **The process that produced it does.**

## The scenario

Old Cornish tin miners swore there were *knockers* in the mines: spirits that knocked on the walls. Some knocked to lead you to ore. Some knocked to warn you off a bad tunnel. Some just messed with you. And the skeptics said it was only creaky timbers.

Those four stories are four different Monty Halls.

| Knocker | Which Monty | When it knocks | Right move |
|---|---|---|---|
| **Tommy** | the classic | Knows where the ore is. Always knocks an empty tunnel you didn't pick. | Switch (wins 2 in 3) |
| **The Creaks** | Monty slipped | Old timbers settling at random, sometimes right on the ore. | Coin flip |
| **The Joker** | evil Monty | Only when you already picked right, hoping you'll bail. | Stay on a knock, switch on silence |
| **Grandpa** | angel Monty | Only when you picked wrong, to steer you off it. | Switch on a knock, stay on silence. Never misses. |

The mine is split into regions. Each region is one kind of rock with one knocker haunting it, and nobody is told which. At every fork the crew draws lots for a tunnel, then a knock comes (or doesn't), and every miner decides: stay or switch.

### The miners

All of them stand at **the same fork, with the same first pick and the same knock**. Only the next move differs, so the gap between them is skill, not luck.

- **Old Timer**: knows every spirit's habits, just not which one lives in this rock. Does the math perfectly (exact Bayes). The best anyone can do.
- **Rookie**: the AI. A tiny neural network (710 numbers) that starts knowing nothing. Nobody tells it the rules or the spirits' names. It sees what happened at recent forks, the rock, and the weather, and learns from where the ore turns out to be.
- **Bookworm**: always switches when it hears a knock. The answer it read in a book. Basically an AI that memorized the famous puzzle instead of thinking about it.
- **You**: tick *Play along* and make the call yourself.

In the code these are `Oracle`, `Apprentice` and `Parrot`.

## How we know it's actually learning

We built the world, so we always know the right answer at every fork. Every fork is a free test question, live, forever.

| Check | What it catches |
|---|---|
| **Ore left on the table** | Ore lost versus someone who knew exactly which spirit was knocking. Uses the exact odds, so luck doesn't muddy it. Flat line means learned. |
| **Canaries** | Six pop quizzes every ten forks that the Rookie never studies for. Each is a pattern only one spirit could make. Named after the birds miners carried underground. |
| **Gut check** | When it feels 70% sure, does it hit 70% of the time? |
| **Distracted by weather** | Replay the same fork under every other mine's weather. Weather never matters, so this should drop to zero. |
| **Bounce back** | Every so often the knockers move to different rocks, so the rock it learned to trust now points the wrong way. How many forks until it gets its game back? |
| **CI gates** | `npm test` double checks the network's math and fails if the Rookie stops learning. `pytest` checks the Python port bit for bit. `python -m whos_knocking.evaluate --max-regret` gates any agent. |

### What it has shown so far

Measured headless, 8,000 forks, knockers moving every 2,500:

| Forks | Rookie, ore missed per 100 | Bookworm | Old Timer |
|---|---|---|---|
| 500 | 7.48 | 13.93 | 0.20 |
| 1,000 | 0.53 | 10.90 | 0.00 |
| 2,000 | 0.07 | 11.80 | 0.00 |
| 4,000 (after a move) | 1.50 | 9.80 | 0.07 |
| 8,000 | 0.97 | 14.20 | 0.10 |

It bounced back from each move in 196 to 300 forks.

Two lessons came out of building the tests, and both are real ML lessons:

1. **Check your quiz before you grade the student.** The first pop quizzes left out the rock and the weather, which never happens in a real fork. Two of six canaries kept "dying" for reasons that had nothing to do with whether the Rookie understood the spirits. Asking each quiz under every rock and every real mine's weather fixed it. Every canary now survives 93% to 100% of the time.
2. **The Rookie does get distracted by the weather.** Changing only the weather moved its answer. Rain over a mine in Bolivia has nothing to do with spirits in the rock, but the network found a pattern there anyway. That's why it's on the live screen.

## Where the randomness comes from

Cloudflare keeps a wall of lava lamps in its lobby and hashes photos of it into random numbers. Same idea here, with free public sources:

- **drand**, the public randomness beacon run by the League of Entropy (Cloudflare runs a node). A new verifiable random value every 3 seconds.
- **The live weather above eight historic mines** (Botallack, Kiruna, Cerro Rico, Kalgoorlie, Butte, Wieliczka, Chuquicamata, Falun) from Open-Meteo.

Each region is rolled from a SHA-256 hash of the beacon plus the weather. The hash matters: raw weather isn't evenly random, and the Monty Hall odds only hold if the dice are fair. The weather also shapes how the cave looks (drips from rain, fog from humidity, dust blowing with the wind, warmer rock when it's hot out) and gets fed to the Rookie as a deliberate red herring. Every seed is logged with its round, so anyone can refetch it and replay the cave exactly.

## Run it

No build step, no dependencies, no keys.

```sh
cd web && python3 -m http.server 8000
# open http://localhost:8000
# http://localhost:8000/#turbo   trains as fast as your CPU allows
# http://localhost:8000/#play    you play along
```

Tests:

```sh
npm test                                   # js: the odds, the network's math, is it still learning
cd python && pip install -e ".[test]" && pytest
```

## Bring your own agent

The world is ported to Python as a [Gymnasium](https://gymnasium.farama.org) environment. One step is one fork: action 0 stays, 1 switches, reward 1 for ore. The observation matches the browser model's input exactly.

```python
from whos_knocking.env import KnockersEnv

env = KnockersEnv(episode_forks=2000)
obs, info = env.reset(seed=0)
obs, reward, terminated, truncated, info = env.step(1)
info["regret"]   # ore lost versus perfect knowledge
```

Score it the same way the live screen does:

```sh
python -m whos_knocking.evaluate --policy parrot --forks 3000 --seeds 5
python -m whos_knocking.evaluate --policy my_pkg.agents:MyAgent --max-regret 2
```

A policy is any class with `act(obs)` and `observe(obs, action, reward, info, next_obs)`.

## Cost

Zero. The network trains on the viewer's own computer in plain JavaScript (hand written backprop, Adam, a replay buffer). No server, no GPU, no API keys, no LLM calls. drand and Open-Meteo are free. The site can be hosted on GitHub Pages for free.

## Layout

```
web/sim.js          the world, the four knockers, the exact oracle
web/apprentice.js   the neural network, its canaries
web/expedition.js   runs all miners at the same forks, keeps the scorecard
web/entropy.js      drand + weather + sha-256
web/cave.js         three.js marching cubes cave
web/main.js         the live screen
python/             gymnasium env, bit for bit port, evaluator
tests/              node tests and the golden trace python must match
```

## Ideas

- More knockers: a fibber who's right only 70% of the time, or a copycat who mimics whoever came before.
- Give the Rookie a longer memory so it can notice a move by itself.
- Let a live stream's chat vote as another miner.
- Race the Rookie against a bigger network that reads the forks in order.

## Credits

[three.js](https://threejs.org) and its MarchingCubes addon, [simplex-noise](https://github.com/jwagner/simplex-noise.js), [drand](https://drand.love) and the League of Entropy, [Open-Meteo](https://open-meteo.com). Monty Fall is from Jeffrey Rosenthal's *Monty Hall, Monty Fall, Monty Crawl*. The knockers are from Cornish mining folklore.

## License

MIT
