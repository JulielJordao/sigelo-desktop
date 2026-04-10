use printpdf::*;
use serde::Deserialize;
use std::fs::File;
use std::io::{BufWriter, Cursor};
use rust_embed::RustEmbed;

// 1. IMPORTAÇÃO CORRETA: Adicionamos `open` e `ImageFormat` aqui
use ::image::{DynamicImage, Rgba, open}; 

#[derive(RustEmbed)]
#[folder = "src/fonts/"] 
struct EmbeddedFonts;

#[derive(Deserialize, Debug)]
pub struct SlideInput { pub text: String }

#[derive(Deserialize, Debug)]
pub struct StyleInput {
    pub color: String,
    pub font_size: f32,
    pub align: String,
    pub font_family: String,
    pub is_bold: bool,
    pub is_custom: bool,
    pub custom_font_path: Option<String>,
}

#[derive(Deserialize, Debug)]
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
fn process_background_image(path: &str, bg_hex: &str, opacity: f32) -> Result<DynamicImage, String> {
    // Agora o Rust sabe que `open` vem da biblioteca externa ::image
    let mut img = open(path).map_err(|e| format!("Erro ao abrir imagem: {}", e))?.to_rgba8();
    
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
    style: StyleInput,
) -> Result<String, String> {
    
    let doc_width = Mm(254.0);
    let doc_height = Mm(142.875);

    let (doc, page1, layer1) = PdfDocument::new("Apresentacao", doc_width, doc_height, "Layer 1");
    let mut current_layer = doc.get_page(page1).get_layer(layer1);

    // [PARTE DAS FONTES - MANTENHA IGUAL]
    let font = if style.is_custom {
        if let Some(path) = &style.custom_font_path {
            let font_file = File::open(path).map_err(|e| format!("Erro ao abrir fonte: {}", e))?;
            doc.add_external_font(font_file).map_err(|_| "Erro ao embutir fonte")?
        } else {
            return Err("Caminho da fonte não fornecido.".to_string());
        }
    } else {
        let weight = if style.is_bold { "Bold" } else { "Regular" };
        let target_filename = format!("{}-{}.ttf", style.font_family, weight);
        let embedded_file = EmbeddedFonts::get(&target_filename)
            .unwrap_or_else(|| EmbeddedFonts::get("Roboto-Regular.ttf").expect("Erro fallback"));
        let mut font_cursor = Cursor::new(embedded_file.data.as_ref());
        doc.add_external_font(&mut font_cursor).map_err(|_| "Erro fonte nativa")?
    };

    // =====================================================
    // 3. PREPARAÇÃO DO FUNDO (Guardamos os dados, não a Image)
    // =====================================================
    let bg_data = if let Some(media_path) = &design.bg_media {
        let opacity = design.bg_opacity.unwrap_or(100.0);
        let img = process_background_image(media_path, &design.bg_color, opacity)?;
        
        let mut img_bytes: Vec<u8> = Vec::new();
        img.write_to(&mut Cursor::new(&mut img_bytes), ::image::ImageFormat::Jpeg)
            .map_err(|e| format!("Erro bytes imagem: {}", e))?;
            
        // Guardamos uma tupla com (Bytes, Largura, Altura)
        Some((img_bytes, img.width(), img.height()))
    } else {
        None
    };

    // =====================================================
    // GERAÇÃO DOS SLIDES
    // =====================================================
    for (index, slide) in slides.iter().enumerate() {
        let (_page, _layer) = if index == 0 {
            (page1, layer1)
        } else {
            let (new_page, new_layer) = doc.add_page(doc_width, doc_height, format!("Layer {}", index + 1));
            current_layer = doc.get_page(new_page).get_layer(new_layer);
            (new_page, new_layer)
        };

        // --- APLICAR FUNDO (Recriamos a Image para cada slide) ---
        if let Some((ref bytes, width, height)) = bg_data {
            // Reconstruímos o XObject usando o .clone() dos bytes (que é permitido)
            let xobject = ImageXObject {
                width: Px(width as usize),
                height: Px(height as usize),
                color_space: ColorSpace::Rgb,
                bits_per_component: ColorBits::Bit8,
                interpolate: true,
                image_data: bytes.clone(), // Aqui o clone funciona!
                image_filter: Some(ImageFilter::DCT),
                smask: None,
                clipping_bbox: None,
            };

            // Criamos a Image "fresca" para este slide e usamos
            Image::from(xobject).add_to_layer(current_layer.clone(), ImageTransform {
                translate_x: Some(Mm(0.0)),
                translate_y: Some(Mm(0.0)),
                rotate: None,
                scale_x: Some(1.0),
                scale_y: Some(1.0),
                dpi: Some(300.0),
            });
        }

        // --- POSIÇÕES E TEXTO ---
        let x_mm = (design.pos_x / 100.0) * 254.0;
        let y_mm_from_top = (design.pos_y / 100.0) * 142.875;
        let y_mm = 142.875 - y_mm_from_top;

        current_layer.use_text(&slide.text, style.font_size, Mm(x_mm), Mm(y_mm), &font);
    }

    // SALVAR
    let file = File::create(&save_path).map_err(|e| format!("Erro criar arquivo: {}", e))?;
    let mut buf_writer = BufWriter::new(file);
    doc.save(&mut buf_writer).map_err(|e| format!("Erro salvar PDF: {}", e))?;

    Ok("PDF Gerado com Sucesso!".to_string())
}