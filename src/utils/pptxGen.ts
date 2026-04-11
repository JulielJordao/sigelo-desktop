import pptxgen from "pptxgenjs";
import { usePresentationStore } from '../stores/usePresentationStore';
import { useConfigStore } from "../stores/useConfigStore"; 
import { useMusicPresentationStore } from '../stores/presentationStore'
import { writeFile, readFile } from '@tauri-apps/plugin-fs'; 
import { save, message } from '@tauri-apps/plugin-dialog';

export interface Slide {
    text: string;
    type: 'titulo' | 'verso' | 'refrao' | 'geral';
}

export const exportToPPTX = async () => {
    const configStore = useConfigStore();
    const musicPresentation = useMusicPresentationStore();
    const store = usePresentationStore();
    const design = store.design;

    if (!musicPresentation.activeSong?._id) {
        await message('Nenhuma música está selecionada para exportação.', { title: 'Aviso', kind: 'warning' });
        return;
    }

    const isVideoBg = design.bgMedia && /\.(mp4|avi|mov|mkv|webm)$/i.test(design.bgMedia);
    if (isVideoBg) {
        await message('Não é possível gerar um PPTX com fundo de vídeo. Altere para cor ou imagem.', { title: 'Erro de Exportação', kind: 'error' });
        return; 
    }

    const songSlides: Slide[] = musicPresentation.listSlides.map(it => {
        return { text: it.text, type: musicPresentation.getSlideTypeByLabel(it.label) };
    });

    // ==========================================
    // PREPARAÇÃO DO FUNDO EM CACHE (CANVAS)
    // ==========================================
    let processedBgData: string | null = null;
    const fallbackColor = design.bgColor ? design.bgColor.replace('#', '') : '000000';

    if (design.bgMedia && design.bgType !== 'color') {
        try {
            const opacity = configStore.settings.bgOpacity ?? 100;
            const hexColor = design.bgColor || '#000000';
            
            // Gera o Base64 mesclado
            processedBgData = await processBackgroundImage(design.bgMedia, opacity, hexColor);
        } catch (error) {
            console.error("Erro ao processar imagem de fundo:", error);
            await message('Houve um erro ao processar a imagem de fundo. A cor sólida será usada.', { title: 'Aviso', kind: 'warning' });
        }
    }

    // ==========================================
    // GERAÇÃO DO POWERPOINT
    // ==========================================
    let pptx = new pptxgen();
    pptx.layout = 'LAYOUT_16x9'; 

    songSlides.forEach(slide => {
        let pptSlide = pptx.addSlide();

        // --- APLICAR FUNDO DEFINITIVO ---
        if (processedBgData) {
            // Usa a propriedade 'data' passando o Base64 gerado pelo Canvas
            pptSlide.background = { data: processedBgData };
        } else {
            // Fallback para cor sólida se não houver imagem ou se der erro
            pptSlide.background = { color: fallbackColor };
        }

        // --- MATEMÁTICA DAS POSIÇÕES ---
        const xPos = (design.posX / 100) * 10;
        const yPos = (design.posY / 100) * 5.625;
        const wSize = (design.width / 100) * 10;
        const hSize = (design.height / 100) * 5.625;

        // --- ESTILO DINÂMICO ---
        const currentStyle = store.textStyles[slide.type || 'geral']; 

        // --- APLICAR TEXTO ---
        pptSlide.addText(slide.text, {
            x: xPos,
            y: yPos,
            w: wSize,
            h: hSize,
            color: currentStyle.color.replace('#', ''),
            fontFace: currentStyle.fontFamily,
            fontSize: currentStyle.fontSize * 8,
            align: currentStyle.align,
            bold: currentStyle.bold,
            italic: currentStyle.italic,
            valign: 'middle'
        });
    });

    const buffer = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;

    const savePath = await save({
        filters: [{ name: 'Apresentação PowerPoint', extensions: ['pptx'] }],
        defaultPath: `${musicPresentation.activeSong?.fullName}.pptx`
    });

    if (savePath) {
        await writeFile(savePath, buffer);
        await message('Apresentação exportada com sucesso!', { title: 'Sucesso', kind: 'info' });
    }
};

const processBackgroundImage = async (
    imagePath: string, 
    opacity: number, 
    bgColorHex: string
): Promise<string> => {
    const fileBytes = await readFile(cleanPath(imagePath));
    
    // 2. Converte os bytes para um URL que a tag <img> consiga ler
    const blob = new Blob([fileBytes]);
    const imageUrl = URL.createObjectURL(blob);

    // 3. Carrega a imagem na memória
    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrl;
    });

    // 4. Cria um Canvas invisível com o mesmo tamanho da imagem original
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error("Não foi possível criar o contexto 2D do Canvas");

    // 5. Pinta o fundo inteiro com a cor escolhida pelo usuário
    // Garante que a cor tenha a hashtag (#) para o Canvas entender
    const validBgColor = bgColorHex.startsWith('#') ? bgColorHex : `#${bgColorHex}`;
    ctx.fillStyle = validBgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 6. Desenha a imagem por cima, aplicando a opacidade (0.0 a 1.0)
    ctx.globalAlpha = opacity / 100;
    ctx.drawImage(img, 0, 0);

    // 7. Exporta o resultado final como Base64 (usamos JPEG pois não precisamos mais de transparência)
    const base64Data = canvas.toDataURL('image/jpeg', 0.9);

    // Limpa a memória
    URL.revokeObjectURL(imageUrl);

    return base64Data;
};

/**
 * Limpa URIs do Tauri transformando-as em caminhos de arquivo puros para o SO.
 */
export const cleanPath = (imagePath: string): string => {
  if (!imagePath) return '';

  // 1. Remove aspas extras (comum em strings vindas de JSON) e espaços
  let clean = imagePath.trim().replace(/^["']|["']$/g, '');

  const prefixes = [
    "asset://localhost/",
    "http://asset.localhost/",
    "https://asset.localhost/",
    "http://asset:localhost/"
  ];

  // 2. Procura e remove apenas o primeiro prefixo encontrado
  for (const prefix of prefixes) {
    if (clean.startsWith(prefix)) {
      // No JS, o replace com string (não regex) substitui apenas a primeira ocorrência
      clean = clean.replace(prefix, "");
      break;
    }
  }

  // 3. Decodifica caracteres especiais (Ex: %20 -> " ", %3A -> ":")
  // Importante: Faça isso POR ÚLTIMO para não quebrar a lógica do startsWith
  return decodeURIComponent(clean);
};