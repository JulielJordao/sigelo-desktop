use tauri::{AppHandle, Manager, Position};
use crate::projection::renderer::render_html; // Mantemos o import para usar a função mais abaixo

#[tauri::command]
pub fn update_projection(app: AppHandle, html: String, target_monitor: Option<String>) {
    // 1. Atualiza o estado e emite o evento para o Vue (Isso não rouba foco)
    crate::projection::renderer::render_html(&app, html);

    // 2. Manipulação da janela
    if let Some(window) = app.get_webview_window("projection") {
        
        // Só mexe na posição e no fullscreen se a janela estiver invisível
        let is_visible = window.is_visible().unwrap_or(false);

        if !is_visible {
            let _ = window.show();
            let _ = window.unminimize();

            // Move para o monitor correto
            if let Some(monitor_name) = target_monitor {
                if let Ok(monitors) = app.available_monitors() {
                    if let Some(monitor) = monitors.into_iter().find(|m| m.name() == Some(&monitor_name)) {
                        let position = monitor.position();
                        let _ = window.set_position(tauri::Position::Physical(*position));
                    }
                }
            }
            
            let _ = window.set_fullscreen(true);

            // BÔNUS: Devolve o foco para o editor principal imediatamente
            // Assim, você não precisa clicar no editor de novo para usar as setas do teclado!
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.set_focus();
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