use serde::{Deserialize, Serialize};

// ============================================================================
// CHAVE DA VAGALUME
// Pegue uma chave gratuita em https://api.vagalume.com.br/docs/ e cole abaixo.
// Deixe a string vazia para usar apenas a LRCLIB (sem a camada Vagalume).
// Dica: prefira a variável de ambiente VAGALUME_APIKEY para não versionar a chave.
// ============================================================================
const VAGALUME_API_KEY: &str = "";

fn vagalume_key() -> Option<String> {
    if let Ok(k) = std::env::var("VAGALUME_APIKEY") {
        if !k.trim().is_empty() {
            return Some(k);
        }
    }
    let k = VAGALUME_API_KEY.trim();
    if k.is_empty() { None } else { Some(k.to_string()) }
}

#[derive(Serialize)]
pub struct LyricsResult {
    /// Letra em texto puro, pronta para o editor.
    pub lyrics: Option<String>,
    /// Letra sincronizada (LRC), quando a LRCLIB tiver.
    pub synced: Option<String>,
    /// "lrclib" | "vagalume"
    pub source: Option<String>,
    /// "found" | "instrumental" | "not_found"
    pub status: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Sigelo (https://sigelo.cloud)")
        .build()
        .map_err(|e| e.to_string())
}

/// Busca a letra online: tenta a LRCLIB e, se não achar, a Vagalume.
#[tauri::command]
pub async fn fetch_lyrics(
    track_name: String,
    artist_name: String,
    album_name: Option<String>,
    duration: Option<u32>,
) -> Result<LyricsResult, String> {
    let track = track_name.trim();
    if track.len() < 2 {
        return Ok(LyricsResult {
            lyrics: None,
            synced: None,
            source: None,
            status: "not_found".into(),
        });
    }
    let artist = artist_name.trim();
    let http = client()?;

    // 1) LRCLIB
    if let Some(found) = lrclib_lookup(&http, track, artist, album_name.as_deref(), duration).await
    {
        return Ok(found);
    }

    // 2) Vagalume (só se houver chave e artista — a API exige artista)
    if !artist.is_empty() {
        if let Some(key) = vagalume_key() {
            if let Some(found) = vagalume_lookup(&http, track, artist, &key).await {
                return Ok(found);
            }
        }
    }

    Ok(LyricsResult {
        lyrics: None,
        synced: None,
        source: None,
        status: "not_found".into(),
    })
}

// ----------------------------- LRCLIB -----------------------------

#[derive(Deserialize)]
struct LrclibRecord {
    duration: Option<f64>,
    instrumental: Option<bool>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
}

async fn lrclib_lookup(
    http: &reqwest::Client,
    track: &str,
    artist: &str,
    album: Option<&str>,
    duration: Option<u32>,
) -> Option<LyricsResult> {
    // Caminho preciso: /api/get exige a assinatura completa.
    if !artist.is_empty() && album.is_some() && duration.is_some() {
        let mut q: Vec<(&str, String)> = vec![
            ("track_name", track.to_string()),
            ("artist_name", artist.to_string()),
            ("album_name", album.unwrap().to_string()),
            ("duration", duration.unwrap().to_string()),
        ];
        if let Some(rec) = lrclib_get(http, &q).await {
            if let Some(res) = record_to_result(rec) {
                return Some(res);
            }
        }
        q.clear();
    }

    // Fallback: /api/search por título (+ artista), rankeando por duração.
    let mut params: Vec<(&str, String)> = vec![("track_name", track.to_string())];
    if !artist.is_empty() {
        params.push(("artist_name", artist.to_string()));
    }
    let records = lrclib_search(http, &params).await?;
    let best = pick_best(records, duration)?;
    record_to_result(best)
}

async fn lrclib_get(http: &reqwest::Client, q: &[(&str, String)]) -> Option<LrclibRecord> {
    let resp = http
        .get("https://lrclib.net/api/get")
        .query(q)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None; // 404 = não encontrado
    }
    resp.json::<LrclibRecord>().await.ok()
}

async fn lrclib_search(
    http: &reqwest::Client,
    q: &[(&str, String)],
) -> Option<Vec<LrclibRecord>> {
    let resp = http
        .get("https://lrclib.net/api/search")
        .query(q)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<Vec<LrclibRecord>>().await.ok()
}

/// Escolhe o melhor candidato: menor diferença de duração quando ela é conhecida.
fn pick_best(records: Vec<LrclibRecord>, duration: Option<u32>) -> Option<LrclibRecord> {
    if records.is_empty() {
        return None;
    }
    match duration {
        Some(d) => records.into_iter().min_by_key(|r| {
            let rd = r.duration.unwrap_or(0.0);
            (rd - d as f64).abs() as i64
        }),
        None => records.into_iter().next(),
    }
}

fn record_to_result(rec: LrclibRecord) -> Option<LyricsResult> {
    if rec.instrumental.unwrap_or(false) {
        return Some(LyricsResult {
            lyrics: None,
            synced: None,
            source: Some("lrclib".into()),
            status: "instrumental".into(),
        });
    }
    let has_plain = rec.plain_lyrics.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false);
    let has_synced = rec.synced_lyrics.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false);
    if !has_plain && !has_synced {
        return None;
    }
    Some(LyricsResult {
        lyrics: rec.plain_lyrics,
        synced: rec.synced_lyrics,
        source: Some("lrclib".into()),
        status: "found".into(),
    })
}

// ----------------------------- VAGALUME -----------------------------

#[derive(Deserialize)]
struct VagalumeResp {
    #[serde(rename = "type")]
    resp_type: String,
    mus: Option<Vec<VagalumeMus>>,
}

#[derive(Deserialize)]
struct VagalumeMus {
    lyric: Option<String>,
}

async fn vagalume_lookup(
    http: &reqwest::Client,
    track: &str,
    artist: &str,
    key: &str,
) -> Option<LyricsResult> {
    let resp = http
        .get("https://api.vagalume.com.br/search.php")
        .query(&[("art", artist), ("mus", track), ("apikey", key)])
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data = resp.json::<VagalumeResp>().await.ok()?;

    // Aceita correspondência exata ou aproximada.
    if data.resp_type != "exact" && data.resp_type != "aprox" {
        return None;
    }
    let lyric = data.mus?.into_iter().find_map(|m| {
        m.lyric.filter(|l| !l.trim().is_empty())
    })?;

    Some(LyricsResult {
        lyrics: Some(lyric),
        synced: None,
        source: Some("vagalume".into()),
        status: "found".into(),
    })
}
