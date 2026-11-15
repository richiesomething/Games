# Parlor 🎲

Party games for clever people: built for **6–8 players**, playing as **individuals or teams of two**, with **one phone passed around the room**.

Plain HTML/CSS/JS. No build step, no server, no accounts. Open `index.html` or host it on GitHub Pages.

## The games

| Game | In the spirit of | What it's like |
|---|---|---|
| 🤳 **Forehead** | Heads Up, Taboo | Phone on your forehead (tilt to score) or clue-giver mode with forbidden words. Golden ⭐ double cards and a double-points finale. |
| 🐟 **Fishbowl** | Monikers, Celebrity | Write names into the bowl, then three rounds: describe → one word → charades (+ optional sounds-only). |
| ❓ **Twenty Questions** | the classic | Hot-seat version. Solve early for more points; the answerer scores if it's solved in the Q8–16 "sweet spot". |
| 📝 **Categories** | Scattergories | Random letter, 8–15 categories, timer, guided scoring. Twist rounds (star category, two letters, speed round, ends-with). Other phones can follow along with a round code. |
| 🎯 **Spectrum** | Wavelength | Secret target on a dial between two extremes; one clue; partner turns the dial. Left/right side bets. |
| 🧵 **Common Thread** | Only Connect | Four clues, one at a time. Lock in early for 5/3/2/1 points; wrong locks cost 1. |
| 📖 **Fictionary** | Balderdash | Obscure real words. Type fake definitions on the phone (auto-shuffled, auto-scored) or use paper. |
| 🕵️ **Imposter** | The Chameleon, Spyfall | Everyone knows the word but one. One word each, vote, and the caught imposter gets a last guess. |
| 📏 **Ballpark** | Wits & Wagers | Secret numeric guesses, number-line reveal, closest wins (or "no going over"). |
| 💣 **Hot Potato** | Catch Phrase, Pass the Bomb | Shout an answer, pass the phone, secret fuse, lives. |
| ⏳ **Chronology** | Timeline | Slot events into your own timeline. Steals on misses. |
| 🐝 **Hive Mind** | Herd Mentality | Write what you think *most people* will write. Lone answers get the black sheep 🐑. |
| 👉 **Most Likely To** | party classic | Point on three; score for reading the room; a hot-seat prediction; ends with a superlatives yearbook. |

## Content

| | |
|---|---|
| Forehead / Fishbowl / 20Q cards | 1,687 across 24 decks, each with 4 forbidden words |
| Categories | 873 |
| Hot Potato prompts | 455 (three difficulty tiers) |
| Spectrums | 320 |
| Imposter sets | 104 × 16 words |
| Common Thread puzzles | 358 |
| Fictionary words | 312 |
| Ballpark questions | 431 |
| Chronology events | 765 |

Each game remembers (per device) which cards it has dealt and works through the whole pool before repeating.

## How it fits together

- **Players & teams** are set once on the home page (or inline in any game) and shared by every game. Teams of two are formed in order; "Shuffle teams" re-pairs them, and an odd count makes one trio. Team names are editable.
- **Game-night standings**: each finished game awards placement points (5 / 3 / 2 / 1) to every member of each side, so standings survive team reshuffles. "New night" resets them.
- **Surprise me** picks a game you haven't played tonight; **tonight's awards** (Master of Deception, Big Brain, Mind Reader…) appear in the standings.
- Everything is stored in `localStorage` on the device. Nothing is sent anywhere.

```
index.html               hub: roster, standings, game list
games/*.html             one page per game
assets/css/parlor.css    shared design system (dark + light)
assets/js/parlor.js      shared engine: roster/sides, dealing, timers, sound, screens, scoring
assets/data/*.js         content (window.GN_DATA.*)
```

## Hosting on GitHub Pages

Settings → Pages → *Deploy from a branch* → pick the branch and `/ (root)`. The site is fully static (a `.nojekyll` file is included).

## Adding content

Data files are plain arrays. For example, add a Forehead deck by pushing to `GN_DATA.decks`:

```js
window.GN_DATA.decks.push({ id:"office", name:"Office Life", emoji:"💼", blurb:"Meetings that could've been emails", q20:false,
  cards:[ ["Reply all", "email", "everyone", "send", "mistake"] ] });
```

The first entry is the answer, and the rest are forbidden words. `q20:true` makes the deck available for Twenty Questions.
