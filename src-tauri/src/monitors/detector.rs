use tauri::{AppHandle, Manager, Monitor};

pub fn detect_projector(app: &AppHandle) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    let primary = app.primary_monitor().ok().flatten();

    let mut best_monitor: Option<Monitor> = None;
    let mut best_score = 0;

    for monitor in monitors {
        let mut score = 0;

        // nome do monitor
        if let Some(name) = monitor.name() {
            let name_lower = name.to_lowercase();

            if name_lower.contains("epson")
                || name_lower.contains("benq")
                || name_lower.contains("lg")
                || name_lower.contains("samsung")
                || name_lower.contains("projector")
            {
                score += 50;
            }

            if name_lower.contains("hdmi")
                || name_lower.contains("displayport")
                || name_lower.contains("dp")
            {
                score += 20;
            }
        }

        // resolução maior
        let size = monitor.size();
        let pixels = size.width * size.height;
        score += (pixels / 1_000_000) as i32 * 5;

        // não é primário
        if let Some(primary_monitor) = &primary {
            if monitor.name() != primary_monitor.name() {
                score += 15;
            }
        }

        if score > best_score {
            best_score = score;
            best_monitor = Some(monitor);
        }
    }

    best_monitor
}