use tauri::{AppHandle, Emitter };
use tauri_plugin_store::StoreExt;
use serde_json::Value;
use serde::Serialize;

// Estrutura para sincronizar o Play/Pause do Timer
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TimerPlaybackPayload {
    action: String,
    time_remaining: u32,
}

// ==========================================
// COMANDOS DO TIMER
// ==========================================

#[tauri::command]
pub fn save_timer_settings(app: AppHandle, payload: String) -> Result<(), String> {
    let store = app.store("timer_settings.json")
        .map_err(|e| format!("Erro ao abrir store: {}", e))?;
    
    let json_value: Value = serde_json::from_str(&payload)
        .map_err(|e| format!("Erro no parse do JSON: {}", e))?;
    
    store.set("settings", json_value);
    store.save().map_err(|e| format!("Erro ao salvar no disco: {}", e))?;
    
    // Avisa a ProjectionView que o visual/tempo inicial mudou
    app.emit("update-timer-settings", payload)
        .map_err(|e| format!("Erro ao emitir evento: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn load_timer_settings(app: AppHandle) -> Result<String, String> {
    let store = app.store("timer_settings.json")
        .map_err(|e| format!("Erro ao abrir store: {}", e))?;
    
    if let Some(settings) = store.get("settings") {
        Ok(settings.to_string())
    } else {
        Ok("".to_string())
    }
}

#[tauri::command]
pub fn sync_timer_playback(app: AppHandle, action: String, time_remaining: u32) -> Result<(), String> {
    let payload = TimerPlaybackPayload {
        action,
        time_remaining,
    };

    // Dispara para a ProjectionView iniciar a regressiva ou pausar
    app.emit("sync-timer-playback", payload)
        .map_err(|e| format!("Erro ao emitir evento de timer: {}", e))?;
        
    Ok(())
}

