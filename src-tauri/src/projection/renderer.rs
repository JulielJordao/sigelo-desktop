use tauri::{AppHandle, Manager, Emitter};
use crate::state::app_state::AppState;

pub fn render_html(app: &AppHandle, html: String) {
    let state: tauri::State<AppState> = app.state();

    // salva no estado
    state.set_html(html.clone());

    // envia evento para a janela de projeção
    if let Some(window) = app.get_webview_window("projection") {
        let _ = window.emit("update-projection", html);
    }
}