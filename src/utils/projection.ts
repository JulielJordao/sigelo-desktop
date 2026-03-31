import { invoke } from '@tauri-apps/api/core'; // Use '@tauri-apps/api/tauri' se estiver no Tauri v1
import { useConfigStore } from '../stores/useConfigStore';

/**
 * Envia o conteúdo para a tela de projeção aplicando as configurações globais.
 * @param contentHtml O conteúdo base (ex: letra da música ou versículo)
 */
export async function startProjection(contentHtml: string) {
  const store = useConfigStore();
  const settings = store.settings;

  // Monta um container aplicando as configurações de Safe Area, Opacidade, etc.
  const styledHtmlPayload = `
    <div 
      class="projection-container theme-${settings.activeTheme.toLowerCase()}" 
      style="
        padding: ${settings.marginTop}px ${settings.marginRight}px ${settings.marginBottom}px ${settings.marginLeft}px;
        opacity: ${settings.bgOpacity / 100};
        aspect-ratio: ${settings.aspectRatio.replace(':', '/')};
        /* Se for usar Chroma Key, você pode injetar a cor de fundo aqui */
        background-color: ${settings.chromaKey !== 'none' ? settings.chromaKey : 'transparent'};
        width: 100vw;
        height: 100vh;
        box-sizing: border-box;
        transition: opacity 0.3s ${settings.transitionType === 'fade' ? 'ease-in-out' : 'none'};
      "
    >
      ${contentHtml}
    </div>
  `;

  try {
    // Chama a função Rust 'update_projection' com o HTML formatado
    await invoke('update_projection', { html: styledHtmlPayload });
    console.log('Projeção atualizada com sucesso!');
  } catch (error) {
    console.error('Erro ao atualizar a projeção pelo Tauri:', error);
  }
}

export interface FontSizeCalcParams {
    maxLines?: number;     // Usado para músicas
    maxChars?: number;     // NOVO: Usado para a Bíblia (texto longo)
    aspectRatio: string;
    customWidth?: number;
    customHeight?: number;
    lineHeight?: number;
    safeMargin?: number;
    absoluteMin?: number;
    absoluteMax?: number;
}

export interface FontSizeCalcParams {
    maxLines?: number;     // Usado para músicas e para contar quebras de verso na Bíblia
    maxChars?: number;     // Usado para a Bíblia (texto longo)
    aspectRatio: string;
    customWidth?: number;
    customHeight?: number;
    lineHeight?: number;
    safeMargin?: number;
    absoluteMin?: number;
    absoluteMax?: number;
}

export function calculateMaxFontSize({
    maxLines,
    maxChars,
    aspectRatio,
    customWidth = 1920,
    customHeight = 1080,
    lineHeight = 1.2,
    safeMargin = 0.85, // Voltamos para os confortáveis 85%
    absoluteMin = 2,
    absoluteMax = 20
}: FontSizeCalcParams): number {
    
    // 1. Resolve a proporção da tela
    let width = 16;
    let height = 9;
    if (aspectRatio === '4:3') { width = 4; height = 3; }
    else if (aspectRatio === 'custom') { width = customWidth; height = customHeight; }
    else if (aspectRatio.includes(':')) {
        const parts = aspectRatio.split(':');
        width = parseFloat(parts[0]) || 16;
        height = parseFloat(parts[1]) || 9;
    }
    const ratio = width / height;

    let calculatedMax = 10;

    // LÓGICA 1: BÍBLIA (Baseada em Área de Caracteres)
    if (maxChars && maxChars > 0) {
        // Uma constante matemática empírica (aprox 8500) que representa a área útil do CQI
        // multiplicada pela sua margem de segurança.
        const usableArea = 8500 * safeMargin;
        
        // A fonte ao quadrado é a área útil dividida pelos caracteres e pela proporção da tela
        const fontSizeSquared = usableArea / (maxChars * ratio);
        
        // Achamos o tamanho base da fonte!
        calculatedMax = Math.sqrt(fontSizeSquared);

        // Ajuste fino: Descontamos um pouquinho de espaço se houver muitos 
        // parágrafos (versículos separados por <br><br>)
        if (maxLines && maxLines > 1) {
            calculatedMax -= (maxLines * 0.15); // Tira 0.15cqi por cada quebra de parágrafo
        }
    } 
    // LÓGICA 2: MÚSICA (Baseada estritamente em linhas)
    else if (maxLines && maxLines > 0) {
        const lines = Math.max(1, maxLines);
        // A altura da tela em CQI é (100 / proporção)
        const containerHeightCqi = 100 / ratio;
        calculatedMax = (containerHeightCqi / (lines * lineHeight)) * safeMargin;
    }

    // Arredonda para 1 casa decimal e corta nos limites mínimos/máximos
    const rounded = Math.floor(calculatedMax * 10) / 10;
    return Math.min(absoluteMax, Math.max(absoluteMin, rounded));
}

// NOVO: Função específica para a Bíblia para descobrir o slide mais "gordo"
export function getMaxCharsFromSlides(slides: any[]): number {
    if (!slides || slides.length === 0) return 50;

    let maxChars = 0;
    slides.forEach(slide => {
        // Remove tags HTML (como as de superscript dos versículos) para contar só as letras reais
        const cleanText = (slide.htmlContent || slide.text || '').replace(/<[^>]*>?/gm, '');
        if (cleanText.length > maxChars) maxChars = cleanText.length;
    });

    return maxChars;
}

// Mantemos a antiga para as Músicas
export function getMaxLinesFromSlides(slides: any[]): number {
    if (!slides || slides.length === 0) return 1;

    let max = 1;
    slides.forEach(slide => {
        const content = slide.text || slide.htmlContent || '';
        const lines = content.split(/\n|<br\s*\/?>/i).length;
        if (lines > max) max = lines;
    });

    return max;
}