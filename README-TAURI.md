# Desktop build (Tauri) & Steam Achievements

The game itself is still the plain HTML/CSS/JS in this folder - nothing about how it runs
changed. `src-tauri/` just wraps it in a native desktop window (via [Tauri](https://tauri.app))
so it can be packaged as a real Windows/macOS/Linux app and, optionally, talk to the Steamworks
API for achievements.

## 1. One-time setup

You need the Rust toolchain and the Tauri CLI. You do **not** need Node/npm - this project has
no JS build step, so the desktop wrapper serves `index.html` directly.

1. Install Rust: https://rustup.rs (Windows: just run `rustup-init.exe` and accept the defaults;
   it'll also prompt to install the Visual Studio C++ Build Tools if you don't have them, which
   Tauri needs on Windows).
2. Install the Tauri CLI once: `cargo install tauri-cli --locked --version "^2"`.
   This gives you the `cargo tauri` command used below.
3. Windows also needs the **WebView2 runtime** - it already ships with Windows 10/11, so you
   almost certainly have it. (Linux needs `webkit2gtk` + `gtk3` dev packages installed via your
   package manager; macOS needs Xcode command line tools. Only relevant if you're building on
   those platforms instead.)

## 2. Running it

From the `polygonia` folder (the one with `index.html` and `src-tauri/` side by side):

```
cargo tauri dev
```

This opens the game in a native window, exactly like double-clicking `index.html` in a browser,
except it's a real desktop app. Closing the window quits the process. There's no hot-reload
step to worry about since the frontend is plain static files - edit `js/`, `index.html` or
`style.css` and just restart `cargo tauri dev` (or re-open the window) to see changes; you don't
need to restart for asset/image changes either, only a relaunch to pick up new files.

## 3. Building the real app

```
cargo tauri build
```

This produces an installer/bundle under `src-tauri/target/release/bundle/` - on Windows that's
an `.msi` and an `.exe` (NSIS) installer; on Linux a `.deb`/`.rpm`/AppImage; on macOS a `.app`
plus `.dmg`. The icon, window title and app id all come from `src-tauri/tauri.conf.json` (the
icon itself is generated from the game's Ninjircle sprite - swap it with `cargo tauri icon
path/to/some-1024x1024.png` run from inside `src-tauri/` if you ever want a different one, then
re-run `cargo tauri build`).

The window starts at 1280x800 (resizable, 960x600 minimum) and the canvas scales to fill
whatever size you resize it to, same as in a browser.

## 4. Steam Achievements

16 achievements are wired up already (see `PG.ACHIEVEMENTS` in `js/data.js` for the full list
and what unlocks each one - survival time milestones, boss kills, a no-hit escape, difficulty
clears, and so on). They're tracked and saved locally **regardless of Steam** - `PG.save.data
.achievements` lives right alongside your moolah/perks/records in the browser's local storage,
so achievements, the in-game toast popup, and the Archive's new "Achievements" grid all work the
same whether or not this is a Steam build.

Talking to the *real* Steamworks API (so achievements actually show up in the Steam overlay and
on your Steam profile) is behind a Cargo feature called `steam`, **off by default**. Here's why,
and how to turn it on when you're ready:

### Why it's off by default

The `steamworks` Rust crate conveniently bundles the public Steamworks SDK redistributable
itself, so building with `--features steam` works out of the box in this repo with no manual SDK
download - already tested end-to-end (bridge compiles, links, launches, and gracefully falls
back to "Steam not available" when Steam isn't running). But it still needs **your own Steam App
ID**, which you don't have yet. Until you do, there's no reason to ship the extra ~2-3 MB Steam
redistributable DLL or have the app try (and fail) to find Steam on every launch, so the default
build skips it entirely.

### Turning it on once you have a Steamworks account

1. **Get a Steamworks Partner account and App ID.** This costs Valve a one-time $100 fee per
   app and is a manual process on their site: https://partner.steamgames.com. This is the one
   step nobody but you can do - it's tied to your identity/business and Valve's payment system.
2. **Create your achievements in the App Admin.** In your app's Steamworks App Admin, under
   Stats & Achievements, add one achievement per entry in `PG.ACHIEVEMENTS` (`js/data.js`). The
   **API Name** field for each one must match the `id` exactly, character for character -
   `ACH_SURVIVE_10`, `ACH_SURVIVE_20`, `ACH_SURVIVE_30`, `ACH_MIDBOSS`, `ACH_KINGTAURUS`,
   `ACH_HARD`, `ACH_NIGHTMARE`, `ACH_NOHIT`, `ACH_REVIVE_WIN`, `ACH_ALL_CHARS`,
   `ACH_FULLY_LOADED`, `ACH_ARCHIVE`, `ACH_HORDE500`, `ACH_MOOLAH300`, `ACH_FIRST_HIT`,
   `ACH_QUICK_TRIP`. The display name/description/icon you set in App Admin is what players
   actually see in the Steam overlay - the in-game toast and Archive grid have their own
   name/description (also from `js/data.js`) and don't have to match word-for-word, but it'll
   feel more polished if they do.
3. **Put your App ID in the code.** Open `src-tauri/src/achievements.rs` and change
   `STEAM_APP_ID` (near the top) from `480` (Valve's public test app, used so this builds and
   runs sensibly before you have a real ID) to your real App ID.
4. **Build or run with the feature on:**
   ```
   cargo tauri dev -f steam
   cargo tauri build -f steam
   ```
   or make it the default permanently by changing `default = []` to `default = ["steam"]` in
   `src-tauri/Cargo.toml`, so plain `cargo tauri build` always includes it.
5. **Local testing without Steam running you through it:** Steam normally only sets up the
   environment a game needs when it's *launched from* the Steam client. To test a `steam`-feature
   build by just double-clicking the .exe, put a `steam_appid.txt` file (containing just your
   App ID, e.g. the text `480`) next to the built executable - the Steamworks SDK reads that as
   a fallback. **Don't ship that file in your release build** - remove it once you're
   distributing through Steam, since Steam itself handles this at launch.

### What happens if Steam isn't running (even in a `steam`-feature build)

Nothing breaks. `SteamState::init()` (`src-tauri/src/achievements.rs`) tries to connect and, if
it can't (Steam not installed, not running, wrong/missing App ID), logs a warning and the rest
of the app works completely normally - achievements still unlock and save locally, the toast
still pops up, nothing crashes. The only thing missing is the Steam overlay notification and the
achievement showing on your Steam profile.

### How the pieces fit together

- `js/data.js` - `PG.ACHIEVEMENTS`, the single source of truth for achievement ids/names/text.
- `js/game.js` - the ~16 call sites (survive X minutes, kill a boss, escape without taking a hit,
  etc.) that call `PG.save.unlockAch(id)` when a condition is met.
- `js/engine.js` - `PG.save.unlockAch()` saves the unlock locally (idempotent - safe to call
  repeatedly), shows the toast via `PG.ui.achToast()`, and calls `PG.steam.unlock(id)`.
- `js/engine.js` - `PG.steam` detects whether it's running inside the Tauri desktop build
  (`window.__TAURI__` present) and, if so, invokes the `unlock_achievement` Rust command. In a
  plain browser tab this is just a no-op.
- `js/ui.js` - `PG.ui.achToast()` (the popup) and the "Achievements" grid added to the end of
  The Archive screen, showing every achievement with a lock/checkmark and unlock date.
- `src-tauri/src/achievements.rs` - the Rust side: connects to Steam, forwards unlocks, and is a
  total no-op when the `steam` feature is off.
