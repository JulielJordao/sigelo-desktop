import { invoke } from '@tauri-apps/api/core';
import { save, message } from '@tauri-apps/plugin-dialog';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { usePresentationStore } from '../stores/usePresentationStore';
import { useConfigStore } from "../stores/useConfigStore";
import { useMusicPresentationStore } from '../stores/presentationStore';
import { useFontStore } from '../stores/useFontStore';
import { formatAuthorCredits } from './formatCredits'; // ← ajuste o caminho

export interface SlideInput {
    text: string;
    style: any;
    isCoverSlide: boolean;
}

export interface CreditsInput {
    enabled: boolean;
    text: string;
    coverOnly: boolean;
    position: string;
}

export const exportToPDF = async () => {
    const configStore = useConfigStore();
    const musicPresentation = useMusicPresentationStore();
    const presentationStore = usePresentationStore();
    const fontStore = useFontStore();
    const design = presentationStore.design;

    if (!musicPresentation.activeSong?.id) {
        await message('Nenhuma música selecionada para exportação.', { title: 'Aviso', kind: 'warning' });
        return;
    }

    const appData = await appLocalDataDir();

    // ==========================================
    // DADOS DE CRÉDITOS (mesma lógica do PPTX)
    // ==========================================
    const creditsText: string = formatAuthorCredits(musicPresentation.activeSong as any) || '';
    const credits: CreditsInput = {
        enabled: !!design.authorCredits && creditsText.trim().length > 0,
        text: creditsText,
        coverOnly: !!design.authorCreditsCoverOnly,
        position: design.authorCreditsPosition || 'bottom-right',
    };

    // ==========================================
    // SLIDES com style + flag de capa
    // ==========================================
    const slidesData: SlideInput[] = await Promise.all(musicPresentation.listSlides.map(async (it) => {
        const type = musicPresentation.getSlideTypeByLabel(it.label) || 'geral';
        const currentStyle = presentationStore.textStyles[type];

        const selectedFont = fontStore.allFonts.find(f => f.title === currentStyle.fontFamily);
        const isCustom = selectedFont?.isCustom ?? false;

        let customFontPath: string | null = null;
        if (isCustom && selectedFont) {
            customFontPath = await join(appData, 'cache', 'fonts', `${selectedFont.value}.ttf`);
        }

        return {
            text: it.text,
            isCoverSlide: type === 'titulo',
            style: {
                color: currentStyle.color,
                fontSize: currentStyle.fontSize * 6,
                align: currentStyle.align,
                fontFamily: selectedFont?.value || 'Roboto',
                isBold: currentStyle.bold,
                isItalic: currentStyle.italic,
                isCustom: isCustom,
                customFontPath: customFontPath,
            }
        };
    }));

    const savePath = await save({
        filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
        defaultPath: `${musicPresentation.activeSong?.fullName}.pdf`,
    });

    if (!savePath) return;

    try {
        const result = await invoke<string>('generate_pdf', {
            savePath: savePath,
            slides: slidesData,
            design: {
                bgColor: design.bgColor || '#000000',
                bgMedia: cleanBgPath(design.bgMedia || null),
                bgOpacity: configStore.settings.bgOpacity || 100,
                posX: design.posX,
                posY: design.posY,
                width: design.width,
                height: design.height,
            },
            credits: credits, // ← NOVO parâmetro
        });
        await message(result, { title: 'Sucesso', kind: 'info' });
    } catch (error) {
        console.error("Erro ao gerar PDF:", error);
        await message(`Erro ao gerar PDF: ${error}`, { title: 'Erro', kind: 'error' });
    }
};

const cleanBgPath = (path: string | null | undefined) => {
    if (!path) return null;
    let decodedPath = path.replace(/^asset:\/\/localhost\//, '').replace(/^https:\/\/asset.localhost\//, '');
    return decodeURIComponent(decodedPath);
};