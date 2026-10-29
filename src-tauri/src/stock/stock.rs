// src-tauri/src/stock/stock.rs
//
// Download de fundos do banco de imagens (Pixabay) para media/slides.
//
// - Só aceita https de cdn.pixabay.com / pixabay.com (nada de baixar de
//   qualquer endereço vindo do frontend).
// - Grava em "<nome>.<ext>.part" e só renomeia no fim: um download
//   interrompido nunca vira um fundo quebrado (e o .part é recolhido pelo
//   "Limpar cache" → Arquivos temporários).
// - Salva "<nome>.info.json" com o crédito (autor, link, origem).
// - Progresso de 0 a 100 pelo Channel do Tauri (sem precisar de evento global).
// - Se o arquivo já existe, não baixa de novo.

use futures_util::StreamExt;
use std::path::PathBuf;
use tauri::{ipc::Channel, AppHandle, Manager};
use tokio::io::AsyncWriteExt;

const ALLOWED_HOSTS: &[&str] = &["cdn.pixabay.com", "pixabay.com"];
const ALLOWED_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "mp4", "webm"];
const MAX_BYTES: u64 = 600 * 1024 * 1024;
const MAX_CREDIT_BYTES: usize = 20_000;

/// Nome de arquivo seguro: sem barras, sem caracteres reservados do Windows.
fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || " -_().,".contains(c) { c } else { ' ' })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = collapsed
        .trim_matches(|c: char| c == '.' || c == ' ')
        .chars()
        .take(80)
        .collect();
    let trimmed = trimmed.trim().to_string();
    if trimmed.is_empty() {
        "Fundo Pixabay".to_string()
    } else {
        trimmed
    }
}

fn slides_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir: {}", e))?
        .join("media")
        .join("slides"))
}

#[tauri::command]
pub async fn download_stock_background(
    app: AppHandle,
    url: String,
    file_name: String,
    credit: String,
    on_progress: Channel<u32>,
) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Endereço de download inválido.")?;
    let host_ok = parsed
        .host_str()
        .map(|h| ALLOWED_HOSTS.contains(&h))
        .unwrap_or(false);
    if parsed.scheme() != "https" || !host_ok {
        return Err("Só é permitido baixar fundos do Pixabay.".into());
    }

    let ext = parsed
        .path()
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();
    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(format!("Tipo de arquivo não suportado: .{}", ext));
    }

    let dir = slides_dir(&app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Não foi possível criar a pasta de fundos: {}", e))?;

    let stem = sanitize_name(&file_name);
    let final_path = dir.join(format!("{}.{}", stem, ext));
    let tmp_path = dir.join(format!("{}.{}.part", stem, ext));
    let info_path = dir.join(format!("{}.info.json", stem));

    // Já baixado antes: só devolve o caminho
    if tokio::fs::try_exists(&final_path).await.unwrap_or(false) {
        let _ = on_progress.send(100);
        return Ok(final_path.to_string_lossy().to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Sigelo")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("Falha no download: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("O Pixabay respondeu {} ao baixar o arquivo.", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    if total > MAX_BYTES {
        return Err("Arquivo grande demais para um fundo.".into());
    }

    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("Não foi possível gravar o arquivo: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut done: u64 = 0;
    let mut last_pct: u32 = 0;
    let mut failure: Option<String> = None;

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                failure = Some(format!("A conexão caiu durante o download: {}", e));
                break;
            }
        };
        done += chunk.len() as u64;
        if done > MAX_BYTES {
            failure = Some("Arquivo grande demais para um fundo.".into());
            break;
        }
        if let Err(e) = file.write_all(&chunk).await {
            failure = Some(format!("Erro ao gravar no disco: {}", e));
            break;
        }
        if total > 0 {
            let pct = ((done * 100) / total).min(99) as u32;
            if pct != last_pct {
                last_pct = pct;
                let _ = on_progress.send(pct);
            }
        }
    }

    if failure.is_none() {
        if let Err(e) = file.flush().await {
            failure = Some(format!("Erro ao gravar no disco: {}", e));
        }
    }
    drop(file);

    if let Some(msg) = failure {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(msg);
    }

    tokio::fs::rename(&tmp_path, &final_path)
        .await
        .map_err(|e| format!("Erro ao finalizar o arquivo: {}", e))?;

    // Crédito do autor ao lado do arquivo (só se for um JSON válido e pequeno)
    if credit.len() <= MAX_CREDIT_BYTES && serde_json::from_str::<serde_json::Value>(&credit).is_ok() {
        let _ = tokio::fs::write(&info_path, credit).await;
    }

    let _ = on_progress.send(100);
    Ok(final_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::sanitize_name;

    #[test]
    fn nomes_seguros() {
        assert_eq!(sanitize_name("Céu, Nuvens - Pixabay 123"), "Céu, Nuvens - Pixabay 123");
        assert_eq!(sanitize_name("../../etc/passwd"), "etc passwd");
        assert_eq!(sanitize_name("a<b>c:d\"e|f?g*h"), "a b c d e f g h");
        assert_eq!(sanitize_name("   "), "Fundo Pixabay");
        assert_eq!(sanitize_name("...."), "Fundo Pixabay");
    }
}
