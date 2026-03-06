use std::sync::Mutex;
use crate::monitors::manager::MonitorPreference;

#[derive(Default)]
pub struct AppState {
    pub projection_html: Mutex<String>,
    pub monitor_preference: Mutex<MonitorPreference>
}

impl Default for MonitorPreference {
    fn default() -> Self {
        MonitorPreference::Auto
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            projection_html: Mutex::new(String::new()),
            monitor_preference: Mutex::new(MonitorPreference::Auto)
        }
    }

    pub fn set_html(&self, html: String) {
        let mut content = self.projection_html.lock().unwrap();
        *content = html;
    }

    pub fn get_html(&self) -> String {
        let content = self.projection_html.lock().unwrap();
        content.clone()
    }
}