# Polygonia: Escape from 2-D

A Vampire Survivors-style roguelike where the player and every enemy are 2-D shapes trying to escape the paper world.
Survive 20 minutes. Auto-fire weapons, collect paperclip XP, level up, and outlast an ever-growing horde.

Rebuilt in HTML / CSS / JavaScript (canvas) from the original Python/pygame game "PaperTrail", using all of its
hand-drawn sprites, backgrounds, music and world layout.

## Run it
- Double-click `index.html` (no server or install needed), **or**
- `python -m http.server` in this folder, then open http://localhost:8000, **or**
- as a native desktop app with Steam Achievements support - see [README-TAURI.md](README-TAURI.md)

## Controls
| Key | Action |
| --- | --- |
| WASD / arrow keys | Move (weapons fire automatically) - all keys can be rebound in Options |
| 1-5 or click | Pick a level-up card |
| R | Reroll the level-up cards (needs the Keep Tabs perk) |
| Esc / P | Pause (also pauses when the window loses focus) |
| M | Mute |

## What is in it
- Title screen, character select (Ninjircle, Tridolf, Sqwerewolf), pause menu, game over and escape screens
- 20:00 run timer, ramping spawn director, encirclement events, mini-boss groups and two Kingtaurus fights
- XP paperclip gems, level-ups (choose 1 of 3), weapon levels 1-8, 10 passive items, treasure drops from bosses
- Same deterministic paper world as the Python version: trees, bushes, cabins (walk behind trees), border
- Pies (heal), paperclip magnets (vacuum all gems), moolah
- **The Archive** (from the title, select and end screens): every run pays out moolah (collected + time survived + kills, +500 for escaping).
  Spend it on 13 permanent perks (damage, HP, regen, armor, speed, cooldowns, pickup range, XP, area, moolah, level-up rerolls,
  a Spare Shape revive, and a 4th level-up card) and on unlocks: four extra weapons (Paper Football, Paper Crane, Pie Slinger, Stop, Bro!)
  and three passives (Notebook, Pencil, Moolah) that stay out of the level-up pool until bought. Perks can be fully refunded.
  The Archive also lists all 16 achievements (survival milestones, boss kills, a no-hit escape, and more - see `PG.ACHIEVEMENTS`
  in `js/data.js`), which pop a toast the moment they unlock and sync to Steam in the desktop build - see
  [README-TAURI.md](README-TAURI.md). Progress is saved in the browser (localStorage).

## Options (title screen and pause menu)
Difficulty (Easy / Normal / Hard / Nightmare: spawn, health and damage multipliers, with a matching moolah bonus), music and effects volume,
mute, rebindable keys (two slots per action), screen shake, pause-on-focus-loss, FPS counter, fullscreen, reset options,
and a two-click "Reset all progress" that erases moolah, perks, unlocks and records (settings are kept).
Difficulty and settings live in `PG.DIFFICULTIES`, `PG.ACTIONS` and `PG.DEFAULT_SETTINGS` in `js/data.js`.

## Files
```
index.html      page + all screens
style.css       hand-drawn UI styling
js/data.js      ALL tunable content: characters, weapons, passives, Archive perks/unlock costs, enemies, spawn ramp, timeline, XP curve
js/engine.js    asset loading, input, audio, save data + run rewards + Archive purchases, helpers
js/game.js      the run: world, player, enemies, weapons, spawning, collisions, rendering
js/ui.js        HUD, level-up cards, pause / end screens, the Archive screen
js/main.js      boot, screen flow, frame loop
assets/         every sprite, background and the music (unchanged from the Python project)
src-tauri/      native desktop wrapper + Steam Achievements bridge - see README-TAURI.md
```

## Tuning the difficulty
Open `js/data.js`. The important knobs:
- `PG.spawnRate(t)` enemies per second at time t
- `PG.hpMult(t)` / `PG.dmgMult(t)` enemy health and damage growth
- `PG.xpNeeded(L)` XP curve, `PG.MAX_ENEMIES` horde cap
- `PG.TIMELINE` scripted rings, mini bosses and Kingtaurus
- `PG.PERKS` (cost, growth, max rank, effect) and a weapon/passive `cost` (locks it until bought in the Archive)
- `PG.save.reward()` in `js/engine.js`: how much moolah a run pays out
- weapon `base` and `up` tables, passive `mod` functions

## Adding content
- **Weapon:** add an entry to `PG.WEAPONS` (kind `proj`, `orbit`, `boomer`, `lob`, `nova` or `flock`; give it a `cost` to make it an Archive unlock). Add the sprite to `PG.ASSETS`.
  A weapon's `icon` is what shows in the Archive and level-up cards (use a full `cXxx`-style labeled card asset for a nicer look, same as the passives).
  `flyIcon` is the small sprite actually drawn in the world for `boomer`/`flock` weapons (the `icon` card art is too big/text-covered for that); `proj`/`lob`/`nova` weapons just reuse `icon` directly since theirs are already small sprites.
  `flock` (Paper Crane) is a persistent swarm: `count` birds wander near the player and dart at the nearest enemy within `radius`, dealing `dmg` on contact with a per-enemy hit cooldown of `cd`. See `Game.updateFlock()` in `js/game.js`.
- **Passive:** add an entry to `PG.PASSIVES` with a `mod(m, level)` function.
- **Enemy:** add an entry to `PG.ENEMIES`, then reference it from `pickType()` / `PG.TIMELINE`.
- **Character:** add an entry to `PG.CHARACTERS` (standing frame + walk frames + starting weapon).
