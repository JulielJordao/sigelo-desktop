use crate::projection::renderer::render_html;
use tauri::{AppHandle, Manager, Position}; // Mantemos o import para usar a função mais abaixo

#[tauri::command]
pub fn update_projection(app: tauri::AppHandle, html: String, target_monitor: Option<String>) {
    // 1. Atualiza o conteúdo HTML
    crate::projection::renderer::render_html(&app, html);

    // 2. Manipulação da janela
    if let Some(window) = app.get_webview_window("projection") {
        let is_visible = window.is_visible().unwrap_or(false);

        // A. Garante que a janela está visível
        if !is_visible {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_fullscreen(true);
            
            // Devolve o foco ao principal ao abrir pela primeira vez
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.set_focus();
            }
        }

        // B. Lógica dinâmica de Monitor (Funciona mesmo com ela já aberta)
        if let Some(target_name) = target_monitor {
            let mut needs_move = false;

            // Descobre em qual monitor a janela de projeção está rodando AGORA
            if let Ok(Some(current_monitor)) = window.current_monitor() {
                // Se o nome do monitor atual for diferente do alvo nas configurações, precisamos mover
                if current_monitor.name() != Some(&target_name) {
                    needs_move = true;
                }
            } else {
                needs_move = true; // Se falhar em ler, move por precaução
            }

            // Se o monitor mudou, faz a realocação
            if needs_move {
                if let Ok(monitors) = app.available_monitors() {
                    if let Some(monitor) = monitors.into_iter().find(|m| m.name() == Some(&target_name)) {
                        
                        // TRUQUE PARA MAC/WINDOWS: Tirar do fullscreen antes de mover para outra tela
                        // evita bugs visuais ou travamentos do sistema operacional.
                        let _ = window.set_fullscreen(false);
                        
                        // Move para as coordenadas do novo monitor
                        let position = monitor.position();
                        let _ = window.set_position(tauri::Position::Physical(*position));
                        
                        // Volta para o fullscreen na tela nova
                        let _ = window.set_fullscreen(true);

                        // Como a janela piscou de uma tela para outra, o SO pode ter roubado o foco.
                        // Devolvemos o foco IMEDIATAMENTE para o app principal.
                        if let Some(main_window) = app.get_webview_window("main") {
                            let _ = main_window.set_focus();
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub fn get_current_projection(
    state: tauri::State<'_, crate::state::app_state::AppState>,
) -> String {
    // Retorna o HTML salvo no estado
    state.get_html()
}

#[tauri::command]
pub fn prepare_projection_window(app: tauri::AppHandle, target_monitor: Option<String>) {
    if let Some(window) = app.get_webview_window("projection") {
        let is_visible = window.is_visible().unwrap_or(false);

        // Só mexe na posição se estiver invisível para não dar um "pulo" na tela do telão
        if !is_visible {
            let _ = window.show();
            let _ = window.unminimize();

            if let Some(monitor_name) = target_monitor {
                if let Ok(monitors) = app.available_monitors() {
                    if let Some(monitor) = monitors
                        .into_iter()
                        .find(|m| m.name() == Some(&monitor_name))
                    {
                        let position = monitor.position();
                        let _ = window.set_position(tauri::Position::Physical(*position));
                    }
                }
            }

            let _ = window.set_fullscreen(true);

            // Devolve o foco para o editor principal imediatamente
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.set_focus();
            }
        }
    }
}

#[tauri::command]
pub fn stop_projection(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("projection") {
        let _ = window.hide(); // Apenas esconde, não destrói!
    }
}
