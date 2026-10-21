# Pay Dirt

A tiny AI learns a famous puzzle by mining for gold, live in your browser.

**[▶ Play it](https://porkedchop.github.io/pay-dirt/)** · free, nothing to install

[![Three miners, three tunnels, one has gold. Dynamite blows one tunnel shut.](docs/pay-dirt.webp)](https://porkedchop.github.io/pay-dirt/)

## The idea in one minute

Three tunnels. One has gold.

The crew picks a tunnel. Then someone may light dynamite in one of the **other** two tunnels. Boom, that tunnel is blocked and out of play. Now each miner decides: stay with the tunnel, or switch to the one that's left?

That's the **Monty Hall puzzle** from the old TV game show. Most people learn the answer is "always switch." But that's only true because the host *knows* where the prize is. Change who sets off the blast, and the right answer changes too.

| Who lights the dynamite | What they're up to | Right move |
|---|---|---|
| **The Foreman** | Runs the mine and knows where the gold is. Always blows up an empty tunnel. | Switch (wins 2 out of 3 times) |
| **Loose Fuse** | Old dynamite going off at random. Sometimes it buries the gold. | Doesn't matter, it's a coin flip |
| **The Joker** | A prankster who only blows up a tunnel when you already picked the gold, hoping you'll leave. | Stay after a blast, switch when there's none |

Nobody tells the miners who is lighting the dynamite in the part of the mine they're in. They have to figure it out from what happens.

## The three miners

They stand side by side at the same spot, see the same first pick and the same blast. The only difference is what each one does next, and you can watch each of them walk into the tunnel he chose.

- **Rookie** (blue shirt, middle) is the AI. A tiny neural network (162 numbers) that starts out knowing nothing. Nobody tells it the rules or who the characters are. It watches what happens and learns.
- **Old Timer** (green shirt, grey beard, left) knows every character's habits and does the math perfectly. He's the best anyone can do.
- **Bookworm** (orange shirt, glasses, nose in a book, right) always switches after a blast, because that's the textbook answer. It's what an AI does when it memorized the famous puzzle instead of thinking about it.

## Walkthrough

**0. Opening the page.** A short welcome card explains the idea while the mine is already running behind it.

![The welcome card](docs/walkthrough/0-welcome.png)

**1. A part of the mine ends.** The camera moves in close on the crew and shows how everyone did. Here it was Loose Fuse, which is pure luck, so nobody did much better than anyone else.

![Part done: Loose Fuse, and how many times each miner found gold](docs/walkthrough/1-done.png)

**2. The weather decides where the gold is.** Each part of the mine starts by checking the real weather in a mining town right now and scrambling it into a number. That number hides the gold behind one of the three tunnels before every pick, and secretly picks who's behind the dynamite.

![Shuffling the next part with the weather in St Just, England](docs/walkthrough/2-shuffle.png)

**3. The crew picks a tunnel.** Top left: the town whose weather shuffled this part. On the right, notes explain what's going on, including Old Timer's guess for who is behind the dynamite.

![The crew picks a tunnel](docs/walkthrough/3-pick.png)

**4. Someone lights dynamite in another tunnel.** The headlamps find it strapped to the timber, the fuse burns, and boom.

![The blast](docs/walkthrough/4-boom.png)

**5. The headlamps check the rubble.** That tunnel is blocked, so two are left.

![The headlamps light up the rubble](docs/walkthrough/5-rubble.png)

**6. Everyone decides.** Each miner turns and shines his lamp down the tunnel he picked. Old Timer is sure this is the Joker, so he stays. The Rookie worked out the same thing. The Bookworm switches, which is exactly what the Joker wanted.

![Old Timer and the Rookie stay, the Bookworm switches](docs/walkthrough/6-calls.png)

**7. The gold is revealed,** and each miner walks into his tunnel.

![The gold is revealed](docs/walkthrough/7-reveal.png)

**8. The notes** on the right cover the rules, Old Timer's guess, the score, a chart of whether the Rookie is learning, three test questions, where the randomness came from, and every pick saved to your device. **Hide notes** gives you the full screen.

![The notes column](docs/walkthrough/8-notes.png)

It works on a phone too, with the notes under the game.

![The phone layout](docs/walkthrough/9-phone.png)

## How we know it's really learning

Because we built the mine, we always know the right answer at every fork. So every fork is a free test, forever.

- **Gold missed.** For every pick, we compare the miner's choice to someone who knew exactly who set off the blast. A line that goes flat means that miner stopped making mistakes. We count the odds, not the luck, so a lucky guess doesn't hide a bad choice.
- **Test questions.** Every ten picks the Rookie answers three questions it never practices on, one per character. Getting them right means it learned the rule.
- **Automatic checks.** The tests double check the AI's math and fail if the Rookie stops learning.

What it shows so far (5,000 picks, measured over the last 1,000):

| Miner | Gold missed per 100 picks |
|---|---|
| Old Timer | 0.1 |
| Rookie | 0.7 |
| Bookworm | 15.5 |

The Rookie gets close to Old Timer within a couple thousand picks. The Bookworm never improves, because the Joker fools it every single time.

## The weather decides where the gold is

Cloudflare famously keeps a wall of lava lamps and turns photos of them into random numbers. Pay Dirt does the same thing with the weather.

One free request to [Open-Meteo](https://open-meteo.com) (no account, no key) gets the current weather in eight real mining towns: St Just (England), Kiruna (Sweden), Potosí (Bolivia), Kalgoorlie (Australia), Butte (USA), Wieliczka (Poland), Calama (Chile) and Falun (Sweden). Each part of the mine takes the next town's reading and scrambles it with SHA-256 into a random number. That number rolls the dice for **where the gold is** on every pick (each tunnel gets an even 1 in 3 chance), which tunnel the crew picks first, and, once per part, who's behind the dynamite and how long the part lasts.

The dynamite itself is **not** random, and that's the point. It's a clue: where it goes depends on where the gold is and on who lit it. The Foreman never blows up the gold, so his blast pushes the odds to 2 in 3 for switching. The Joker only blasts when you already picked the gold, so his blast means your tunnel is a sure thing. Loose Fuse is the only truly random blast, so it tells you nothing. The Rookie has to learn which kind of clue it's looking at. The weather is checked again every 15 minutes.

The weather also changes how the cave looks: more drips when it's raining, more fog when it's humid, dust blowing when it's windy.

## Run it

You don't need to install anything:

```sh
cd web && python3 -m http.server 8000
# then open http://localhost:8000
# http://localhost:8000/#turbo starts in fast forward
```

Replay an exact run (handy for bug reports and screenshots): `http://localhost:8000/?seed=7&skip=1209&freeze=calls`. The freeze points are `pick`, `boom`, `blast`, `calls`, `reveal`, `done` and `shuffle`. Replay mode skips the welcome card. Add `#bare` to hide the notes, handy for clips and streams.

## Every pick, saved

Every pick is saved in your browser, so it survives a reload. The **Download** button in the notes gives you all of it as a JSONL file: who was behind the dynamite, which tunnel blew up, each miner's choice and how sure it was, and whether it found gold.

To make a big log without the animation:

```sh
node tools/dig.mjs --forks 20000 --every 1000 --out runs/today.jsonl
```

It prints a progress line every 1,000 picks so you can watch it learn.

## Bring your own AI

For people who want to train their own agent, the same mine is in Python as a [Gymnasium](https://gymnasium.farama.org) environment. Action 0 stays, 1 switches, and you get a reward of 1 for gold.

```python
from pay_dirt.env import KnockersEnv

env = KnockersEnv(episode_forks=2000)
obs, info = env.reset(seed=0)
obs, reward, terminated, truncated, info = env.step(1)
info["regret"]   # gold missed compared to knowing who set off the blast
```

Score it the same way the page does:

```sh
cd python && pip install -e ".[test]"
python -m pay_dirt.evaluate --policy bookworm --forks 3000 --seeds 5
python -m pay_dirt.evaluate --policy my_pkg.agents:MyAgent --max-regret 2
```

The Python version makes exactly the same mine as the browser for the same seed, and a test checks that.

## Tests

```sh
npm test                      # the puzzle math, the AI's math, and is it still learning
cd python && pytest
```

## What it costs

Nothing. The AI trains on your own computer in plain JavaScript. There's no server, no GPU, no API key and no paid service.

## What's inside

```
web/sim.js          the mine, the three characters, and Old Timer's math
web/apprentice.js   the Rookie (the neural network) and its test questions
web/expedition.js   runs all three miners at the same forks and keeps score
web/entropy.js      the weather request and the random numbers
web/cave.js         the 3D cave (three.js)
web/log.js          saving every pick
web/main.js         the page
python/             the same mine for Python, plus the scorer
tests/              tests, and the trace Python has to match
tools/dig.mjs       a big run with no animation
```

## Thanks

[three.js](https://threejs.org), [Fredoka](https://fonts.google.com/specimen/Fredoka), [simplex-noise](https://github.com/jwagner/simplex-noise.js) and [Open-Meteo](https://open-meteo.com). "Monty Fall" comes from Jeffrey Rosenthal's *Monty Hall, Monty Fall, Monty Crawl*. The idea of something in the mine that may or may not be on your side comes from the Cornish "knockers" of mining folklore.

## License

MIT
