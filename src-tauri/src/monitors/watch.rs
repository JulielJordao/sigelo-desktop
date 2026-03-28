use crate::monitors::manager::choose_monitor;
use crate::monitors::manager::choose_projection_monitor;
use std::{thread, time::Duration};
use tauri::{AppHandle, Manager};

pub fn reposition_projection(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("projection") {
        if let Some(_monitor) = choose_projection_monitor(app) {
            let _ = window.set_fullscreen(true);
        }
    }
}

pub fn start_monitor_watcher(app: AppHandle) {
    thread::spawn(move || {
        let mut last_count = 0;

        loop {
            if let Ok(monitors) = app.available_monitors() {
                if monitors.len() != last_count {
                    println!("Mudança de monitores detectada");

                    if let Some(monitor) = choose_monitor(&app) {
                        println!("Monitor escolhido: {:?}", monitor.name());
                    }

                    last_count = monitors.len();
                }
            }

            thread::sleep(Duration::from_secs(2));
        }
    });
}
