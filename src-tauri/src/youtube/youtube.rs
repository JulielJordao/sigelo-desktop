use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::{Cursor, Write};
use std::path::Path;
use std::time::SystemTime;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

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
    let app_data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Erro ao obter appData".to_string())?;
    let yt_folder = app_data.join("media").join("reproducao").join("YouTube");

    if !yt_folder.exists() {
        std::fs::create_dir_all(&yt_folder).map_err(|e| e.to_string())?;
    }

    Ok(yt_folder)
}

#[tauri::command]
pub fn get_cached_videos(app: tauri::AppHandle) -> Result<Vec<RustCachedVideo>, String> {
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

                let json_path = path.with_extension("info.json");
                let mut duration = 0.0;
                if let Ok(json_content) = std::fs::read_to_string(&json_path) {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_content) {
                        duration = parsed["duration"].as_f64().unwrap_or(0.0);
                    }
                }

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

#[tauri::command]
pub fn delete_cached_video(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let cache_dir = get_youtube_folder(&app)?;
    let file_path = cache_dir.join(filename);

    if file_path.exists() {
        std::fs::remove_file(&file_path).map_err(|e| format!("Erro ao deletar vídeo: {}", e))?;

        let json_path = file_path.with_extension("info.json");
        if json_path.exists() {
            let _ = std::fs::remove_file(json_path);
        }

        for ext in ["jpg", "webp", "png"] {
            let thumb_path = file_path.with_extension(ext);
            if thumb_path.exists() {
                let _ = std::fs::remove_file(thumb_path);
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
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Falha ao obter diretório AppLocalData")?;
    let bin_dir = app_dir.join("bin");

    if !bin_dir.exists() {
        fs::create_dir_all(&bin_dir).map_err(|e| format!("Erro ao criar pasta bin: {}", e))?;
    }

    // 1. ATUALIZAR YT-DLP
    let (ytdlp_name, ytdlp_url) = if cfg!(target_os = "windows") {
        (
            "yt-dlp.exe",
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
        )
    } else if cfg!(target_os = "macos") {
        (
            "yt-dlp",
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
        )
    } else {
        (
            "yt-dlp",
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
        )
    };

    let ytdlp_path = bin_dir.join(ytdlp_name);
    let ytdlp_bytes = download_bytes(ytdlp_url).await?;
    save_file(&ytdlp_path, &ytdlp_bytes)?;
    set_executable_permission(&ytdlp_path);

    // 2. ATUALIZAR FFMPEG
    let ffmpeg_url = if cfg!(target_os = "windows") {
        "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    } else if cfg!(target_os = "macos") {
        "https://evermeet.cx/ffmpeg/getrelease/zip"
    } else {
        "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
    };

    let ffmpeg_exe_name = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let ffmpeg_path = bin_dir.join(ffmpeg_exe_name);

    if cfg!(any(target_os = "windows", target_os = "macos")) {
        let zip_bytes = download_bytes(ffmpeg_url).await?;
        extract_file_from_zip(&zip_bytes, &ffmpeg_path, "ffmpeg")?;
    } else {
        let bytes = download_bytes(ffmpeg_url).await?;
        save_file(&ffmpeg_path, &bytes)?;
    }
    set_executable_permission(&ffmpeg_path);

    // 3. ATUALIZAR DENO (NOVO - MOTOR JAVASCRIPT)
    let deno_url = if cfg!(target_os = "windows") {
        "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip"
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip"
        } else {
            "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip"
        }
    } else {
        "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip"
    };

    let deno_exe_name = if cfg!(target_os = "windows") {
        "deno.exe"
    } else {
        "deno"
    };
    let deno_path = bin_dir.join(deno_exe_name);

    let deno_zip_bytes = download_bytes(deno_url).await?;
    extract_file_from_zip(&deno_zip_bytes, &deno_path, "deno")?;
    set_executable_permission(&deno_path);

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

// Função de extração atualizada para servir tanto pro FFmpeg quanto pro Deno
fn extract_file_from_zip(
    zip_bytes: &[u8],
    dest_path: &Path,
    target_name: &str,
) -> Result<(), String> {
    let reader = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;

        // Verifica se o nome do arquivo termina com o target (ex: 'ffmpeg.exe' ou 'deno')
        if file.name().ends_with(target_name)
            || file.name().ends_with(&format!("{}.exe", target_name))
        {
            let mut out_file = fs::File::create(dest_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut out_file).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err(format!(
        "{} não encontrado dentro do arquivo ZIP",
        target_name
    ))
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

fn get_ytdlp_path(app: &AppHandle) -> String {
    let app_dir = app.path().app_local_data_dir().unwrap();
    let bin_dir = app_dir.join("bin");
    let file_name = if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    bin_dir.join(file_name).to_string_lossy().to_string()
}

// --- COMANDOS YOUTUBE ---

#[tauri::command]
pub async fn get_youtube_info(app: AppHandle, url: String) -> Result<serde_json::Value, String> {
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Erro app_dir")?;
    let exe_path = get_ytdlp_path(&app);

    // Configura o caminho do Deno para buscar a info também
    let bin_dir = app_dir.join("bin");
    let deno_exe = if cfg!(target_os = "windows") {
        "deno.exe"
    } else {
        "deno"
    };
    let deno_path = bin_dir.join(deno_exe);

    // Usando Vec<String> para montar os comandos dinamicamente
    let args = vec![
        "--dump-json".to_string(),
        "--no-playlist".to_string(),
        "--js-runtimes".to_string(),
        deno_path.to_string_lossy().to_string(),
        url,
    ];

    let cmd = app.shell().command(exe_path).args(args);
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

fn extract_percentage(line: &str) -> Option<f64> {
    let re = regex::Regex::new(r"(\d+(?:\.\d+)?)%").ok()?;

    let caps = re.captures(line)?;

    caps.get(1)?.as_str().parse::<f64>().ok()
}

#[tauri::command]
pub async fn cache_youtube_video(
    app: tauri::AppHandle,
    url: String,
    quality: String,
    browser: Option<String>,
) -> Result<String, String> {
    let yt_folder = get_youtube_folder(&app)?;
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Erro app_dir")?;
    let exe_path = get_ytdlp_path(&app);

    let bin_dir = app_dir.join("bin");

    let deno_exe = if cfg!(target_os = "windows") {
        "deno.exe"
    } else {
        "deno"
    };

    let deno_path = bin_dir.join(deno_exe);

    let output_template = yt_folder.join("%(id)s.%(ext)s");

    let format_arg = match quality.as_str() {
        "Lowest" => "worst",
        "Medium" => "bv*[height<=720]+ba/b[height<=720]",
        "Highest" => "bv*[ext=mp4]+ba[ext=m4a]/b",
        _ => "bv*+ba/b",
    };

    let mut args = vec![
        "-f".to_string(),
        format_arg.to_string(),
        "--newline".to_string(),
        "--progress".to_string(),
        "--ffmpeg-location".to_string(),
        bin_dir.to_string_lossy().to_string(),
        "--js-runtimes".to_string(),
        deno_path.to_string_lossy().to_string(),
        "--no-playlist".to_string(),
        "--write-info-json".to_string(),
        "--write-thumbnail".to_string(),
        "-o".to_string(),
        output_template.to_string_lossy().to_string(),
        "--print".to_string(),
        "after_move:filepath".to_string(),
    ];

    if let Some(browser_name) = browser {
        args.push("--cookies-from-browser".to_string());
        args.push(browser_name);

        args.push("--extractor-args".to_string());
        args.push("youtube:player_client=web,android".to_string());
    }

    args.push(url);

    app.emit("youtube-download-started", true).unwrap();

    let (mut rx, mut child) = app
        .shell()
        .command(exe_path)
        .args(args)
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut final_path = String::new();

    while let Some(event) = rx.recv().await {
        match event {
            tauri_plugin_shell::process::CommandEvent::Stdout(line_bytes) => {
                let line = String::from_utf8_lossy(&line_bytes);

                println!("{}", line);

                // progresso
                if line.contains("%") {
                    if let Some(percent) = extract_percentage(&line) {
                        app.emit("youtube-download-progress", percent).unwrap();
                    }
                }

                // caminho final
                if line.contains(".mp4") || line.contains(".webm") || line.contains(".mkv") {
                    final_path = line.trim().to_string();
                }
            }

            tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                if payload.code == Some(0) {
                    app.emit("youtube-download-finished", final_path.clone())
                        .unwrap();

                    return Ok(final_path);
                } else {
                    app.emit("youtube-download-error", "Falha no download")
                        .unwrap();

                    return Err("Erro no download".into());
                }
            }

            _ => {}
        }
    }

    Err("Processo interrompido".into())
}

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
