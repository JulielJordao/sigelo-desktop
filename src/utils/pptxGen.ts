import pptxgen from "pptxgenjs";
import { usePresentationStore } from '../stores/usePresentationStore';
import { useConfigStore } from "../stores/useConfigStore";
import { useMusicPresentationStore } from '../stores/presentationStore';
import { writeFile, readFile } from '@tauri-apps/plugin-fs';
import { save, message } from '@tauri-apps/plugin-dialog';
import { formatAuthorCredits } from './formatCredits'; // ← ajuste o caminho

export interface Slide {
    text: string;
    type: 'titulo' | 'verso' | 'refrao' | 'geral';
}

// Dimensões do slide 16:9 em polegadas (padrão pptxgenjs)
const SLIDE_W = 10;
const SLIDE_H = 5.625;

// ═══════════════════════════════════════════════════════════════════════
// CONVERSÃO cqi → pt
// ─────────────────────────────────────────────────────────────────────────
// No preview o tamanho é `${fontSize}cqi`, onde 1cqi = 1% da largura
// do container (= caixa de texto, que tem `width: ${design.width}%`).
// 
// Largura da caixa em polegadas = SLIDE_W * (design.width / 100)
// 1cqi em polegadas = (largura da caixa) / 100
// 1 polegada = 72pt
// Logo: 1cqi em pt = SLIDE_W * (design.width / 100) / 100 * 72
//                  = SLIDE_W * design.width * 0.0072
// ═══════════════════════════════════════════════════════════════════════
const PPTX_CALIBRATION = 0.95;

const cqiToPt = (cqiValue: number, boxWidthPercent: number): number => {
    const boxWidthInches = SLIDE_W * (boxWidthPercent / 100);
    const onePixCqiInInches = boxWidthInches / 100;
    const rawPt = cqiValue * onePixCqiInInches * 72;
    return rawPt * PPTX_CALIBRATION;
};

export const exportToPPTX = async () => {
    const configStore = useConfigStore();
    const musicPresentation = useMusicPresentationStore();
    const store = usePresentationStore();
    const design = store.design;

    if (!musicPresentation.activeSong?.id) {
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
    // DADOS DE CRÉDITOS
    // ==========================================
    const creditsText: string = formatAuthorCredits(musicPresentation.activeSong as any) || '';
    const creditsEnabled: boolean = !!design.authorCredits && creditsText.trim().length > 0;
    const creditsCoverOnly: boolean = !!design.authorCreditsCoverOnly;
    const creditsPosition: string = design.authorCreditsPosition || 'bottom-right';

    // ==========================================
    // PREPARAÇÃO DO FUNDO
    // ==========================================
    let processedBgData: string | null = null;
    const fallbackColor = design.bgColor ? design.bgColor.replace('#', '') : '000000';

    if (design.bgMedia && design.bgType !== 'color') {
        try {
            const opacity = configStore.settings.bgOpacity ?? 100;
            const hexColor = design.bgColor || '#000000';
            processedBgData = await processBackgroundImage(design.bgMedia, opacity, hexColor);
        } catch (error) {
            console.error("Erro ao processar imagem de fundo:", error);
            await message('Houve um erro ao processar a imagem de fundo. A cor sólida será usada.', { title: 'Aviso', kind: 'warning' });
        }
    }

    // ==========================================
    // GERAÇÃO DO POWERPOINT
    // ==========================================
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_16x9';

    // Define UM master slide com o fundo. Todos os slides que usarem
    // esse master compartilham a MESMA imagem embutida internamente
    // pelo pptxgenjs, em vez de duplicar.
    if (processedBgData) {
        pptx.defineSlideMaster({
            title: 'BG_MASTER',
            background: { data: processedBgData },
        });
    } else {
        pptx.defineSlideMaster({
            title: 'BG_MASTER',
            background: { color: fallbackColor },
        });
    }

    songSlides.forEach((slide) => {
        const pptSlide = pptx.addSlide({ masterName: 'BG_MASTER' });
        const isCoverSlide = slide.type === 'titulo';

        // --- POSIÇÕES ---
        const xPos = (design.posX / 100) * SLIDE_W;
        const yPos = (design.posY / 100) * SLIDE_H;
        const wSize = (design.width / 100) * SLIDE_W;
        const hSize = (design.height / 100) * SLIDE_H;

        const currentStyle = store.textStyles[slide.type || 'geral'];
        const mainFontSize = cqiToPt(currentStyle.fontSize, design.width);

        const showCreditsBelow = creditsEnabled && creditsCoverOnly && isCoverSlide;
        const showCreditsCorner = creditsEnabled && !creditsCoverOnly && !isCoverSlide;

        if (showCreditsBelow) {
            const creditsFontSize = Math.max(8, cqiToPt(currentStyle.fontSize * 0.20, design.width));

            // Divide o crédito em linhas individuais (cada linha vira um parágrafo)
            const creditsLines = creditsText.split('\n').filter(l => l.trim().length > 0);

            // Monta o array: título + cada linha de crédito como parágrafo separado
            const textParts: any[] = [
                {
                    text: slide.text,
                    options: {
                        fontSize: mainFontSize,
                        bold: currentStyle.bold,
                        italic: currentStyle.italic,
                        breakLine: true,
                    },
                },
            ];

            creditsLines.forEach((line, idx) => {
                textParts.push({
                    text: line,
                    options: {
                        fontSize: creditsFontSize,
                        italic: true,
                        bold: false,
                        breakLine: idx < creditsLines.length - 1, // todas menos a última quebram
                        // paraSpaceBefore só na primeira linha de créditos (separa do título)
                        paraSpaceBefore: idx === 0 ? 6 : 0,
                    },
                });
            });

            pptSlide.addText(textParts, {
                x: xPos,
                y: yPos,
                w: wSize,
                h: hSize,
                color: currentStyle.color.replace('#', ''),
                fontFace: currentStyle.fontFamily,
                align: currentStyle.align,
                valign: 'middle',
            });
        } else {
            pptSlide.addText(slide.text, {
                x: xPos,
                y: yPos,
                w: wSize,
                h: hSize,
                color: currentStyle.color.replace('#', ''),
                fontFace: currentStyle.fontFamily,
                fontSize: mainFontSize,
                align: currentStyle.align,
                bold: currentStyle.bold,
                italic: currentStyle.italic,
                valign: 'middle',
            });

            if (showCreditsCorner) {
                addCornerCredits(pptSlide, creditsText, creditsPosition, currentStyle, design.width);
            }
        }
    });

    const buffer = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;

    const savePath = await save({
        filters: [{ name: 'Apresentação PowerPoint', extensions: ['pptx'] }],
        defaultPath: `${musicPresentation.activeSong?.fullName}.pptx`,
    });

    if (savePath) {
        await writeFile(savePath, buffer);
        await message('Apresentação exportada com sucesso!', { title: 'Sucesso', kind: 'info' });
    }
};

// ═══════════════════════════════════════════════════════════════════════
// CRÉDITOS NO CANTO
// ═══════════════════════════════════════════════════════════════════════
const addCornerCredits = (
    pptSlide: pptxgen.Slide,
    text: string,
    position: string,
    style: any,
    boxWidthPercent: number
) => {
    const fontSize = Math.max(8, cqiToPt(style.fontSize * 0.30, boxWidthPercent));

    // Conta linhas reais do texto pra calcular altura da caixa
    const lineCount = Math.max(1, text.split('\n').length);
    const lineHeightInches = (fontSize / 72) * 1.3; // 1.3 = aproximação do line-height
    const boxH = Math.max(SLIDE_H * 0.08, lineHeightInches * lineCount + 0.1);

    const boxW = SLIDE_W * 0.40; // um pouco mais largo pra acomodar "Letra: Fulano"

    const marginX = 0.15;
    const marginY = 0.10;

    let x = 0;
    let y = 0;
    let align: 'left' | 'right' | 'center' = 'right';
    let valign: 'top' | 'bottom' | 'middle' = 'bottom';

    switch (position) {
        case 'top-left':
            x = marginX;
            y = marginY;
            align = 'left';
            valign = 'top';
            break;
        case 'top-right':
            x = SLIDE_W - boxW - marginX;
            y = marginY;
            align = 'right';
            valign = 'top';
            break;
        case 'bottom-left':
            x = marginX;
            y = SLIDE_H - boxH - marginY;
            align = 'left';
            valign = 'bottom';
            break;
        case 'bottom-right':
        default:
            x = SLIDE_W - boxW - marginX;
            y = SLIDE_H - boxH - marginY;
            align = 'right';
            valign = 'bottom';
            break;
    }

    pptSlide.addText(text, {
        x,
        y,
        w: boxW,
        h: boxH,
        color: style.color.replace('#', ''),
        fontFace: style.fontFamily,
        fontSize,
        align,
        valign,
        italic: true,
        transparency: 15,
    });
};

// ═══════════════════════════════════════════════════════════════════════
// FUNDO (inalterado)
// ═══════════════════════════════════════════════════════════════════════
const processBackgroundImage = async (
    imagePath: string,
    opacity: number,
    bgColorHex: string
): Promise<string> => {
    const fileBytes = await readFile(cleanPath(imagePath));
    const blob = new Blob([fileBytes]);
    const imageUrl = URL.createObjectURL(blob);

    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error("Não foi possível criar o contexto 2D do Canvas");

    const validBgColor = bgColorHex.startsWith('#') ? bgColorHex : `#${bgColorHex}`;
    ctx.fillStyle = validBgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalAlpha = opacity / 100;
    ctx.drawImage(img, 0, 0);

    const base64Data = canvas.toDataURL('image/jpeg', 0.9);
    URL.revokeObjectURL(imageUrl);

    return base64Data;
};

export const cleanPath = (imagePath: string): string => {
    if (!imagePath) return '';

    let clean = imagePath.trim().replace(/^["']|["']$/g, '');

    const prefixes = [
        "asset://localhost/",
        "http://asset.localhost/",
        "https://asset.localhost/",
        "http://asset:localhost/",
    ];

    for (const prefix of prefixes) {
        if (clean.startsWith(prefix)) {
            clean = clean.replace(prefix, "");
            break;
        }
    }

    return decodeURIComponent(clean);
};