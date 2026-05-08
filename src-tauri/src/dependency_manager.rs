// src/ffmpeg_install.rs
//
// Garante que ffmpeg e ffprobe existam em <app_local_data>/bin/.
// Download assíncrono com progresso reportado via evento Tauri.
//
// Cargo.toml — dependências necessárias:
//   reqwest  = { version = "0.12", features = ["stream"] }
//   tokio    = { version = "1",    features = ["full"] }
//   zip      = "2"
//   tar      = "0.4"
//   xz2      = "0.1"
//   futures-util = "0.3"

use futures_util::StreamExt;
use std::fs;
use std::io::{copy, Cursor};
use std::path::{Path, PathBuf};
use tar::Archive;
use tauri::{AppHandle, Emitter, Manager};
use xz2::read::XzDecoder;
use zip::ZipArchive;

// ─────────────────────────────────────────────────────────────────────────────
// URLs por plataforma
// ─────────────────────────────────────────────────────────────────────────────

// Windows — pacote "essentials" que inclui ffmpeg.exe + ffprobe.exe
const WIN_URL: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

// Linux — tarball estático que inclui ffmpeg + ffprobe
const LINUX_URL: &str =
    "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";

// macOS — evermeet.cx entrega ffmpeg e ffprobe em ZIPs separados
const MAC_FFMPEG_URL: &str = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip";
const MAC_FFPROBE_URL: &str = "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip";

// ─────────────────────────────────────────────────────────────────────────────
// Evento emitido ao frontend durante o download
// ─────────────────────────────────────────────────────────────────────────────

/// Payload do evento "ffmpeg://progress" enviado ao frontend.
/// O frontend pode escutar com:
///   await listen('ffmpeg://progress', (e) => console.log(e.payload))
#[derive(Clone, serde::Serialize)]
pub struct DownloadProgress {
    /// Nome do binário sendo baixado ("ffmpeg" ou "ffprobe")
    pub binary: String,
    /// Bytes já recebidos
    pub received: u64,
    /// Total de bytes (0 se o servidor não enviou Content-Length)
    pub total: u64,
    /// Percentual 0–100 (None se total desconhecido)
    pub percent: Option<u8>,
    /// Mensagem legível ("Baixando ffmpeg… 42%")
    pub message: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Ponto de entrada público
// ─────────────────────────────────────────────────────────────────────────────
pub async fn ensure_binaries(app: &AppHandle) -> Result<(), String> {
    let bin_dir = bin_dir(app)?;
    fs::create_dir_all(&bin_dir).map_err(|e| format!("create_dir_all: {}", e))?;

    let (ffmpeg_name, ffprobe_name) = binary_names();
    let ffmpeg_path = bin_dir.join(ffmpeg_name);
    let ffprobe_path = bin_dir.join(ffprobe_name);

    // Verifica cada binário individualmente — baixa só o que falta
    let need_ffmpeg = !is_executable(&ffmpeg_path);
    let need_ffprobe = !is_executable(&ffprobe_path);

    if !need_ffmpeg && !need_ffprobe {
        eprintln!("[ffmpeg_install] Binários já presentes — nada a fazer.");
        return Ok(());
    }

    eprintln!("[ffmpeg_install] Instalando em {:?}", bin_dir);

    #[cfg(target_os = "macos")]
    {
        // macOS: dois ZIPs separados, um por binário
        if need_ffmpeg {
            download_and_extract_zip(app, MAC_FFMPEG_URL, "ffmpeg", &bin_dir, ffmpeg_name).await?;
        }
        if need_ffprobe {
            download_and_extract_zip(app, MAC_FFPROBE_URL, "ffprobe", &bin_dir, ffprobe_name)
                .await?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: um único ZIP com ambos; extrai apenas os que faltam
        if need_ffmpeg || need_ffprobe {
            let bytes = download_with_progress(app, WIN_URL, "ffmpeg+ffprobe").await?;
            extract_zip_multi(
                &bytes,
                &bin_dir,
                if need_ffmpeg { Some(ffmpeg_name) } else { None },
                if need_ffprobe {
                    Some(ffprobe_name)
                } else {
                    None
                },
            )?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: um único tar.xz com ambos
        if need_ffmpeg || need_ffprobe {
            let bytes = download_with_progress(app, LINUX_URL, "ffmpeg+ffprobe").await?;
            extract_tar_xz_multi(
                &bytes,
                &bin_dir,
                if need_ffmpeg { Some(ffmpeg_name) } else { None },
                if need_ffprobe {
                    Some(ffprobe_name)
                } else {
                    None
                },
            )?;
        }
    }

    // Torna executável em Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for p in [&ffmpeg_path, &ffprobe_path] {
            if p.exists() {
                let mut perms = fs::metadata(p)
                    .map_err(|e| format!("metadata {:?}: {}", p, e))?
                    .permissions();
                perms.set_mode(0o755);
                fs::set_permissions(p, perms)
                    .map_err(|e| format!("set_permissions {:?}: {}", p, e))?;
            }
        }
    }

    // Validação final — garante que os binários existem e são executáveis
    if !is_executable(&ffmpeg_path) {
        return Err(format!(
            "ffmpeg não encontrado após instalação: {:?}\n\
             Tente instalar manualmente via 'brew install ffmpeg' (macOS) \
             ou 'apt install ffmpeg' (Linux).",
            ffmpeg_path
        ));
    }
    if !is_executable(&ffprobe_path) {
        return Err(format!(
            "ffprobe não encontrado após instalação: {:?}",
            ffprobe_path
        ));
    }

    eprintln!("[ffmpeg_install] ✅ Binários prontos em {:?}", bin_dir);
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Download com progresso
// ─────────────────────────────────────────────────────────────────────────────

/// Baixa a URL e retorna os bytes, emitindo eventos de progresso ao frontend.
async fn download_with_progress(
    app: &AppHandle,
    url: &str,
    label: &str,
) -> Result<Vec<u8>, String> {
    eprintln!("[ffmpeg_install] GET {}", url);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Tauri)")
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("reqwest::Client: {}", e))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("GET {}: {}", url, e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} ao baixar {}", response.status(), url));
    }

    let total = response.content_length().unwrap_or(0);
    let mut received: u64 = 0;
    let mut bytes = if total > 0 {
        Vec::with_capacity(total as usize)
    } else {
        Vec::new()
    };

    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("chunk: {}", e))?;
        bytes.extend_from_slice(&chunk);
        received += chunk.len() as u64;

        let percent = if total > 0 {
            Some(((received * 100) / total).min(100) as u8)
        } else {
            None
        };

        let message = if let Some(p) = percent {
            format!("Baixando {}… {}%", label, p)
        } else {
            format!(
                "Baixando {}… {:.1} MB",
                label,
                received as f64 / 1_048_576.0
            )
        };

        // Emite a cada ~1% ou a cada 256 KB para não inundar o frontend
        let should_emit = match percent {
            Some(p) => p % 1 == 0,
            None => received % (256 * 1024) < chunk.len() as u64,
        };

        if should_emit {
            let _ = app.emit(
                "ffmpeg://progress",
                DownloadProgress {
                    binary: label.to_string(),
                    received,
                    total,
                    percent,
                    message,
                },
            );
        }
    }

    // Evento de conclusão
    let _ = app.emit(
        "ffmpeg://progress",
        DownloadProgress {
            binary: label.to_string(),
            received,
            total: received,
            percent: Some(100),
            message: format!(
                "{} baixado ({:.1} MB)",
                label,
                received as f64 / 1_048_576.0
            ),
        },
    );

    Ok(bytes)
}

// ─────────────────────────────────────────────────────────────────────────────
// macOS: ZIP com único binário (evermeet.cx)
// ─────────────────────────────────────────────────────────────────────────────

/// Baixa um ZIP do evermeet.cx que contém exatamente um binário e o extrai.
#[cfg(target_os = "macos")]
async fn download_and_extract_zip(
    app: &AppHandle,
    url: &str,
    label: &str,
    dest: &Path,
    binary_name: &str,
) -> Result<(), String> {
    let bytes = download_with_progress(app, url, label).await?;

    let mut archive = ZipArchive::new(Cursor::new(&bytes))
        .map_err(|e| format!("ZipArchive ({}): {}", label, e))?;

    let mut found = false;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry {}: {}", i, e))?;

        // O ZIP do evermeet contém um único arquivo com o nome do binário
        let entry_name = entry.name().to_string();
        let file_stem = Path::new(&entry_name)
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        // Aceita "ffmpeg", "ffmpeg-7.1", etc.
        if file_stem == binary_name || file_stem.starts_with(binary_name) {
            let target = dest.join(binary_name);
            let mut out =
                fs::File::create(&target).map_err(|e| format!("create {:?}: {}", target, e))?;
            copy(&mut entry, &mut out).map_err(|e| format!("copy {}: {}", label, e))?;
            found = true;
            eprintln!("[ffmpeg_install] Extraído {} → {:?}", entry_name, target);
            break;
        }
    }

    if !found {
        // Fallback: extrai o primeiro arquivo não-diretório
        let mut archive2 = ZipArchive::new(Cursor::new(&bytes))
            .map_err(|e| format!("ZipArchive fallback: {}", e))?;

        for i in 0..archive2.len() {
            let mut entry = archive2
                .by_index(i)
                .map_err(|e| format!("zip entry fallback {}: {}", i, e))?;
            if entry.is_file() {
                let target = dest.join(binary_name);
                let mut out = fs::File::create(&target)
                    .map_err(|e| format!("create fallback {:?}: {}", target, e))?;
                copy(&mut entry, &mut out).map_err(|e| format!("copy fallback: {}", e))?;
                eprintln!("[ffmpeg_install] Extraído (fallback) → {:?}", target);
                break;
            }
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Windows: ZIP com múltiplos binários (gyan.dev)
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn extract_zip_multi(
    bytes: &[u8],
    dest: &Path,
    ffmpeg: Option<&str>,
    ffprobe: Option<&str>,
) -> Result<(), String> {
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("ZipArchive: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry {}: {}", i, e))?;

        let name = entry.name().to_lowercase();

        // gyan.dev: "ffmpeg-N.N-essentials_build/bin/ffmpeg.exe"
        let is_ffmpeg = ffmpeg.map_or(false, |n| name.ends_with(n));
        let is_ffprobe = ffprobe.map_or(false, |n| name.ends_with(n));

        if is_ffmpeg || is_ffprobe {
            let binary_name = if is_ffmpeg {
                ffmpeg.unwrap()
            } else {
                ffprobe.unwrap()
            };
            let target = dest.join(binary_name);
            let mut out =
                fs::File::create(&target).map_err(|e| format!("create {:?}: {}", target, e))?;
            copy(&mut entry, &mut out).map_err(|e| format!("copy {}: {}", binary_name, e))?;
            eprintln!("[ffmpeg_install] Extraído → {:?}", target);
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Linux: tar.xz (johnvansickle.com)
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn extract_tar_xz_multi(
    bytes: &[u8],
    dest: &Path,
    ffmpeg: Option<&str>,
    ffprobe: Option<&str>,
) -> Result<(), String> {
    let dec = XzDecoder::new(Cursor::new(bytes));
    let mut arc = Archive::new(dec);

    for entry in arc.entries().map_err(|e| format!("tar entries: {}", e))? {
        let mut entry = entry.map_err(|e| format!("tar entry: {}", e))?;
        let path = entry
            .path()
            .map_err(|e| format!("tar path: {}", e))?
            .to_path_buf();
        let name = path.to_string_lossy().to_lowercase();

        let is_ffmpeg = ffmpeg.map_or(false, |n| name.ends_with(n));
        let is_ffprobe = ffprobe.map_or(false, |n| name.ends_with(n));

        if is_ffmpeg || is_ffprobe {
            let binary_name = if is_ffmpeg {
                ffmpeg.unwrap()
            } else {
                ffprobe.unwrap()
            };
            let target = dest.join(binary_name);
            entry
                .unpack(&target)
                .map_err(|e| format!("unpack {}: {}", binary_name, e))?;
            eprintln!("[ffmpeg_install] Extraído → {:?}", target);
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|d| d.join("bin"))
        .map_err(|e| format!("app_local_data_dir: {}", e))
}

fn binary_names() -> (&'static str, &'static str) {
    if cfg!(target_os = "windows") {
        ("ffmpeg.exe", "ffprobe.exe")
    } else {
        ("ffmpeg", "ffprobe")
    }
}

/// Retorna true se o arquivo existe e tem tamanho > 0
fn is_executable(path: &Path) -> bool {
    fs::metadata(path).map(|m| m.len() > 0).unwrap_or(false)
}

// ─────────────────────────────────────────────────────────────────────────────
// Comando Tauri exposto ao frontend
// ─────────────────────────────────────────────────────────────────────────────

/// Verifica/instala os binários e retorna o caminho do diretório bin.
/// O frontend pode chamar await invoke('ensure_ffmpeg') na inicialização
/// e escutar 'ffmpeg://progress' para mostrar progresso.
///
/// Exemplo Vue:
/// ```typescript
/// import { invoke }  from '@tauri-apps/api/core';
/// import { listen }  from '@tauri-apps/api/event';
///
/// await listen('ffmpeg://progress', (e) => {
///   console.log(e.payload.message);          // "Baixando ffmpeg… 42%"
///   progressBar.value = e.payload.percent;   // 0–100 | null
/// });
///
/// await invoke('ensure_ffmpeg');
/// ```
#[tauri::command]
pub async fn ensure_ffmpeg(app: AppHandle) -> Result<String, String> {
    ensure_binaries(&app).await?;
    bin_dir(&app).map(|p| p.to_string_lossy().to_string())
}
