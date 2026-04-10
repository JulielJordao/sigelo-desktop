// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod commands;
mod directory;
mod monitors;
mod projection;
mod state;
mod youtube;
mod pdf;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use crate::state::app_state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::default())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        // 1. REGISTRAMOS OS COMANDOS AQUI:
        .invoke_handler(tauri::generate_handler![
            greet, // Seu comando de teste original
            crate::monitors::display::get_monitors,
            crate::monitors::detector::detect_projector_cmd,
            crate::commands::projection::update_projection,
            crate::commands::projection::stop_projection,
            crate::commands::projection::get_current_projection,
            crate::commands::projection::prepare_projection_window,
            crate::directory::directory::get_dir_size,
            crate::directory::directory::open_folder_native,
            crate::directory::directory::clear_directory,
            crate::youtube::youtube::update_binaries,
            crate::youtube::youtube::get_youtube_info,
            crate::youtube::youtube::cache_youtube_video,
            crate::youtube::youtube::check_ytdlp_status,
            crate::youtube::youtube::get_cached_videos,
            crate::youtube::youtube::delete_cached_video,
            crate::youtube::youtube::open_youtube_cache_folder,
            crate::pdf::generate_pdf::generate_pdf
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
