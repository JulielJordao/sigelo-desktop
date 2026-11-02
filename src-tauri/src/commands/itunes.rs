use serde::{Deserialize, Serialize};

/// Resultado enxuto devolvido ao front-end.
#[derive(Serialize)]
pub struct ItunesTrack {
    pub track_name: String,
    pub artist_name: String,
    pub collection_name: Option<String>,
    pub artwork_url: Option<String>,
    pub track_view_url: Option<String>,
    pub release_year: Option<String>,
    pub primary_genre: Option<String>,
    pub duration_sec: Option<u32>,
}

/// Shape bruto da resposta da iTunes Search API (só os campos que usamos).
#[derive(Deserialize)]
struct RawResult {
    #[serde(rename = "trackName")]
    track_name: Option<String>,
    #[serde(rename = "artistName")]
    artist_name: Option<String>,
    #[serde(rename = "collectionName")]
    collection_name: Option<String>,
    #[serde(rename = "artworkUrl100")]
    artwork_url100: Option<String>,
    #[serde(rename = "trackViewUrl")]
    track_view_url: Option<String>,
    #[serde(rename = "releaseDate")]
    release_date: Option<String>,
    #[serde(rename = "primaryGenreName")]
    primary_genre: Option<String>,
    #[serde(rename = "trackTimeMillis")]
    track_time_millis: Option<u64>,
}

#[derive(Deserialize)]
struct RawResponse {
    results: Vec<RawResult>,
}

/// Busca músicas na iTunes Search API (pública, sem chave). Feito no Rust
/// para não esbarrar em CORS no webview. Retorna só título, artista, álbum
/// e a capa em alta resolução.
#[tauri::command]
pub async fn search_itunes(term: String) -> Result<Vec<ItunesTrack>, String> {
    let term = term.trim();
    if term.len() < 2 {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .user_agent("Sigelo")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get("https://itunes.apple.com/search")
        .query(&[
            ("term", term),
            ("entity", "song"),
            ("media", "music"),
            ("limit", "12"),
        ])
        .send()
        .await
        .map_err(|e| format!("Falha na busca: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("iTunes respondeu {}.", response.status()));
    }

    let parsed: RawResponse = response.json().await.map_err(|e| e.to_string())?;

    let tracks = parsed
        .results
        .into_iter()
        .filter_map(|r| {
            let track_name = r.track_name?;
            let artist_name = r.artist_name.unwrap_or_default();
            // Capa: a API devolve 100x100; pedimos 600x600 trocando o sufixo.
            let artwork_url = r
                .artwork_url100
                .map(|u| u.replace("100x100bb", "600x600bb"));
            let release_year = r
                .release_date
                .and_then(|d| d.get(0..4).map(|s| s.to_string()));

            Some(ItunesTrack {
                track_name,
                artist_name,
                collection_name: r.collection_name,
                artwork_url,
                track_view_url: r.track_view_url,
                release_year,
                primary_genre: r.primary_genre,
                duration_sec: r.track_time_millis.map(|ms| (ms / 1000) as u32),
            })
        })
        .collect();

    Ok(tracks)
}
