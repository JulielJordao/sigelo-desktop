// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
mod directory;
mod monitors;
mod projection;
mod state;
mod youtube;
mod pdf;
mod offline;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use crate::state::app_state::AppState;
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

// Comando que o frontend vai chamar
#[tauri::command]
fn is_online() -> bool {
    // Tenta conectar no DNS do Google (8.8.8.8) na porta 53 (porta de DNS)
    let addr = SocketAddr::from(([8, 8, 8, 8], 53));
    
    // Define um timeout de 2 segundos. Se não responder, assume offline.
    match TcpStream::connect_timeout(&addr, Duration::from_secs(2)) {
        Ok(_) => true,
        Err(_) => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1. Desativa recursos de taxa de atualização variável que causam flickering em 75Hz+
    // 2. Desativa o 'Occlusion Tracker' que às vezes faz o Windows 'pausar' o app sem bordas
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", 
        "--disable-features=msWebview2EnableVariableRefreshRate,CalculateNativeWinOcclusion"
    );
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
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
            crate::pdf::generate_pdf::generate_pdf,
            crate::offline::lyrics::get_offline_lyrics_safe,
            is_online
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                
                // 1. A PROJEÇÃO: Sempre se esconde em qualquer sistema (para reabrir rápido)
                if label == "projection" {
                    api.prevent_close();
                    let _ = window.hide();
                }

                // 2. A JANELA PRINCIPAL: Comportamento diferente por sistema
                if label == "main" {
                    #[cfg(target_os = "macos")]
                    {
                        // No Mac: Impede de fechar e apenas esconde (comportamento de Dock)
                        api.prevent_close(); 
                        let _ = window.hide(); 
                    }
                    
                    #[cfg(not(target_os = "macos"))]
                    {
                        // No Windows/Linux: Não fazemos nada! 
                        // Deixamos o Tauri seguir o padrão natural, que é fechar a 
                        // janela e, por consequência, encerrar o aplicativo de vez.
                    }
                }
            }
        })
        .setup(|app| {
            use tauri::Manager;

            // --- LÓGICA EXCLUSIVA PARA MACOS ---
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                if let Some(window) = app.get_webview_window("main") {
                    // Garante que o título esteja vazio para não ocupar espaço
                    let _ = window.set_title(""); 
                    // Força o Overlay caso o JSON não tenha pego
                    let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
                }
            }

            // --- LÓGICA PARA WINDOWS E LINUX ---
            // Se NÃO for macOS, nós removemos as decorações completamente
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.set_decorations(false).unwrap();
                }
            }
            crate::monitors::watch::start_monitor_watcher(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error running tauri app")
        .run(|app_handle, event| match event {
            // Este evento é acionado quando o usuário clica no ícone do Dock no Mac
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                use tauri::Manager;
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show(); // Traz a janela de volta da invisibilidade
                    let _ = window.set_focus(); // Coloca ela em primeiro plano
                }
            }
            _ => {} // Ignora outros eventos do ciclo de vida
        });
}
