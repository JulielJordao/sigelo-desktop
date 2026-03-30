// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod commands;
mod monitors;
mod projection;
mod state;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use crate::state::app_state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_http::init())
        // 1. REGISTRAMOS OS COMANDOS AQUI:
        .invoke_handler(tauri::generate_handler![
            greet, // Seu comando de teste original
            crate::monitors::display::get_monitors,
            crate::monitors::detector::detect_projector_cmd,
            crate::commands::projection::update_projection,
            crate::commands::projection::stop_projection,
            crate::commands::projection::get_current_projection
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Se a janela que está tentando fechar for a "projection"
                if window.label() == "projection" {
                    // Impede o sistema de destruir a janela
                    api.prevent_close();
                    // Apenas oculta, mantendo ela viva na memória para a próxima vez
                    let _ = window.hide(); 
                }
            }
        })
        .setup(|app| {
            crate::monitors::watch::start_monitor_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}
