// src-tauri/src/bible_scraper.rs
//
// Extrai a passagem do Bíblia Online no backend Rust (reqwest + scraper).
// Cargo:  cargo add scraper
// Registrar: mod bible_scraper;  e  bible_scraper::scrape_bible_passage no generate_handler!.

use scraper::{Html, Selector};
use serde::Serialize;

const BASE_URL: &str = "https://www.bibliaonline.com.br";
const DONATION_URL: &str = "https://www.bibliaonline.com.br/me/ofertar";
const SITE_NAME: &str = "Bíblia Online";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapedVerse {
    pub number: u32,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapedSource {
    pub url: String,
    pub label: String,
    pub donation_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapedPassage {
    pub provider: String,
    pub version: String,
    pub version_label: String,
    pub book: String,
    pub book_name: String,
    pub chapter: u32,
    pub verse_start: Option<u32>,
    pub verse_end: Option<u32>,
    pub reference: String,
    pub verses: Vec<ScrapedVerse>,
    pub text: String,
    pub source: ScrapedSource,
}

// só tira ponto/espaço e passa p/ minúsculo — NÃO remove acento (Jó = 'jó').
fn normalize_slug(s: &str) -> String {
    s.chars()
        .filter(|c| *c != '.' && !c.is_whitespace())
        .collect::<String>()
        .to_lowercase()
}

fn clean(s: &str) -> String {
    s.replace('\u{00a0}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn digits_to_u32(s: &str) -> Option<u32> {
    let d: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    if d.is_empty() {
        None
    } else {
        d.parse::<u32>().ok()
    }
}

/// Parse SÍNCRONO (scraper::Html não é Send): retorna (rótulo da versão, versículos).
/// Chaveia por VERSÍCULO (atributo data-v=".N.") e não por <p>, porque o Bíblia Online
/// usa o modo "texto corrido", onde vários versículos ficam dentro do mesmo <p>.
fn parse_verses(html: &str) -> (String, Vec<ScrapedVerse>) {
    use std::collections::{HashMap, HashSet};

    let doc = Html::parse_document(html);

    let article_sel = Selector::parse("article[data-fragment-root]").unwrap();
    let vn_sel = Selector::parse("[data-vn]").unwrap();
    let role_sel = Selector::parse(r#"[role="text"]"#).unwrap();
    let p_sel = Selector::parse("p[data-v]").unwrap();
    let t_sel = Selector::parse("[data-t]").unwrap();
    let heading_sel = Selector::parse("h1,h2,h3,h4,h5,h6").unwrap();

    let article = match doc.select(&article_sel).next() {
        Some(a) => a,
        None => return (String::new(), Vec::new()),
    };

    let label = clean(article.value().attr("aria-label").unwrap_or(""));

    // 1) mapa data-v (".8.") -> número do versículo (8), a partir dos marcadores [data-vn]
    let mut num_by_dv: HashMap<String, u32> = HashMap::new();
    for vn in article.select(&vn_sel) {
        let dv = vn.value().attr("data-v").unwrap_or("").to_string();
        let n = digits_to_u32(&vn.text().collect::<String>()).or_else(|| digits_to_u32(&dv));
        if let Some(n) = n {
            num_by_dv.entry(dv).or_insert(n);
        }
    }

    // Títulos de seção (perícopes, ex.: "A missão do Filho") ficam dentro de <h2>/<h3>,
    // têm tokens [data-t] e COMPARTILHAM o data-v do versículo seguinte. Coletamos os
    // [role="text"] que estão dentro de headings para IGNORÁ-LOS.
    let mut heading_ids = HashSet::new();
    for h in article.select(&heading_sel) {
        for rt in h.select(&role_sel) {
            heading_ids.insert(rt.id());
        }
    }

    // 2) um versículo por [role="text"] (fora de headings), chaveado pelo data-v.
    //    O texto vem SÓ dos tokens [data-t] (palavras da Escritura).
    let mut verses: Vec<ScrapedVerse> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for rt in article.select(&role_sel) {
        if heading_ids.contains(&rt.id()) {
            continue; // título de seção, não é versículo
        }
        let dv = rt.value().attr("data-v").unwrap_or("").to_string();
        if dv.is_empty() || seen.contains(&dv) {
            continue;
        }
        let mut text = String::new();
        for t in rt.select(&t_sel) {
            text.push_str(&t.text().collect::<String>());
        }
        let text = clean(&text);
        if text.is_empty() {
            continue; // sem tokens de Escritura → provável título de seção
        }
        let number = num_by_dv.get(&dv).copied().or_else(|| digits_to_u32(&dv));
        let number = match number {
            Some(n) => n,
            None => continue,
        };
        seen.insert(dv);
        verses.push(ScrapedVerse { number, text });
    }

    // 3) fallback: sem [role="text"] → parse verso a verso por <p>
    if verses.is_empty() {
        for p in article.select(&p_sel) {
            let mut number = p
                .select(&vn_sel)
                .next()
                .map(|el| el.text().collect::<String>())
                .and_then(|s| digits_to_u32(&s));
            if number.is_none() {
                number = digits_to_u32(p.value().attr("data-v").unwrap_or(""));
            }
            let number = match number {
                Some(n) => n,
                None => continue,
            };
            let mut text = String::new();
            for t in p.select(&t_sel) {
                text.push_str(&t.text().collect::<String>());
            }
            let text = clean(&text);
            if !text.is_empty() {
                verses.push(ScrapedVerse { number, text });
            }
        }
    }

    // ordena por número (garante referência first/last correta)
    verses.sort_by_key(|v| v.number);
    (label, verses)
}

fn filter_range(
    verses: Vec<ScrapedVerse>,
    start: Option<u32>,
    end: Option<u32>,
) -> Vec<ScrapedVerse> {
    match start {
        Some(s) => {
            let e = end.unwrap_or(s);
            verses
                .into_iter()
                .filter(|v| v.number >= s && v.number <= e)
                .collect()
        }
        None => verses,
    }
}

async fn fetch_html(client: &reqwest::Client, url: &str) -> Result<Option<String>, String> {
    let resp = client
        .get(url)
        .header("Accept-Language", "pt-BR,pt;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Ok(None); // 404 etc. → deixa o chamador tentar o fallback
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(Some(body))
}

#[tauri::command]
pub async fn scrape_bible_passage(
    version: String,
    book: String,
    chapter: u32,
    verse_start: Option<u32>,
    verse_end: Option<u32>,
    book_name: Option<String>,
) -> Result<ScrapedPassage, String> {
    let version = normalize_slug(&version);
    let book = normalize_slug(&book);
    let book_name = book_name.unwrap_or_else(|| book.to_uppercase());

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; ChurchPresenter/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let chapter_url = format!("{}/{}/{}/{}", BASE_URL, version, book, chapter);

    // URL específica do(s) versículo(s): o próprio site já entrega filtrado.
    let specific_url = match verse_start {
        Some(s) => {
            let e = verse_end.unwrap_or(s);
            if e > s {
                format!("{}/{}-{}", chapter_url, s, e)
            } else {
                format!("{}/{}", chapter_url, s)
            }
        }
        None => chapter_url.clone(),
    };

    // 1) tenta a URL específica
    let mut label = String::new();
    let mut verses: Vec<ScrapedVerse> = Vec::new();
    let mut used_url = specific_url.clone();

    if let Some(body) = fetch_html(&client, &specific_url).await? {
        let (l, vs) = parse_verses(&body);
        label = l;
        verses = filter_range(vs, verse_start, verse_end);
    }

    // 2) fallback: pediu versos mas veio vazio → capítulo inteiro + filtro
    if verses.is_empty() && verse_start.is_some() && specific_url != chapter_url {
        if let Some(body) = fetch_html(&client, &chapter_url).await? {
            let (l, vs) = parse_verses(&body);
            if label.is_empty() {
                label = l;
            }
            verses = filter_range(vs, verse_start, verse_end);
            used_url = chapter_url.clone();
        }
    }

    if verses.is_empty() {
        return Err(
            "Nenhum versículo encontrado. Verifique o slug do livro/versão \
             (ex.: Jó = 'jó', Atos = 'atos'), ou a página pode estar bloqueada."
                .to_string(),
        );
    }

    if label.is_empty() {
        label = version.clone();
    }

    let first = verses.first().unwrap().number;
    let last = verses.last().unwrap().number;
    let range = if first == last {
        format!("{}", first)
    } else {
        format!("{}-{}", first, last)
    };
    let reference = format!("{} {}:{}", book_name, chapter, range);
    let text = verses
        .iter()
        .map(|v| v.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let source_label = format!("{} — {}", label, SITE_NAME);

    Ok(ScrapedPassage {
        provider: "bibliaonline".to_string(),
        version: version.clone(),
        version_label: label,
        book: book.clone(),
        book_name,
        chapter,
        verse_start,
        verse_end: verse_end.or(verse_start),
        reference,
        verses,
        text,
        source: ScrapedSource {
            url: used_url,
            label: source_label,
            donation_url: DONATION_URL.to_string(),
        },
    })
}