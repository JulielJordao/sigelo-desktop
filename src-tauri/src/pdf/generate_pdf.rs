use ::image::{open, DynamicImage, Rgba};
use printpdf::*;
use rust_embed::RustEmbed;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Cursor};

#[derive(RustEmbed)]
#[folder = "src/fonts/"]
struct EmbeddedFonts;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StyleInput {
    pub color: String,
    pub font_size: f32,
    pub align: String,
    pub font_family: String,
    pub is_bold: bool,
    pub is_italic: bool,
    pub is_custom: bool,
    pub custom_font_path: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlideInput {
    pub text: String,
    pub style: StyleInput,
    pub is_cover_slide: bool, // NOVO
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DesignInput {
    pub bg_color: String,
    pub bg_media: Option<String>,
    pub bg_opacity: Option<f32>,
    pub pos_x: f32,
    pub pos_y: f32,
    pub width: f32,
    pub height: f32,
}

// NOVO: struct dos créditos
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CreditsInput {
    pub enabled: bool,
    pub text: String,
    pub cover_only: bool,
    pub position: String,
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Carrega fonte (extraído pra reutilizar nos créditos)
// ═══════════════════════════════════════════════════════════════════════
fn load_font(
    doc: &PdfDocumentReference,
    style: &StyleInput,
    font_cache: &mut HashMap<String, IndirectFontRef>,
    // Override: força itálico independente do style.is_italic (pra créditos)
    force_italic: bool,
    force_bold: Option<bool>,
) -> Result<IndirectFontRef, String> {
    let is_bold = force_bold.unwrap_or(style.is_bold);
    let is_italic = style.is_italic || force_italic;

    let font_key = format!(
        "{}_{}_{}_{}",
        style.font_family, is_bold, is_italic, style.is_custom
    );

    if let Some(cached_font) = font_cache.get(&font_key) {
        return Ok(cached_font.clone());
    }

    let loaded_font = if style.is_custom {
        if let Some(path) = &style.custom_font_path {
            let font_file = File::open(path).map_err(|e| format!("Erro ao abrir: {}", e))?;
            doc.add_external_font(font_file)
                .map_err(|_| "Erro embutir custom")?
        } else {
            return Err("Caminho custom vazio.".to_string());
        }
    } else {
        let weight = match (is_bold, is_italic) {
            (true, true) => "BoldItalic",
            (true, false) => "Bold",
            (false, true) => "Italic",
            (false, false) => "Regular",
        };

        let target_filename = format!("{}-{}.ttf", style.font_family, weight);

        let embedded_file = EmbeddedFonts::get(&target_filename)
            .or_else(|| {
                if weight == "BoldItalic" {
                    EmbeddedFonts::get(&format!("{}-Bold.ttf", style.font_family))
                } else {
                    None
                }
            })
            .or_else(|| {
                if weight == "BoldItalic" {
                    EmbeddedFonts::get(&format!("{}-Italic.ttf", style.font_family))
                } else {
                    None
                }
            })
            .or_else(|| EmbeddedFonts::get(&format!("{}-Regular.ttf", style.font_family)))
            .or_else(|| EmbeddedFonts::get(&format!("Roboto-{}.ttf", weight)))
            .unwrap_or_else(|| {
                EmbeddedFonts::get("Roboto-Regular.ttf")
                    .expect("A fonte de segurança Roboto-Regular.ttf sumiu do sistema!")
            });

        let mut font_cursor = Cursor::new(embedded_file.data.as_ref());
        doc.add_external_font(&mut font_cursor)
            .map_err(|_| "Erro fonte nativa")?
    };

    font_cache.insert(font_key, loaded_font.clone());
    Ok(loaded_font)
}

fn process_background_image(
    path: &str,
    bg_hex: &str,
    opacity: f32,
) -> Result<DynamicImage, String> {
    let clean_path = path.trim_matches('"').trim();

    let prefixes = [
        "asset://localhost/",
        "http://asset.localhost/",
        "https://asset.localhost/",
        "http://asset:localhost/",
    ];

    let mut final_path = clean_path.to_string();
    for prefix in &prefixes {
        if final_path.starts_with(prefix) {
            final_path = final_path.replacen(prefix, "", 1);
            break;
        }
    }

    #[cfg(unix)]
    let final_path = if !final_path.starts_with('/') {
        format!("/{}", final_path)
    } else {
        final_path
    };

    let mut img = open(&final_path)
        .map_err(|e| {
            format!(
                "Erro ao abrir imagem: {} | Caminho tentado: {}",
                e, final_path
            )
        })?
        .to_rgba8();

    let hex = bg_hex.trim_start_matches('#');
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
    let bg_color = Rgba([r, g, b, 255]);

    let alpha_factor = opacity / 100.0;

    for pixel in img.pixels_mut() {
        let img_r = pixel[0] as f32;
        let img_g = pixel[1] as f32;
        let img_b = pixel[2] as f32;

        let final_r = (img_r * alpha_factor) + (bg_color[0] as f32 * (1.0 - alpha_factor));
        let final_g = (img_g * alpha_factor) + (bg_color[1] as f32 * (1.0 - alpha_factor));
        let final_b = (img_b * alpha_factor) + (bg_color[2] as f32 * (1.0 - alpha_factor));

        *pixel = Rgba([final_r as u8, final_g as u8, final_b as u8, 255]);
    }

    Ok(DynamicImage::ImageRgba8(img))
}

#[tauri::command]
pub async fn generate_pdf(
    save_path: String,
    slides: Vec<SlideInput>,
    design: DesignInput,
    credits: CreditsInput, // ← NOVO
) -> Result<String, String> {
    let doc_width = Mm(254.0);
    let doc_height = Mm(142.875);
    let (doc, page1, layer1) = PdfDocument::new("Apresentacao", doc_width, doc_height, "Fundo");

    let bg_data = if let Some(media_path) = &design.bg_media {
        let opacity = design.bg_opacity.unwrap_or(100.0);
        let img = process_background_image(media_path, &design.bg_color, opacity)?;
        let mut img_bytes: Vec<u8> = Vec::new();
        img.write_to(&mut Cursor::new(&mut img_bytes), ::image::ImageFormat::Jpeg)
            .map_err(|e| e.to_string())?;
        Some((img_bytes, img.width(), img.height()))
    } else {
        None
    };

    let mut font_cache: HashMap<String, IndirectFontRef> = HashMap::new();

    for (index, slide) in slides.iter().enumerate() {
        let (page, bg_layer_index) = if index == 0 {
            (page1, layer1)
        } else {
            doc.add_page(doc_width, doc_height, "Camada de Fundo")
        };

        let bg_layer = doc.get_page(page).get_layer(bg_layer_index);

        // --- FUNDO ---
        if let Some((ref bytes, width, height)) = bg_data {
            let dpi = 300.0;
            let img_w_mm = (width as f32 * 25.4) / dpi;
            let img_h_mm = (height as f32 * 25.4) / dpi;
            let scale_x = 254.0 / img_w_mm;
            let scale_y = 142.875 / img_h_mm;

            let xobject = ImageXObject {
                width: Px(width as usize),
                height: Px(height as usize),
                color_space: ColorSpace::Rgb,
                bits_per_component: ColorBits::Bit8,
                interpolate: true,
                image_data: bytes.clone(),
                image_filter: Some(ImageFilter::DCT),
                smask: None,
                clipping_bbox: None,
            };

            Image::from(xobject).add_to_layer(
                bg_layer,
                ImageTransform {
                    translate_x: Some(Mm(0.0)),
                    translate_y: Some(Mm(0.0)),
                    scale_x: Some(scale_x),
                    scale_y: Some(scale_y),
                    dpi: Some(dpi),
                    ..Default::default()
                },
            );
        }

        // --- CAMADA DE TEXTO ---
        let text_layer = doc.get_page(page).add_layer("Camada de Texto");
        let style = &slide.style;

        let current_font = load_font(&doc, style, &mut font_cache, false, None)?;

        // Cor do texto
        let hex = style.color.trim_start_matches('#');
        let r = u8::from_str_radix(hex.get(0..2).unwrap_or("FF"), 16).unwrap_or(255) as f32 / 255.0;
        let g = u8::from_str_radix(hex.get(2..4).unwrap_or("FF"), 16).unwrap_or(255) as f32 / 255.0;
        let b = u8::from_str_radix(hex.get(4..6).unwrap_or("FF"), 16).unwrap_or(255) as f32 / 255.0;
        text_layer.set_fill_color(Color::Rgb(Rgb::new(r, g, b, None)));

        // --- DECIDIR ESTRATÉGIA DE CRÉDITOS ---
        let show_credits_below = credits.enabled && credits.cover_only && slide.is_cover_slide;
        let show_credits_corner = credits.enabled && !credits.cover_only && !slide.is_cover_slide;

        // --- TEXTO PRINCIPAL (com matemática original) ---
        let lines: Vec<&str> = slide.text.lines().collect();
        let line_height = style.font_size * 0.45;

        // Se vai ter créditos abaixo, considera o espaço extra no total
        let credits_font_size = style.font_size * 0.20;
        let credits_extra_height = if show_credits_below {
            credits_font_size * 0.45 + 2.0 // altura do crédito + pequeno gap
        } else {
            0.0
        };

        let total_text_height = (lines.len() as f32 * line_height) + credits_extra_height;

        let box_x_mm = (design.pos_x / 100.0) * 254.0;
        let box_y_top_mm = 142.875 - ((design.pos_y / 100.0) * 142.875);
        let box_w_mm = (design.width / 100.0) * 254.0;
        let box_h_mm = (design.height / 100.0) * 142.875;

        let y_center_box = box_y_top_mm - (box_h_mm / 2.0);
        let y_start_mm = y_center_box + (total_text_height / 2.0) - (style.font_size * 0.35);

        for (i, line) in lines.iter().enumerate() {
            let y_line = y_start_mm - (i as f32 * line_height);
            let mut final_x = box_x_mm;

            if style.align == "center" {
                let approx_text_width = (line.chars().count() as f32) * (style.font_size * 0.17);
                final_x = box_x_mm + (box_w_mm / 2.0) - (approx_text_width / 2.0);
            } else if style.align == "right" {
                let approx_text_width = (line.chars().count() as f32) * (style.font_size * 0.17);
                final_x = box_x_mm + box_w_mm - approx_text_width;
            }

            text_layer.use_text(
                *line,
                style.font_size,
                Mm(final_x),
                Mm(y_line),
                &current_font,
            );
        }

        // ═══════════════════════════════════════════════════════════════
        // CRÉDITOS ABAIXO DO TÍTULO (modo capa)
        // ═══════════════════════════════════════════════════════════════
        if show_credits_below {
            let credits_font = load_font(&doc, style, &mut font_cache, true, Some(false))?;

            let credits_font_size = style.font_size * 0.20;
            let credits_line_height = credits_font_size * 0.45;

            // Quebra créditos em linhas
            let credits_lines: Vec<&str> = credits
                .text
                .lines()
                .filter(|l| !l.trim().is_empty())
                .collect();

            // Posição inicial: logo abaixo da última linha do título
            let last_title_y = y_start_mm - ((lines.len() - 1) as f32 * line_height);
            let first_credit_y = last_title_y - line_height - 1.0; // 1mm de gap

            for (i, credit_line) in credits_lines.iter().enumerate() {
                let credit_y = first_credit_y - (i as f32 * credits_line_height);

                let approx_credits_width =
                    (credit_line.chars().count() as f32) * (credits_font_size * 0.17);

                let credit_x = if style.align == "center" {
                    box_x_mm + (box_w_mm / 2.0) - (approx_credits_width / 2.0)
                } else if style.align == "right" {
                    box_x_mm + box_w_mm - approx_credits_width
                } else {
                    box_x_mm
                };

                text_layer.use_text(
                    *credit_line,
                    credits_font_size,
                    Mm(credit_x),
                    Mm(credit_y),
                    &credits_font,
                );
            }
        }
        // ═══════════════════════════════════════════════════════════════
        // CRÉDITOS NO CANTO (slides que não são capa)
        // ═══════════════════════════════════════════════════════════════
        if show_credits_corner {
            let credits_font = load_font(&doc, style, &mut font_cache, true, Some(false))?;

            let credits_font_size = style.font_size * 0.30;
            let credits_line_height = credits_font_size * 0.45;

            let credits_lines: Vec<&str> = credits
                .text
                .lines()
                .filter(|l| !l.trim().is_empty())
                .collect();
            let line_count = credits_lines.len() as f32;
            let total_credits_height = line_count * credits_line_height;

            let margin_x = 4.0;
            let margin_y = 4.0;

            let is_right = matches!(credits.position.as_str(), "top-right" | "bottom-right" | "");
            let is_top = matches!(credits.position.as_str(), "top-left" | "top-right");
            let align_right = is_right || credits.position.is_empty();

            // Y da PRIMEIRA linha (a partir do topo do bloco de créditos)
            let block_top_y = if is_top {
                142.875 - margin_y - credits_line_height
            } else {
                // bottom: topo do bloco = baseline da primeira linha (que é a "mais alta")
                margin_y + total_credits_height - credits_line_height
            };

            for (i, credit_line) in credits_lines.iter().enumerate() {
                let credit_y = block_top_y - (i as f32 * credits_line_height);

                let approx_credits_width =
                    (credit_line.chars().count() as f32) * (credits_font_size * 0.17);

                let credit_x = if align_right {
                    254.0 - margin_x - approx_credits_width
                } else {
                    margin_x
                };

                text_layer.use_text(
                    *credit_line,
                    credits_font_size,
                    Mm(credit_x),
                    Mm(credit_y),
                    &credits_font,
                );
            }
        }
    }

    let file = File::create(&save_path).map_err(|e| e.to_string())?;
    doc.save(&mut BufWriter::new(file))
        .map_err(|e| e.to_string())?;

    Ok("PDF Gerado com Sucesso!".to_string())
}
