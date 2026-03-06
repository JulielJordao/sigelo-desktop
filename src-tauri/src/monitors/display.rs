use tauri::{AppHandle, Manager};
use serde::Serialize;

// 1. Estrutura para formatar os dados e enviar ao Vue (JavaScript)
#[derive(Serialize)]
pub struct MonitorInfo {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

// 2. Comando para buscar todos os monitores
#[tauri::command]
pub fn get_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let mut result = Vec::new();
    
    // Pega o nome do monitor primário para comparação
    let primary_name = app.primary_monitor()
        .ok().flatten()
        .and_then(|m| m.name().map(|n| n.to_string()));

    let monitors = app.available_monitors().map_err(|e| e.to_string())?;

    for monitor in monitors {
        if let Some(name) = monitor.name() {
            let size = monitor.size();
            let is_primary = Some(name.to_string()) == primary_name;
            
            result.push(MonitorInfo {
                name: name.to_string(),
                width: size.width,
                height: size.height,
                is_primary,
            });
        }
    }

    Ok(result)
}