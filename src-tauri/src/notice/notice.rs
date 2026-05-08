// Adicione as importações necessárias no topo
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")] // Para o JSON bater com as variáveis do frontend
struct PlaybackPayload {
    action: String,
    is_active: bool,
    is_paused: bool,
}

// ==========================================
// 1. COMANDO DE SALVAR (E AVISAR A PROJEÇÃO)
// ==========================================
#[tauri::command]
pub fn save_notice_settings(app: AppHandle, payload: String) -> Result<(), String> {
    // Acessa (ou cria) o arquivo de configuração
    let store = app
        .store("notice_settings.json")
        .map_err(|e| format!("Erro ao abrir store: {}", e))?;

    // Converte a string do Vue para um objeto JSON real do Rust
    let json_value: Value =
        serde_json::from_str(&payload).map_err(|e| format!("Erro no parse do JSON: {}", e))?;

    // Salva no banco e escreve no disco
    store.set("settings", json_value);
    store
        .save()
        .map_err(|e| format!("Erro ao salvar no disco: {}", e))?;

    // ==========================================
    // O PULO DO GATO:
    // Dispara o evento para todas as janelas (incluindo a ProjectionView)
    // avisando que o formato ou o texto mudou!
    // ==========================================
    app.emit("update-notice-settings", payload)
        .map_err(|e| format!("Erro ao emitir evento: {}", e))?;

    Ok(())
}

// ==========================================
// 2. COMANDO DE CARREGAR (Ao abrir o app)
// ==========================================
#[tauri::command]
pub fn load_notice_settings(app: AppHandle) -> Result<String, String> {
    let store = app
        .store("notice_settings.json")
        .map_err(|e| format!("Erro ao abrir store: {}", e))?;

    // Procura a chave "settings". Se existir, devolve como String para o Vue
    if let Some(settings) = store.get("settings") {
        Ok(settings.to_string())
    } else {
        Ok("".to_string()) // Retorna vazio se for o primeiro uso do app
    }
}

// ==========================================
// 3. COMANDO DE SINCRONIZAÇÃO DE TEMPO REAL
// ==========================================
#[tauri::command]
pub fn sync_notice_playback(
    app: AppHandle,
    action: String,
    is_active: bool,
    is_paused: bool,
) -> Result<(), String> {
    let payload = PlaybackPayload {
        action,
        is_active,
        is_paused,
    };

    // Avisa a ProjectionView para dar play, pause ou stop na animação
    app.emit("sync-notice-playback", payload)
        .map_err(|e| format!("Erro ao emitir evento de playback: {}", e))?;

    Ok(())
}
