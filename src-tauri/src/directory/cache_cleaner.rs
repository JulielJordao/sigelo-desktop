// src-tauri/src/directory/cache_cleaner.rs
//
// Limpeza seletiva do cache do Sigelo.
//
// O frontend só envia os IDs das categorias — NUNCA caminhos. Todos os
// caminhos são montados aqui a partir das pastas do app, então nenhuma chamada
// consegue apagar algo fora delas. Mídias do usuário (imagens, vídeos
// importados) e arquivos de configuração (settings.json, user.json,
// programacoes.json, presets.json...) não pertencem a nenhuma categoria e
// nunca são tocados.
//
// Categorias:
//   temp        sobras de downloads/extrações interrompidas (.part, .ytdl,
//               .fNNN.mp4 do yt-dlp, .m4a.part) + qualquer outro arquivo em
//               cache/ que não seja fonte
//   orphans     .m4a / .info.json / miniatura do YouTube cujo vídeo não existe mais
//   audio       .m4a extraído de um vídeo que ainda existe (é recriado depois)
//   youtube     vídeos baixados do YouTube + .info.json + miniatura (+ o .m4a
//               deles, quando a categoria é limpa)
//   songs       letras offline (cacheSongs.bin + updateGroupSong.json).
//               Só o TAMANHO é calculado aqui; a limpeza é feita pelo
//               songCacheStore, porque o plugin-store mantém esses arquivos
//               abertos e regravaria o conteúdo se fossem apagados por baixo.
//   fonts       fontes importadas (cache/fonts)
//   components  bin/ (ffmpeg, ffprobe, yt-dlp, deno). Após limpar, o
//               ffmpeg/ffprobe são reinstalados em segundo plano.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const VIDEO_EXTS: &[&str] = &["mp4", "webm", "mkv", "mov", "m4v", "avi", "ogg"];
const THUMB_EXTS: &[&str] = &["webp", "jpg", "jpeg", "png"];
const SONG_CACHE_FILES: &[&str] = &["cacheSongs.bin", "updateGroupSong.json"];

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Cat {
    Temp,
    Orphans,
    Audio,
    Youtube,
    Songs,
    Fonts,
    Components,
}

impl Cat {
    const ALL: [Cat; 7] = [
        Cat::Temp,
        Cat::Orphans,
        Cat::Audio,
        Cat::Youtube,
        Cat::Songs,
        Cat::Fonts,
        Cat::Components,
    ];

    fn id(self) -> &'static str {
        match self {
            Cat::Temp => "temp",
            Cat::Orphans => "orphans",
            Cat::Audio => "audio",
            Cat::Youtube => "youtube",
            Cat::Songs => "songs",
            Cat::Fonts => "fonts",
            Cat::Components => "components",
        }
    }

    fn from_id(s: &str) -> Option<Cat> {
        Cat::ALL.iter().copied().find(|c| c.id() == s)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheCategory {
    pub id: String,
    pub bytes: u64,
    pub files: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearReport {
    pub freed_bytes: u64,
    pub removed_files: u64,
    pub errors: Vec<String>,
    pub components_reinstalling: bool,
}

struct Item {
    path: PathBuf,
    cat: Cat,
    bytes: u64,
    in_youtube: bool,
}

struct Roots {
    media: PathBuf,
    youtube: PathBuf,
    cache: PathBuf,
    fonts: PathBuf,
    bin: PathBuf,
    data: PathBuf,
}

fn roots(app: &AppHandle) -> Result<Roots, String> {
    let local = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir: {}", e))?;
    // O plugin-store grava em app_data_dir (no macOS é a mesma pasta; no
    // Windows é a Roaming, diferente da Local).
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    let media = local.join("media");
    Ok(Roots {
        youtube: media.join("reproducao").join("YouTube"),
        media,
        cache: local.join("cache"),
        fonts: local.join("cache").join("fonts"),
        bin: local.join("bin"),
        data,
    })
}

/// Lista arquivos recursivamente SEM seguir links simbólicos.
fn walk(dir: &Path, out: &mut Vec<(PathBuf, u64)>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        let Ok(md) = fs::symlink_metadata(&path) else { continue };
        if md.file_type().is_symlink() {
            continue;
        }
        if md.is_dir() {
            walk(&path, out);
        } else if md.is_file() {
            out.push((path, md.len()));
        }
    }
}

fn lower_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn lower_ext(name: &str) -> &str {
    name.rsplit_once('.').map(|(_, e)| e).unwrap_or("")
}

/// Sobras de download/extração interrompida.
fn is_partial(name: &str) -> bool {
    name.ends_with(".part")
        || name.contains(".part-frag")
        || name.ends_with(".ytdl")
        || name.ends_with(".temp")
        || name.contains(".temp.")
}

/// "video.f137.mp4" — faixa separada que o yt-dlp baixa antes de juntar.
fn is_ytdlp_format_piece(name: &str) -> bool {
    let parts: Vec<&str> = name.rsplitn(3, '.').collect(); // [ext, fNNN, resto]
    parts.len() == 3
        && parts[1].len() > 1
        && parts[1].starts_with('f')
        && parts[1][1..].chars().all(|c| c.is_ascii_digit())
}

/// Existe "<pasta>/<stem>.<ext>" para alguma das extensões? (sem diferenciar maiúsculas)
fn has_sibling(index: &HashSet<String>, dir: &Path, stem_lower: &str, exts: &[&str]) -> bool {
    let dir_lower = dir.to_string_lossy().to_lowercase();
    exts.iter().any(|ext| {
        let candidate = Path::new(&dir_lower).join(format!("{}.{}", stem_lower, ext));
        index.contains(&candidate.to_string_lossy().to_string())
    })
}

fn has_video(index: &HashSet<String>, dir: &Path, stem_lower: &str) -> bool {
    has_sibling(index, dir, stem_lower, VIDEO_EXTS)
}

/// Classifica um arquivo da pasta media/. `None` = arquivo do usuário (intocável).
fn classify_media(path: &Path, in_youtube: bool, index: &HashSet<String>) -> Option<Cat> {
    let name = lower_name(path);
    if name.is_empty() || name.starts_with('.') {
        return None; // .DS_Store e afins: ignorados
    }
    if is_partial(&name) || (in_youtube && is_ytdlp_format_piece(&name)) {
        return Some(Cat::Temp);
    }

    let ext = lower_ext(&name);
    let dir = path.parent()?;

    // Descobre se é "acompanhante" de um vídeo e qual o nome-base do vídeo
    enum Kind {
        Audio,
        Info,
        Thumb,
    }
    let (stem, kind) = if let Some(stem) = name.strip_suffix(".info.json") {
        (stem.to_string(), Kind::Info)
    } else if ext == "m4a" {
        (name[..name.len() - 4].to_string(), Kind::Audio)
    } else if in_youtube && THUMB_EXTS.contains(&ext) {
        (name[..name.len() - ext.len() - 1].to_string(), Kind::Thumb)
    } else if in_youtube && VIDEO_EXTS.contains(&ext) {
        return Some(Cat::Youtube); // o próprio vídeo baixado
    } else {
        return None; // mídia do usuário: nunca entra na limpeza
    };

    // Fora da pasta do YouTube, o .info.json também acompanha IMAGENS (crédito
    // dos fundos do Pixabay). No YouTube a miniatura não conta como "dona".
    let has_owner = match kind {
        Kind::Info if !in_youtube => {
            has_video(index, dir, &stem) || has_sibling(index, dir, &stem, THUMB_EXTS)
        }
        _ => has_video(index, dir, &stem),
    };
    if !has_owner {
        return Some(Cat::Orphans);
    }

    match kind {
        Kind::Audio => Some(Cat::Audio),
        Kind::Info | Kind::Thumb if in_youtube => Some(Cat::Youtube),
        _ => None, // .info.json de vídeo importado pelo usuário: mantém
    }
}

fn collect(app: &AppHandle) -> Result<Vec<Item>, String> {
    let r = roots(app)?;
    let mut items: Vec<Item> = Vec::new();

    // media/ (slides, reproducao, YouTube)
    let mut media_files = Vec::new();
    walk(&r.media, &mut media_files);
    let index: HashSet<String> = media_files
        .iter()
        .map(|(p, _)| p.to_string_lossy().to_lowercase())
        .collect();
    for (path, bytes) in media_files {
        let in_youtube = path.starts_with(&r.youtube);
        if let Some(cat) = classify_media(&path, in_youtube, &index) {
            items.push(Item { path, cat, bytes, in_youtube });
        }
    }

    // cache/fonts → fontes ; resto de cache/ → temporário
    let mut cache_files = Vec::new();
    walk(&r.cache, &mut cache_files);
    for (path, bytes) in cache_files {
        if lower_name(&path).starts_with('.') {
            continue;
        }
        let cat = if path.starts_with(&r.fonts) { Cat::Fonts } else { Cat::Temp };
        items.push(Item { path, cat, bytes, in_youtube: false });
    }

    // bin/ → componentes
    let mut bin_files = Vec::new();
    walk(&r.bin, &mut bin_files);
    for (path, bytes) in bin_files {
        items.push(Item { path, cat: Cat::Components, bytes, in_youtube: false });
    }

    // letras offline (só para o tamanho)
    for name in SONG_CACHE_FILES {
        let path = r.data.join(name);
        if let Ok(md) = fs::symlink_metadata(&path) {
            if md.is_file() {
                items.push(Item { path, cat: Cat::Songs, bytes: md.len(), in_youtube: false });
            }
        }
    }

    Ok(items)
}

/// Tamanho e quantidade de arquivos de cada categoria.
#[tauri::command]
pub async fn get_cache_breakdown(app: AppHandle) -> Result<Vec<CacheCategory>, String> {
    let items = collect(&app)?;
    let mut totals: HashMap<Cat, (u64, u64)> = HashMap::new();
    for it in &items {
        let t = totals.entry(it.cat).or_insert((0, 0));
        t.0 += it.bytes;
        t.1 += 1;
    }
    Ok(Cat::ALL
        .iter()
        .map(|c| {
            let (bytes, files) = totals.get(c).copied().unwrap_or((0, 0));
            CacheCategory { id: c.id().to_string(), bytes, files }
        })
        .collect())
}

/// Apaga os arquivos das categorias escolhidas. "songs" é ignorado aqui
/// (limpo pelo frontend). As pastas são mantidas; só os arquivos saem.
#[tauri::command]
pub async fn clear_cache_categories(
    app: AppHandle,
    ids: Vec<String>,
) -> Result<ClearReport, String> {
    let selected: HashSet<Cat> = ids
        .iter()
        .filter_map(|s| Cat::from_id(s))
        .filter(|c| *c != Cat::Songs)
        .collect();

    let mut report = ClearReport {
        freed_bytes: 0,
        removed_files: 0,
        errors: Vec::new(),
        components_reinstalling: false,
    };
    if selected.is_empty() {
        return Ok(report);
    }

    let mut removed_components = false;
    for it in collect(&app)? {
        // Ao apagar os vídeos do YouTube, o áudio extraído deles vai junto
        let wanted = selected.contains(&it.cat)
            || (it.cat == Cat::Audio && it.in_youtube && selected.contains(&Cat::Youtube));
        if !wanted {
            continue;
        }
        match fs::remove_file(&it.path) {
            Ok(()) => {
                report.freed_bytes += it.bytes;
                report.removed_files += 1;
                if it.cat == Cat::Components {
                    removed_components = true;
                }
            }
            Err(e) => {
                if report.errors.len() < 5 {
                    let name = it.path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    report.errors.push(format!("{}: {}", name, e));
                }
            }
        }
    }

    // FFmpeg/FFprobe são essenciais para tocar vídeo: reinstala já.
    // (yt-dlp e Deno voltam no próximo uso do importador do YouTube.)
    if removed_components {
        report.components_reinstalling = true;
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::dependency_manager::ensure_binaries(&handle).await {
                eprintln!("[cache_cleaner] reinstalação do ffmpeg falhou: {}", e);
            }
        });
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detecta_sobras() {
        assert!(is_partial("abc.mp4.part"));
        assert!(is_partial("abc.mp4.part-frag12"));
        assert!(is_partial("abc.ytdl"));
        assert!(is_partial("video.m4a.part"));
        assert!(!is_partial("abc.mp4"));
        assert!(is_ytdlp_format_piece("abc.f137.mp4"));
        assert!(is_ytdlp_format_piece("abc.f140.m4a"));
        assert!(!is_ytdlp_format_piece("abc.mp4"));
        assert!(!is_ytdlp_format_piece("festa.final.mp4"));
    }
}
