use crate::projection::renderer::render_html;
use tauri::AppHandle;

#[tauri::command]
pub fn update_projection(app: AppHandle, html: String) {
    render_html(&app, html);
}
