use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use serde::Deserialize;

// A chave injetada no build (32 caracteres/bytes)
const ENCRYPTION_KEY: Option<&'static str> = option_env!("SIGELO_DECRYPT_KEY");

#[derive(Deserialize)]
struct EncryptedResponse {
    iv: String,
    authTag: String,
    data: String,
}

#[tauri::command]
pub async fn get_offline_lyrics_safe(group_id: String) -> Result<serde_json::Value, String> {
    let url_base = if cfg!(debug_assertions) {
        "http://localhost:3000"
    } else {
        "https://meu-app-backend-f9867824586e.herokuapp.com"
    };

    let url = format!(
        "{}/{}/{}",
        url_base, "api/songGroup/getOfflineLyric", group_id
    );

    // 1. Faz o Fetch da rota criptografada
    let response = reqwest::get(url)
        .await
        .map_err(|e| e.to_string())?
        .json::<EncryptedResponse>()
        .await
        .map_err(|e| e.to_string())?;

    // 2. Prepara a chave (32 bytes)
    let key_str = ENCRYPTION_KEY.ok_or("Chave de criptografia não encontrada no binário")?;
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(key_str.as_bytes());
    let cipher = Aes256Gcm::new(key);

    // 3. Converte Hex para Bytes (IV e Tag)
    let iv_bytes = hex::decode(response.iv).map_err(|_| "IV inválido")?;
    let tag_bytes = hex::decode(response.authTag).map_err(|_| "Tag inválida")?;
    let encrypted_bytes = hex::decode(response.data).map_err(|_| "Dados corrompidos")?;

    let nonce = Nonce::from_slice(&iv_bytes);

    // No aes-gcm do Rust, a Tag deve ser anexada ao final dos dados criptografados para abrir
    let mut combined_data = encrypted_bytes;
    combined_data.extend_from_slice(&tag_bytes);

    // 4. Descriptografa
    let decrypted_bytes = cipher
        .decrypt(nonce, combined_data.as_slice())
        .map_err(|_| "Falha na descriptografia (Chave incorreta ou dados alterados)")?;

    let decrypted_str = String::from_utf8(decrypted_bytes).map_err(|_| "UTF8 inválido")?;

    // 5. Retorna como JSON para o Vue
    let json: serde_json::Value =
        serde_json::from_str(&decrypted_str).map_err(|e| e.to_string())?;
    Ok(json)
}
