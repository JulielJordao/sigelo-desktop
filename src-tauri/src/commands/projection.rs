use crate::projection::renderer::render_html;
use tauri::{AppHandle, Manager, Position}; // Mantemos o import para usar a função mais abaixo

#[tauri::command]
pub fn update_projection(app: AppHandle, html: String, target_monitor: Option<String>) {
    // 1. Atualiza o conteúdo HTML
    render_html(&app, html);

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

            if let Ok(Some(current_monitor)) = window.current_monitor() {
                if current_monitor.name() != Some(&target_name) {
                    needs_move = true;
                }
            } else {
                needs_move = true; 
            }

            // --- NOVA TRAVA DE SEGURANÇA ---
            // Descobre se o monitor alvo é exatamente o mesmo onde o controle "main" está aberto
            let mut is_same_as_main = false;
            if let Some(main_window) = app.get_webview_window("main") {
                if let Ok(Some(main_mon)) = main_window.current_monitor() {
                    if main_mon.name() == Some(&target_name) {
                        is_same_as_main = true;
                    }
                }
            }

            // Se o monitor mudou, faz a realocação
            if needs_move {
                if let Ok(monitors) = app.available_monitors() {
                    if let Some(monitor) = monitors.into_iter().find(|m| m.name() == Some(&target_name)) {
                        let _ = window.set_fullscreen(false);
                        
                        let position = monitor.position();
                        let _ = window.set_position(Position::Physical(*position));
                    }
                }
            }

            // --- LÓGICA CONDICIONAL DE FULLSCREEN ---
            if is_same_as_main {
                // Se for a mesma tela do controle, apenas maximiza (Modo Janela Segura)
                // Isso evita o "sequestro" e permite usar Alt+Tab ou a barra de tarefas facilmente
                let _ = window.set_fullscreen(false);
                let _ = window.maximize();
            } else {
                // Se for uma tela separada, força o Fullscreen verdadeiro
                let _ = window.set_fullscreen(true);
                
                // Só tentamos roubar o foco de volta se a projeção estiver em OUTRA tela.
                // Tentar roubar o foco de uma janela fullscreen na MESMA tela do Windows não funciona.
                if let Some(main_window) = app.get_webview_window("main") {
                    let _ = main_window.set_focus();
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
