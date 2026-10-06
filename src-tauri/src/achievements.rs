// Bridges the game's achievement unlocks (fired from JS via PG.save.unlockAch(), see
// js/engine.js's PG.steam object and js/data.js's PG.ACHIEVEMENTS list) to the real Steamworks
// API. This only does anything when built with the `steam` Cargo feature (off by default - see
// Cargo.toml and README-TAURI.md). Without it, `unlock_achievement` is a harmless no-op: the
// game always saves the unlock locally in its own save data regardless, so nothing is lost by
// building without Steam support.
//
// Two things to do before this unlocks anything on a real Steam account:
//   1. Replace STEAM_APP_ID below with your game's real App ID once Valve assigns one. Until
//      then this uses 480 ("Spacewar"), Valve's public test app, so you can build and run with
//      `--features steam` and see achievement calls succeed/fail without owning a real App ID.
//   2. In the Steamworks App Admin for your app, create an achievement with the exact
//      (case-sensitive) "API Name" for every id in PG.ACHIEVEMENTS (js/data.js) - e.g.
//      ACH_SURVIVE_10, ACH_KINGTAURUS, ACH_NOHIT, etc. The strings must match exactly.
//
// At runtime: if Steam isn't running, or the App ID has no matching achievement, calls here
// just log a warning (see your terminal, or the log file in debug builds) and the game carries
// on fine either way.

#[cfg(feature = "steam")]
mod imp {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use steamworks::{CallbackHandle, Client};

    // TODO: replace with your real Steamworks App ID before shipping. 480 is Valve's public
    // test app ("Spacewar"), safe to leave in during development.
    const STEAM_APP_ID: u32 = 480;

    pub struct SteamState {
        client: Option<Client>,
        stats_ready: Arc<AtomicBool>,
        pending: Arc<Mutex<Vec<String>>>,
        // kept alive only so the UserStatsReceived subscription isn't dropped - never read again.
        _stats_cb: Option<CallbackHandle>,
    }

    impl SteamState {
        /// Tries to connect to a running Steam client. Never panics - if Steam isn't running
        /// (or this build doesn't have a Steam account to talk to yet) the game just runs with
        /// achievements only saved locally.
        pub fn init() -> Self {
            let stats_ready = Arc::new(AtomicBool::new(false));
            let pending: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

            match Client::init_app(STEAM_APP_ID) {
                Ok(client) => {
                    log::info!("Steam client connected (app id {STEAM_APP_ID})");

                    let ready_w = stats_ready.clone();
                    let stats_cb = client.register_callback(move |val: steamworks::UserStatsReceived| {
                        if val.result.is_ok() {
                            ready_w.store(true, Ordering::SeqCst);
                            log::info!("Steam user stats ready");
                        } else {
                            log::warn!("Steam user stats request failed: {:?}", val.result);
                        }
                    });

                    // Steam needs its callback queue pumped regularly (the SDK's own guidance is
                    // roughly once a frame) for the callback above - and any achievement unlock -
                    // to ever actually go through. This also flushes achievements that were
                    // unlocked before the user's stats finished loading.
                    let pump_client = client.clone();
                    let pump_ready = stats_ready.clone();
                    let pump_pending = pending.clone();
                    std::thread::spawn(move || loop {
                        pump_client.run_callbacks();
                        if pump_ready.load(Ordering::SeqCst) {
                            let mut q = pump_pending.lock().unwrap();
                            if !q.is_empty() {
                                let stats = pump_client.user_stats();
                                for id in q.drain(..) {
                                    unlock_now(&stats, &id);
                                }
                            }
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    });

                    SteamState { client: Some(client), stats_ready, pending, _stats_cb: Some(stats_cb) }
                }
                Err(e) => {
                    log::warn!("Steam not available ({e:?}) - achievements are still saved locally in the browser save");
                    SteamState { client: None, stats_ready, pending, _stats_cb: None }
                }
            }
        }

        fn unlock(&self, id: &str) {
            let Some(client) = &self.client else { return };
            if !self.stats_ready.load(Ordering::SeqCst) {
                // stats haven't loaded yet - queue it, the pump thread flushes this once ready.
                self.pending.lock().unwrap().push(id.to_string());
                return;
            }
            unlock_now(&client.user_stats(), id);
        }
    }

    fn unlock_now(stats: &steamworks::UserStats, id: &str) {
        match stats.achievement(id).set() {
            Ok(()) => match stats.store_stats() {
                Ok(()) => log::info!("Steam: unlocked {id}"),
                Err(()) => log::warn!("Steam: set achievement {id} but store_stats() failed"),
            },
            Err(()) => log::warn!(
                "Steam: unknown achievement id {id} - check it exists with this exact API name in the Steamworks App Admin"
            ),
        }
    }

    #[tauri::command]
    pub fn unlock_achievement(id: String, state: tauri::State<SteamState>) {
        state.unlock(&id);
    }
}

#[cfg(not(feature = "steam"))]
mod imp {
    /// Stand-in used when the `steam` Cargo feature is off (the default - see Cargo.toml). The
    /// game's save data already persists every unlock on its own, so this intentionally does
    /// nothing; it exists purely so `unlock_achievement` is always a valid command to invoke
    /// from JS, feature flag or not.
    pub struct SteamState;

    impl SteamState {
        pub fn init() -> Self {
            log::info!("Steam support not built in (the `steam` Cargo feature is off) - achievements are saved locally only");
            SteamState
        }
    }

    #[tauri::command]
    pub fn unlock_achievement(_id: String, _state: tauri::State<SteamState>) {}
}

pub use imp::*;
