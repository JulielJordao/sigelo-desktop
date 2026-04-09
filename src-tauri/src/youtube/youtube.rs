use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::time::SystemTime;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use std::io::{Cursor, Write};
use std::path::{Path};

#[derive(Serialize, Deserialize)]
pub struct RustCachedVideo {
    pub filename: String,
    pub path: String,
    pub size_mb: f64,
    pub modified_at: u64,
    pub duration: f64,
    pub thumbnail_path: String,
}

fn get_youtube_folder(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    // Pega o diretório de dados do app (o mesmo appDataDir() do Vue)
    let app_data = app.path().app_local_data_dir().map_err(|_| "Erro ao obter appData".to_string())?;
    
    let yt_folder = app_data.join("media").join("reproducao").join("YouTube");
    
    if !yt_folder.exists() {
        std::fs::create_dir_all(&yt_folder).map_err(|e| e.to_string())?;
    }
    
    Ok(yt_folder)
}

// 2. Atualizado para ler da pasta correta
#[tauri::command]
pub fn get_cached_videos(app: tauri::AppHandle) -> Result<Vec<RustCachedVideo>, String> {
    // AQUI: Usando a nossa função que aponta para media/reproducao/YouTube
    let cache_dir = get_youtube_folder(&app)?;
    let mut videos = Vec::new();

    if let Ok(entries) = std::fs::read_dir(cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("mp4") {
                let filename = entry.file_name().to_string_lossy().to_string();
                let metadata = entry.metadata().unwrap();
                let size_mb = (metadata.len() as f64) / (1024.0 * 1024.0);

                let modified_at = metadata
                    .modified()
                    .unwrap_or(SystemTime::now())
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;

                // Busca a Duração no arquivo .info.json
                let json_path = path.with_extension("info.json");
                let mut duration = 0.0;
                if let Ok(json_content) = std::fs::read_to_string(&json_path) {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_content) {
                        duration = parsed["duration"].as_f64().unwrap_or(0.0);
                    }
                }

                // Busca a Thumbnail (.jpg, .webp ou .png)
                let mut thumb_path = String::new();
                for ext in ["jpg", "webp", "png"] {
                    let p = path.with_extension(ext);
                    if p.exists() {
                        thumb_path = p.to_string_lossy().to_string();
                        break;
                    }
                }

                videos.push(RustCachedVideo {
                    filename,
                    path: path.to_string_lossy().to_string(),
                    size_mb: (size_mb * 100.0).round() / 100.0,
                    modified_at,
                    duration,
                    thumbnail_path: thumb_path,
                });
            }
        }
    }
    Ok(videos)
}

// 3. Atualizado para deletar o vídeo, a thumb e o json
#[tauri::command]
pub fn delete_cached_video(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    // AQUI: Apontando para a pasta correta
    let cache_dir = get_youtube_folder(&app)?;
    let file_path = cache_dir.join(filename);

    if file_path.exists() {
        // 1. Deleta o vídeo (.mp4)
        std::fs::remove_file(&file_path).map_err(|e| format!("Erro ao deletar vídeo: {}", e))?;

        // 2. Tenta deletar o arquivo de informações (.info.json)
        let json_path = file_path.with_extension("info.json");
        if json_path.exists() {
            let _ = std::fs::remove_file(json_path); // Ignora erro se não existir
        }

        // 3. Tenta deletar a miniatura (testa as 3 extensões possíveis)
        for ext in ["jpg", "webp", "png"] {
            let thumb_path = file_path.with_extension(ext);
            if thumb_path.exists() {
                let _ = std::fs::remove_file(thumb_path); // Ignora erro se não existir
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn check_ytdlp_status(app: tauri::AppHandle) -> Result<bool, String> {
    let exe_path = get_ytdlp_path(&app);
    Ok(std::path::Path::new(&exe_path).exists())
}

#[tauri::command]
pub async fn update_binaries(app: AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|_| "Falha ao obter diretório")?;
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    // 1. ATUALIZAR YT-DLP (Binário direto)
    let (ytdlp_name, ytdlp_url) = if cfg!(target_os = "windows") {
        ("yt-dlp.exe", "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe")
    } else if cfg!(target_os = "macos") {
        ("yt-dlp", "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos")
    } else {
        ("yt-dlp", "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp")
    };

    let ytdlp_path = app_dir.join(ytdlp_name);
    let ytdlp_bytes = download_bytes(ytdlp_url).await?;
    save_file(&ytdlp_path, &ytdlp_bytes)?;
    set_executable_permission(&ytdlp_path);

    // 2. ATUALIZAR FFMPEG (ZIP ou Tar)
    let ffmpeg_url = if cfg!(target_os = "windows") {
        "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    } else if cfg!(target_os = "macos") {
        "https://evermeet.cx/ffmpeg/getrelease/zip"
    } else {
        "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
    };

    let ffmpeg_exe_name = if cfg!(target_os = "windows") { "ffmpeg.exe" } else { "ffmpeg" };
    let ffmpeg_path = app_dir.join(ffmpeg_exe_name);

    if cfg!(any(target_os = "windows", target_os = "macos")) {
        // Baixa o ZIP e extrai apenas o executável do FFmpeg
        let zip_bytes = download_bytes(ffmpeg_url).await?;
        extract_ffmpeg_from_zip(&zip_bytes, &ffmpeg_path)?;
    } else {
        // No Linux (simplificado para o seu caso de uso)
        let bytes = download_bytes(ffmpeg_url).await?;
        save_file(&ffmpeg_path, &bytes)?;
    }

    set_executable_permission(&ffmpeg_path);

    Ok("Motores atualizados com sucesso!".to_string())
}

// --- FUNÇÕES AUXILIARES ---

async fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let response = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}

fn save_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    Ok(())
}

fn extract_ffmpeg_from_zip(zip_bytes: &[u8], dest_path: &Path) -> Result<(), String> {
    let reader = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        
        // Procuramos um arquivo que termine com 'ffmpeg' ou 'ffmpeg.exe' dentro do zip
        if file.name().ends_with("ffmpeg") || file.name().ends_with("ffmpeg.exe") {
            let mut out_file = fs::File::create(dest_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut out_file).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("FFmpeg não encontrado dentro do arquivo ZIP".to_string())
}

fn set_executable_permission(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(path) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

// 2. Função auxiliar para pegar o caminho do yt-dlp baixado
fn get_ytdlp_path(app: &AppHandle) -> String {
    let app_dir = app.path().app_local_data_dir().unwrap();
    let file_name = if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    app_dir.join(file_name).to_string_lossy().to_string()
}

// 3. Função para buscar título e miniatura
#[tauri::command]
pub async fn get_youtube_info(app: AppHandle, url: String) -> Result<serde_json::Value, String> {
    // Pega o caminho dinâmico do executável
    let exe_path = get_ytdlp_path(&app);

    // Usa .command(exe_path) no lugar de .sidecar()
    let cmd = app
        .shell()
        .command(exe_path)
        .args(["--dump-json", "--no-playlist", &url]);

    let output = cmd.output().await.map_err(|e| e.to_string())?;

    if output.status.success() {
        let json_str = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value =
            serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

        Ok(json!({
            "title": parsed["title"],
            "thumbnail": parsed["thumbnail"]
        }))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// 4. Função para baixar o vídeo de fato
#[tauri::command]
pub async fn cache_youtube_video(app: tauri::AppHandle, url: String, quality: String) -> Result<String, String> {
    // 1. Caminhos das pastas
    let yt_folder = get_youtube_folder(&app)?;
    let app_dir = app.path().app_local_data_dir().map_err(|_| "Erro app_dir")?;
    let exe_path = get_ytdlp_path(&app);
    
    // O template de saída (Pasta YouTube / ID do video . extensão)
    let output_template = yt_folder.join("%(id)s.%(ext)s");

    // 2. Lógica de Qualidade com FFmpeg (Agora permitindo união de trilhas separadas)
    // Buscamos o melhor MP4 + melhor M4A para garantir compatibilidade Apple
    let format_arg = match quality.as_str() {
        "Lowest" => "worstvideo[ext=mp4]+worstaudio[ext=m4a]/worst[ext=mp4]",
        "Medium" => "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]",
        _ => "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]", // 
        "Highest" => "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]",
        _ => "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]",
    };

    let cmd = app.shell().command(exe_path)
        .args([
            "-f", format_arg,
            "--ffmpeg-location", &app_dir.to_string_lossy(),
            "--merge-output-format", "mp4",
            "--no-playlist",
            "--write-info-json", 
            "--write-thumbnail", 
            "-o", &output_template.to_string_lossy(),
            "--print", "after_move:filepath",
            &url
        ]);
        
    let output = cmd.output().await.map_err(|e| e.to_string())?;

    if output.status.success() {
        let file_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(file_path)
    } else {
        let error_msg = String::from_utf8_lossy(&output.stderr);
        Err(format!("Erro no download/processamento: {}", error_msg))
    }
}
// NOVO: Comando para abrir a pasta de cache no sistema operacional
#[tauri::command]
pub fn open_youtube_cache_folder(app: tauri::AppHandle) -> Result<(), String> {
    
   let youtube_dir = get_youtube_folder(&app)?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&youtube_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&youtube_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&youtube_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
