use crate::state::app_state::AppState;
use tauri::{AppHandle, Emitter, Manager};

pub fn render_html(app: &AppHandle, html: String) {
    let state: tauri::State<AppState> = app.state();

    // salva no estado
    state.set_html(html.clone());

    // envia evento para a janela de projeção
    let _ = app.emit("update-projection", html);
}
