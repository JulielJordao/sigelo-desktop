// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod commands;
mod monitors;
mod projection;
mod state;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        // 1. REGISTRAMOS OS COMANDOS AQUI:
        .invoke_handler(tauri::generate_handler![
            greet, // Seu comando de teste original
            crate::monitors::display::get_monitors,
            crate::monitors::detector::detect_projector_cmd
        ])
        .setup(|app| {
            crate::monitors::watch::start_monitor_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}
