use tauri::{AppHandle, Manager, Position};
use crate::projection::renderer::render_html; // Mantemos o import para usar a função mais abaixo

#[tauri::command]
pub fn update_projection(app: AppHandle, html: String, target_monitor: Option<String>) {
    render_html(&app, html);

    if let Some(window) = app.get_webview_window("projection") {
        // 1. Torna a janela visível se ela estiver escondida
        let _ = window.show();
        let _ = window.unminimize();

        // 2. Move para o monitor escolhido (sua lógica anterior)
        if let Some(monitor_name) = target_monitor {
            if let Ok(monitors) = app.available_monitors() {
                if let Some(monitor) = monitors.into_iter().find(|m| m.name() == Some(&monitor_name)) {
                    let position = monitor.position();
                    let _ = window.set_position(tauri::Position::Physical(*position));
                    let _ = window.set_fullscreen(true);
                }
            }
        }
    }
}

#[tauri::command]
pub fn get_current_projection(state: tauri::State<'_, crate::state::app_state::AppState>) -> String {
    // Retorna o HTML salvo no estado
    state.get_html()
}

#[tauri::command]
pub fn stop_projection(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("projection") {
        let _ = window.hide(); // Apenas esconde, não destrói!
    }
}