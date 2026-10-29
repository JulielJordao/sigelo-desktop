// src-tauri/src/bible_scraper.rs
//
// Extrai a passagem do Bíblia Online no backend Rust (reqwest + scraper).
// Cargo:  cargo add scraper
// Registrar: mod bible_scraper;  e  bible_scraper::scrape_bible_passage no generate_handler!.
//
// v3 — Correção do "conteúdo extra no final" (várias traduções grudadas +
//      rótulos de versão + aviso "Direitos das traduções").
//
//      CAUSA: a página de VERSÍCULO específico (ex.: /ara/sl/27/7-10) hoje
//      embute um PAINEL DE COMPARAÇÃO que repete o mesmo versículo em ARA,
//      NAA, NVI, ACF, ARC, NTLH, AVM, KJA… e termina com os nomes das versões
//      e "Direitos das traduções citadas". O parser engolia tudo isso.
//
//      SOLUÇÃO (duas camadas, independentes):
//        1. BUSCA SEMPRE A PÁGINA DO CAPÍTULO (/versao/livro/cap), que entrega
//           o texto LIMPO de uma única versão, e filtra o intervalo no backend.
//           A URL de versículo (com painel de comparação) não é mais usada.
//        2. PARSER à prova de painel: aceita só número ESTRITAMENTE CRESCENTE
//           como novo versículo (descarta notas/rodapés que reiniciam em 1 e
//           qualquer repetição da sequência) e PARA no rodapé de copyright /
//           "Direitos das traduções". Também é agnóstico à marcação: acha o
//           conteúdo em article[data-fragment-root] OU main OU body e detecta
//           o número por [data-vn]/[data-v] OU por elemento pequeno só-dígitos.

use scraper::{ElementRef, Html, Selector};
use serde::Serialize;

const BASE_URL: &str = "https://www.bibliaonline.com.br";
const DONATION_URL: &str = "https://www.bibliaonline.com.br/me/ofertar";
const SITE_NAME: &str = "Bíblia Online";

// UA de navegador real — evita bloqueio por WAF/anti-bot.
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

// Reconhece o início do rodapé legal / painel de comparação, onde a coleta para.
fn is_footer_text(t: &str) -> bool {
    t.contains('\u{00a9}')
        || t.contains("Copyright")
        || t.contains("direitos reservados")
        || t.contains("Direitos das traduções")
        || t.contains("Texto bíblico utilizado com autorização")
}

/// Parse SÍNCRONO (scraper::Html não é Send): retorna (rótulo da versão, versículos).
///
/// Varre os nós em ORDEM DE DOCUMENTO. Cada marcador de número define o
/// versículo "atual"; todo texto seguinte é acumulado nele, até o próximo
/// marcador. Ignora texto em headings (títulos de seção) e dentro do próprio
/// número. Dois guardas impedem o "conteúdo extra":
///   - só aceita número ESTRITAMENTE CRESCENTE (max_seen) como novo versículo;
///   - PARA ao encontrar o rodapé de copyright / "Direitos das traduções".
fn parse_verses(html: &str) -> (String, Vec<ScrapedVerse>) {
    use scraper::node::Node;
    use std::collections::BTreeMap;

    let doc = Html::parse_document(html);

    // Container do texto: tenta o layout antigo e cai para <main>/<body>.
    let root: Option<ElementRef> = ["article[data-fragment-root]", "main#main", "main", "body"]
        .iter()
        .find_map(|s| {
            Selector::parse(s)
                .ok()
                .and_then(|sel| doc.select(&sel).next())
        });

    let root = match root {
        Some(r) => r,
        None => return (String::new(), Vec::new()),
    };

    let mut label = clean(root.value().attr("aria-label").unwrap_or(""));

    let is_heading = |n: &str| matches!(n, "h1" | "h2" | "h3" | "h4" | "h5" | "h6");
    let is_noise_tag =
        |n: &str| matches!(n, "script" | "style" | "nav" | "footer" | "button" | "svg");

    // Marcador de número: tem data-vn (layout antigo) OU é um elemento pequeno
    // cujo texto inteiro são só dígitos (sup/span/b/…).
    let marker_num = |er: ElementRef| -> Option<u32> {
        let el = er.value();
        if el.attr("data-vn").is_some() {
            if let Some(n) = digits_to_u32(el.attr("data-v").unwrap_or("")) {
                return Some(n);
            }
        }
        if matches!(
            el.name(),
            "sup" | "b" | "strong" | "span" | "a" | "small" | "em"
        ) {
            let t: String = er.text().collect();
            let t = t.trim();
            if !t.is_empty() && t.len() <= 4 && t.chars().all(|c| c.is_ascii_digit()) {
                return t.parse().ok();
            }
        }
        None
    };

    let mut order: Vec<u32> = Vec::new();
    let mut texts: BTreeMap<u32, String> = BTreeMap::new();
    let mut current: Option<u32> = None;
    let mut max_seen: u32 = 0;

    for node in root.descendants() {
        match node.value() {
            Node::Element(_) => {
                if let Some(er) = ElementRef::wrap(node) {
                    if let Some(n) = marker_num(er) {
                        // Só aceita número ESTRITAMENTE CRESCENTE como novo
                        // versículo. Assim ignoramos: números de nota/rodapé
                        // (reiniciam em 1), marcadores de referência cruzada e
                        // qualquer painel de "comparar versões" que repita a
                        // sequência — tudo vem com número <= o último visto.
                        if n > max_seen {
                            current = Some(n);
                            max_seen = n;
                            if !texts.contains_key(&n) {
                                order.push(n);
                                texts.insert(n, String::new());
                            }
                        } else {
                            // Número não-crescente = começo de nota/rodapé ou do
                            // painel de comparação. Desarma `current` para NÃO
                            // acumular esse texto no último versículo válido.
                            current = None;
                        }
                    }
                }
            }
            Node::Text(t) => {
                let s = t.to_string();
                let trimmed = s.trim();

                // Rodapé de copyright / painel de comparação → encerra a coleta
                // (e aproveita para rotular a versão, se ainda não houver label).
                if is_footer_text(trimmed) {
                    if label.is_empty() {
                        let pref = s
                            .split('\u{00a9}')
                            .next()
                            .unwrap_or("")
                            .split("Copyright")
                            .next()
                            .unwrap_or("")
                            .trim();
                        if !pref.is_empty() && pref.len() < 100 {
                            label = clean(pref);
                        }
                    }
                    break;
                }

                if let Some(n) = current {
                    // pula texto em heading, tag de ruído ou dentro do número
                    let mut skip = false;
                    for anc in node.ancestors() {
                        if let Some(a) = anc.value().as_element() {
                            let name = a.name();
                            if is_heading(name) || is_noise_tag(name) || a.attr("data-vn").is_some()
                            {
                                skip = true;
                                break;
                            }
                            if matches!(name, "sup" | "small") {
                                if let Some(er) = ElementRef::wrap(anc) {
                                    let tt: String = er.text().collect();
                                    let tt = tt.trim();
                                    if !tt.is_empty() && tt.chars().all(|c| c.is_ascii_digit()) {
                                        skip = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    if !skip && !matches!(trimmed, "Publicidade" | "Criar" | "Aa" | "") {
                        if let Some(buf) = texts.get_mut(&n) {
                            buf.push_str(&s);
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
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        )
        .header("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.8")
        // identity: pede sem compressão, evitando depender de gzip/brotli no reqwest.
        .header("Accept-Encoding", "identity")
        .header("Upgrade-Insecure-Requests", "1")
        .header("Sec-Fetch-Dest", "document")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "none")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Ok(None); // 404 etc. → deixa o chamador tratar
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
        .user_agent(BROWSER_UA)
        .build()
        .map_err(|e| e.to_string())?;

    // SEMPRE a página do capítulo (texto de UMA versão, sem painel de comparação).
    let chapter_url = format!("{}/{}/{}/{}", BASE_URL, version, book, chapter);

    // URL do(s) versículo(s) só serve para o link "Abrir no site" / origem.
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

    let mut label = String::new();
    let mut verses: Vec<ScrapedVerse> = Vec::new();

    if let Some(body) = fetch_html(&client, &chapter_url).await? {
        let (l, vs) = parse_verses(&body);
        label = l;
        verses = filter_range(vs, verse_start, verse_end);
    }

    if verses.is_empty() {
        return Err(format!(
            "Nenhum versículo encontrado. Verifique o slug do livro/versão \
             (ex.: Jó = 'jó', Atos = 'atos'), ou a página pode estar indisponível. \
             Você pode abri-la direto no site: {}",
            specific_url
        ));
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
        // Link de origem aponta para a passagem específica (bom para o usuário).
        verses,
        text,
        source: ScrapedSource {
            url: specific_url,
            label: source_label,
            donation_url: DONATION_URL.to_string(),
        },
    })
}