use tauri::{AppHandle, Manager, Monitor};

use serde::{Deserialize, Serialize};

use crate::monitors::detector::detect_projector;
use crate::state::app_state::AppState;

pub fn choose_monitor(app: &AppHandle) -> Option<Monitor> {
    let state: tauri::State<AppState> = app.state();
    let pref = state.monitor_preference.lock().unwrap().clone();

    let monitors = app.available_monitors().ok()?;

    match pref {
        MonitorPreference::Auto => detect_projector(app),

        MonitorPreference::Monitor(index) => monitors.get(index).cloned(),
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub enum MonitorPreference {
    Auto,
    Monitor(usize),
}

pub fn choose_projection_monitor(app: &AppHandle) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;

    if monitors.is_empty() {
        return None;
    }

    // caso ideal: dois monitores
    if monitors.len() > 1 {
        return Some(monitors[1].clone());
    }

    // fallback: usar o primário
    app.primary_monitor().ok().flatten()
}
