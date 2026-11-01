use crate::projection::renderer::render_html;
use tauri::{AppHandle, Manager, Position}; // Mantemos o import para usar a função mais abaixo

/// O Sigelo (janela principal) está em primeiro plano agora?
/// Só devolvemos o foco a ele quando ele já o tinha: se o operador está em
/// outro programa (ex.: usando o controle remoto pelo celular), o Sigelo não
/// deve pular para a frente a cada slide.
fn main_has_focus(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false)
}

fn restore_main_focus(app: &AppHandle, had_focus: bool) {
    if !had_focus {
        return;
    }
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.set_focus();
    }
}

#[tauri::command]
pub fn update_projection(app: AppHandle, html: String, target_monitor: Option<String>) {
    // 1. Atualiza o conteúdo HTML
    render_html(&app, html);

    let main_had_focus = main_has_focus(&app);

    // 2. Manipulação da janela — só quando algo precisa mudar. Antes isto
    //    rodava a cada slide (fullscreen + set_focus), roubando o foco.
    if let Some(window) = app.get_webview_window("projection") {
        let is_visible = window.is_visible().unwrap_or(false);

        // A. Garante que a janela está visível
        if !is_visible {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_fullscreen(true);

            // Devolve o foco ao principal ao abrir pela primeira vez
            restore_main_focus(&app, main_had_focus);
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
                    if let Some(monitor) = monitors
                        .into_iter()
                        .find(|m| m.name() == Some(&target_name))
                    {
                        let _ = window.set_fullscreen(false);

                        let position = monitor.position();
                        let _ = window.set_position(Position::Physical(*position));
                    }
                }
            }

            // --- LÓGICA CONDICIONAL DE FULLSCREEN ---
            // Só reaplica se mudou de monitor ou se o estado da janela não é o
            // esperado (ex.: o usuário saiu do fullscreen) — não a cada slide.
            let is_fullscreen = window.is_fullscreen().unwrap_or(false);
            if is_same_as_main {
                // Se for a mesma tela do controle, apenas maximiza (Modo Janela Segura)
                // Isso evita o "sequestro" e permite usar Alt+Tab ou a barra de tarefas facilmente
                let is_maximized = window.is_maximized().unwrap_or(false);
                if needs_move || is_fullscreen || !is_maximized {
                    let _ = window.set_fullscreen(false);
                    let _ = window.maximize();
                }
            } else if needs_move || !is_fullscreen {
                // Se for uma tela separada, força o Fullscreen verdadeiro
                let _ = window.set_fullscreen(true);

                // Só devolve o foco se o Sigelo já estava em primeiro plano.
                restore_main_focus(&app, main_had_focus);
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
pub fn toggle_projection_visibility(app: AppHandle, window_label: Option<String>) -> bool {
    let label = window_label.unwrap_or_else(|| "projection".to_string());

    let Some(window) = app.get_webview_window(&label) else {
        return false;
    };

    let is_visible = window.is_visible().unwrap_or(false);
    let is_minimized = window.is_minimized().unwrap_or(false);
    let main_had_focus = main_has_focus(&app);

    if is_visible && !is_minimized {
        #[cfg(target_os = "macos")]
        {
            let _ = window.set_fullscreen(false);
            let _ = window.hide();
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = window.minimize();
        }
        false
    } else {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_fullscreen(true);

        restore_main_focus(&app, main_had_focus);
        true
    }
}

#[tauri::command]
pub fn prepare_projection_window(
    app: tauri::AppHandle,
    target_monitor: Option<String>,
    window_label: Option<String>, // ← ADICIONADO
) {
    let label = window_label.unwrap_or_else(|| "projection".to_string());

    let main_had_focus = main_has_focus(&app);

    if let Some(window) = app.get_webview_window(&label) {
        let is_visible = window.is_visible().unwrap_or(false);

        // Só mexe na posição se estiver invisível para não dar um "pulo" na tela
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

            // Devolve o foco para o editor principal (se ele estava em primeiro plano)
            restore_main_focus(&app, main_had_focus);
        }
    }
}

#[tauri::command]
pub fn close_stage_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("stage") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn stop_projection(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("projection") {
        let _ = window.hide(); // Apenas esconde, não destrói!
    }
}
