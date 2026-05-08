use ::image::{open, DynamicImage, Rgba};
use printpdf::*;
use rust_embed::RustEmbed;
use serde::Deserialize;
use std::collections::HashMap; // <-- NOVO: Para o Cache de Fontes
use std::fs::File;
use std::io::{BufWriter, Cursor};

#[derive(RustEmbed)]
#[folder = "src/fonts/"]
struct EmbeddedFonts;

// 1. O Style Input continua igual
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

// 2. Mas agora ele mora DENTRO do SlideInput!
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlideInput {
    pub text: String,
    pub style: StyleInput, // O estilo dinâmico vem aqui!
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

// 2. ASSINATURA CORRIGIDA: Agora retorna diretamente `DynamicImage`
fn process_background_image(
    path: &str,
    bg_hex: &str,
    opacity: f32,
) -> Result<DynamicImage, String> {
    // Agora o Rust sabe que `open` vem da biblioteca externa ::image
    let clean_path = path.trim_matches('"').trim();

    let prefixes = [
        "asset://localhost/",
        "http://asset.localhost/",
        "https://asset.localhost/",
        "http://asset:localhost/", // Caso venha com dois pontos em alguma config
    ];

    // Se por acaso ainda vier o prefixo, remove aqui também
    let mut final_path = clean_path.to_string();

    for prefix in &prefixes {
        if final_path.starts_with(prefix) {
            final_path = final_path.replacen(prefix, "", 1);
            break;
        }
    }

    // No macOS, caminhos absolutos precisam começar com /
    // Se após remover o prefixo não começar com /, e for Unix, adicionamos
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
// 3. Removemos o parâmetro style global daqui da assinatura
pub async fn generate_pdf(
    save_path: String,
    slides: Vec<SlideInput>,
    design: DesignInput,
) -> Result<String, String> {
    let doc_width = Mm(254.0);
    let doc_height = Mm(142.875);
    let (doc, page1, layer1) = PdfDocument::new("Apresentacao", doc_width, doc_height, "Fundo");

    // [PREPARAÇÃO DO FUNDO - MANTENHA IGUAL]
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

    // 4. CACHE DE FONTES (Para não estourar a memória carregando fonte repetida)
    let mut font_cache: HashMap<String, IndirectFontRef> = HashMap::new();

    // =====================================================
    // GERAÇÃO DOS SLIDES
    // =====================================================
    for (index, slide) in slides.iter().enumerate() {
        let (page, bg_layer_index) = if index == 0 {
            (page1, layer1)
        } else {
            doc.add_page(doc_width, doc_height, "Camada de Fundo")
        };

        let bg_layer = doc.get_page(page).get_layer(bg_layer_index);

        // --- APLICAR FUNDO COM ESCALA CORRETA (MANTENHA O QUE FIZEMOS) ---
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

        // 2. LÓGICA DA FONTE (AGORA COM ITÁLICO)
        // 5. LÓGICA DA FONTE (AGORA COM CASCATA DE FALLBACK)
        let font_key = format!(
            "{}_{}_{}_{}",
            style.font_family, style.is_bold, style.is_italic, style.is_custom
        );

        let current_font = if let Some(cached_font) = font_cache.get(&font_key) {
            cached_font.clone()
        } else {
            let loaded_font = if style.is_custom {
                if let Some(path) = &style.custom_font_path {
                    let font_file =
                        File::open(path).map_err(|e| format!("Erro ao abrir: {}", e))?;
                    doc.add_external_font(font_file)
                        .map_err(|_| "Erro embutir custom")?
                } else {
                    return Err("Caminho custom vazio.".to_string());
                }
            } else {
                let weight = match (style.is_bold, style.is_italic) {
                    (true, true) => "BoldItalic",
                    (true, false) => "Bold",
                    (false, true) => "Italic",
                    (false, false) => "Regular",
                };

                let target_filename = format!("{}-{}.ttf", style.font_family, weight);

                // === A CASCATA INTELIGENTE ===
                let embedded_file = EmbeddedFonts::get(&target_filename)
                    // 1. Se pediu BoldItalic e falhou, tenta salvar pelo menos o Bold da mesma família
                    .or_else(|| {
                        if weight == "BoldItalic" {
                            EmbeddedFonts::get(&format!("{}-Bold.ttf", style.font_family))
                        } else {
                            None
                        }
                    })
                    // 2. Se não achou Bold, tenta pelo menos o Italic da mesma família
                    .or_else(|| {
                        if weight == "BoldItalic" {
                            EmbeddedFonts::get(&format!("{}-Italic.ttf", style.font_family))
                        } else {
                            None
                        }
                    })
                    // 3. Falhou as variações? Tenta o Regular da MESMA família (Ex: Montserrat-Regular)
                    .or_else(|| EmbeddedFonts::get(&format!("{}-Regular.ttf", style.font_family)))
                    // 4. A família inteira sumiu? Vai pro Roboto, mas TENTA MANTER O PESO (Ex: Roboto-BoldItalic)
                    .or_else(|| EmbeddedFonts::get(&format!("Roboto-{}.ttf", weight)))
                    // 5. Último recurso absoluto para o app não crashar (Roboto-Regular)
                    .unwrap_or_else(|| {
                        EmbeddedFonts::get("Roboto-Regular.ttf")
                            .expect("A fonte de segurança Roboto-Regular.ttf sumiu do sistema!")
                    });

                let mut font_cursor = Cursor::new(embedded_file.data.as_ref());
                doc.add_external_font(&mut font_cursor)
                    .map_err(|_| "Erro fonte nativa")?
            };
            font_cache.insert(font_key, loaded_font.clone());
            loaded_font
        };

        // COR DO TEXTO
        let hex = style.color.trim_start_matches('#');
        let r = u8::from_str_radix(hex.get(0..2).unwrap_or("FF"), 16).unwrap_or(255) as f32 / 255.0;
        let g = u8::from_str_radix(hex.get(2..4).unwrap_or("FF"), 16).unwrap_or(255) as f32 / 255.0;
        let b = u8::from_str_radix(hex.get(4..6).unwrap_or("FF"), 16).unwrap_or(255) as f32 / 255.0;
        text_layer.set_fill_color(Color::Rgb(Rgb::new(r, g, b, None)));

        // 3. A NOVA MATEMÁTICA DE CAIXA DE TEXTO (Respeitando X, Y, Width e Height)
        let lines: Vec<&str> = slide.text.lines().collect();
        let line_height = style.font_size * 0.45;
        let total_text_height = lines.len() as f32 * line_height;

        // Limites da "Caixa" (Bounding Box) baseada nas porcentagens
        let box_x_mm = (design.pos_x / 100.0) * 254.0;
        let box_y_top_mm = 142.875 - ((design.pos_y / 100.0) * 142.875);
        let box_w_mm = (design.width / 100.0) * 254.0;
        let box_h_mm = (design.height / 100.0) * 142.875;

        // Centralização Vertical (Igual ao valign: 'middle' do PPTX)
        // Pega o meio da caixa e sobe metade do tamanho do bloco de texto
        let y_center_box = box_y_top_mm - (box_h_mm / 2.0);
        let y_start_mm = y_center_box + (total_text_height / 2.0) - (style.font_size * 0.35); // O 0.35 é o ajuste da "linha de base" da fonte

        for (i, line) in lines.iter().enumerate() {
            let y_line = y_start_mm - (i as f32 * line_height);
            let mut final_x = box_x_mm;

            // Alinhamento Horizontal restrito à largura da caixa
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
    }

    let file = File::create(&save_path).map_err(|e| e.to_string())?;
    doc.save(&mut BufWriter::new(file))
        .map_err(|e| e.to_string())?;

    Ok("PDF Gerado com Sucesso!".to_string())
}
