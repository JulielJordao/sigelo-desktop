use tauri::AppHandle;
use crate::projection::renderer::render_html;

#[tauri::command]
pub fn update_projection(app: AppHandle, html: String) {
    render_html(&app, html);
}