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
///
/// Estratégia: varre os nós em ORDEM DE DOCUMENTO. Cada marcador [data-vn] define o
/// versículo "atual"; todo texto seguinte é acumulado nele, até o próximo [data-vn].
/// Ignoramos texto dentro de headings <h1..h6> (títulos de seção, ex.: "A missão do
/// Filho") e dentro do próprio [data-vn] (o número). Assim funciona para:
///   - texto corrido (vários versículos no mesmo <p>);
///   - versículos partidos por elementos internos (ex.: o Nome divino "SENHOR"), que
///     antes cortavam o texto no meio;
///   - títulos de seção que compartilham o data-v do versículo seguinte.
fn parse_verses(html: &str) -> (String, Vec<ScrapedVerse>) {
    use scraper::node::Node;
    use std::collections::BTreeMap;

    let doc = Html::parse_document(html);
    let article_sel = Selector::parse("article[data-fragment-root]").unwrap();

    let article = match doc.select(&article_sel).next() {
        Some(a) => a,
        None => return (String::new(), Vec::new()),
    };

    let label = clean(article.value().attr("aria-label").unwrap_or(""));

    let is_heading = |n: &str| matches!(n, "h1" | "h2" | "h3" | "h4" | "h5" | "h6");

    let mut order: Vec<u32> = Vec::new(); // ordem de aparição dos versículos
    let mut texts: BTreeMap<u32, String> = BTreeMap::new();
    let mut current: Option<u32> = None;

    for node in article.descendants() {
        match node.value() {
            Node::Element(el) => {
                // marcador de número de versículo → define o versículo atual
                if el.attr("data-vn").is_some() {
                    if let Some(n) = digits_to_u32(el.attr("data-v").unwrap_or("")) {
                        current = Some(n);
                        if !texts.contains_key(&n) {
                            order.push(n);
                            texts.insert(n, String::new());
                        }
                    }
                }
            }
            Node::Text(t) => {
                if let Some(n) = current {
                    // pula texto dentro de heading (título) ou do próprio número [data-vn]
                    let mut skip = false;
                    for anc in node.ancestors() {
                        if let Some(a) = anc.value().as_element() {
                            if is_heading(a.name()) || a.attr("data-vn").is_some() {
                                skip = true;
                                break;
                            }
                        }
                    }
                    if !skip {
                        if let Some(buf) = texts.get_mut(&n) {
                            buf.push_str(&t.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let mut verses: Vec<ScrapedVerse> = order
        .into_iter()
        .filter_map(|n| {
            let t = clean(texts.get(&n).map(|s| s.as_str()).unwrap_or(""));
            if t.is_empty() {
                None
            } else {
                Some(ScrapedVerse { number: n, text: t })
            }
        })
        .collect();

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