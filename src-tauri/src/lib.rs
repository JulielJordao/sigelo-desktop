// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod commands;
mod projection;
mod state;
mod monitors;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
     tauri::Builder::default()
        .setup(|app| {
            crate::monitors::watch::start_monitor_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}
