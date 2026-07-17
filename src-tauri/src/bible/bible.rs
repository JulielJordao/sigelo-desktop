// src-tauri/src/bible_scraper.rs
//
// Extrai a passagem de https://www.bibliaonline.com.br/{versao}/{livro}/{capitulo}
// no próprio backend Rust (reqwest, que você já usa, + scraper para o parse do HTML).
// Sem servidor Deno, sem CORS, sem porta: o frontend chama via invoke("scrape_bible_passage").
//
// Cargo:  cargo add scraper       (reqwest, serde e serde_json você já tem)
//
// Registrar em lib.rs:
//   mod bible_scraper;
//   ...
//   .invoke_handler(tauri::generate_handler![
//       // ...seus comandos...
//       bible_scraper::scrape_bible_passage,
//   ])
//
// Observação: a extração assume que a página vem com o texto no HTML (SSR). Se o site
// passar a renderizar só via JS, o `article` não aparece e retornamos um erro claro —
// nesse caso a entrada manual do texto (na modal) resolve.

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
    // extractedAt é preenchido no frontend (evita depender de chrono no Rust).
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

/// slug simples (minúsculo, sem ponto/espaço). O frontend já manda normalizado; aqui
/// só reforçamos. Acentos são tratados no frontend (normalizeSlug).
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

/// Parsing SÍNCRONO: `scraper::Html` não é `Send`, então mantemos tudo aqui dentro,
/// sem cruzar nenhum `.await` (o comando async continua `Send`).
fn parse_passage(
    html: &str,
    version: &str,
    book: &str,
    chapter: u32,
    v_start: Option<u32>,
    v_end: Option<u32>,
    book_name: &str,
    url: &str,
) -> Result<ScrapedPassage, String> {
    let doc = Html::parse_document(html);

    let article_sel = Selector::parse("article[data-fragment-root]").unwrap();
    let p_sel = Selector::parse("p[data-v]").unwrap();
    let vn_sel = Selector::parse("[data-vn]").unwrap();
    let t_sel = Selector::parse("[data-t]").unwrap();
    let role_sel = Selector::parse(r#"[role="text"]"#).unwrap();

    let article = doc.select(&article_sel).next().ok_or_else(|| {
        "Conteúdo não encontrado no HTML. A página pode ser renderizada via JavaScript \
         ou ter bloqueado o acesso. Use a entrada manual do texto."
            .to_string()
    })?;

    let version_label = clean(article.value().attr("aria-label").unwrap_or(version));

    let mut all: Vec<ScrapedVerse> = Vec::new();

    for p in article.select(&p_sel) {
        // Número do versículo
        let number = p
            .select(&vn_sel)
            .next()
            .map(|el| el.text().collect::<String>())
            .and_then(|s| {
                let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
                digits.parse::<u32>().ok()
            });
        let number = match number {
            Some(n) => n,
            None => continue,
        };

        // Texto: junta todos os [data-t]; senão usa [role="text"]
        let mut text = String::new();
        let tokens: Vec<_> = p.select(&t_sel).collect();
        if !tokens.is_empty() {
            for t in tokens {
                text.push_str(&t.text().collect::<String>());
            }
        } else if let Some(role) = p.select(&role_sel).next() {
            text = role.text().collect::<String>();
        }

        let text = clean(&text);
        if !text.is_empty() {
            all.push(ScrapedVerse { number, text });
        }
    }

    // Filtra pelo intervalo pedido (se houver)
    let verses: Vec<ScrapedVerse> = match v_start {
        Some(start) => {
            let end = v_end.unwrap_or(start);
            all.into_iter()
                .filter(|v| v.number >= start && v.number <= end)
                .collect()
        }
        None => all,
    };

    if verses.is_empty() {
        return Err("Nenhum versículo correspondente foi encontrado.".to_string());
    }

    let first = verses.first().unwrap().number;
    let last = verses.last().unwrap().number;
    let range = if first == last {
        format!("{}", first)
    } else {
        format!("{}-{}", first, last)
    };
    let reference = format!("{} {}:{}", book_name, chapter, range);
    let joined = verses
        .iter()
        .map(|v| v.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let source_label = format!("{} — {}", version_label, SITE_NAME);

    Ok(ScrapedPassage {
        provider: "bibliaonline".to_string(),
        version: version.to_string(),
        version_label,
        book: book.to_string(),
        book_name: book_name.to_string(),
        chapter,
        verse_start: v_start,
        verse_end: v_end.or(v_start),
        reference,
        verses,
        text: joined,
        source: ScrapedSource {
            url: url.to_string(),
            label: source_label,
            donation_url: DONATION_URL.to_string(),
        },
    })
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

    // Busca o capítulo inteiro e filtra os versículos (mais robusto).
    let url = format!("{}/{}/{}/{}", BASE_URL, version, book, chapter);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; ChurchPresenter/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .header("Accept-Language", "pt-BR,pt;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!(
            "Falha ao acessar {} (HTTP {}).",
            url,
            resp.status().as_u16()
        ));
    }

    let html = resp.text().await.map_err(|e| e.to_string())?;

    // Parse síncrono (não cruza await) → o Future do comando continua Send.
    parse_passage(
        &html,
        &version,
        &book,
        chapter,
        verse_start,
        verse_end,
        &book_name,
        &url,
    )
}