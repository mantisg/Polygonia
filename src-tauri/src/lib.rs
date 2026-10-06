mod achievements;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      app.manage(achievements::SteamState::init());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![achievements::unlock_achievement])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
