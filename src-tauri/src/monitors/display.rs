use tauri::{AppHandle, Manager};

pub fn get_monitors(app: &AppHandle) {
    if let Ok(monitors) = app.available_monitors() {
        for monitor in monitors {
            println!("Monitor {:?}", monitor.name());
            println!("Resolução {:?}", monitor.size());
        }
    }
}