import { invoke } from '@tauri-apps/api/core';
import { save, message } from '@tauri-apps/plugin-dialog';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { usePresentationStore } from '../stores/usePresentationStore';
import { useConfigStore } from "../stores/useConfigStore"; 
import { useMusicPresentationStore } from '../stores/presentationStore';
import { useFontStore } from '../stores/useFontStore';

// 1. Atualizamos a interface para enviar o estilo junto com o texto
export interface SlideInput {
    text: string;
    style: any; 
}

export const exportToPDF = async () => {
    const configStore = useConfigStore();
    const musicPresentation = useMusicPresentationStore();
    const presentationStore = usePresentationStore();
    const fontStore = useFontStore();
    const design = presentationStore.design;

    if (!musicPresentation.activeSong?._id) {
        await message('Nenhuma música selecionada para exportação.', { title: 'Aviso', kind: 'warning' });
        return;
    }

    const appData = await appLocalDataDir();

    // 2. LÓGICA DINÂMICA (Idêntica ao PPTX)
    const slidesData: SlideInput[] = await Promise.all(musicPresentation.listSlides.map(async (it) => {
        // Descobre se é titulo, verso, refrao, etc.
        const type = musicPresentation.getSlideTypeByLabel(it.label) || 'geral';
        const currentStyle = presentationStore.textStyles[type];
        
        // Pega as informações da fonte
        const selectedFont = fontStore.allFonts.find(f => f.title === currentStyle.fontFamily);
        const isCustom = selectedFont?.isCustom ?? false;
        
        let customFontPath: string | null = null;
        if (isCustom && selectedFont) {
            customFontPath = await join(appData, 'cache', 'fonts', `${selectedFont.value}.ttf`);
        }

        // Retorna o texto acoplado com o seu próprio estilo
        return {
            text: it.text,
            style: {
                color: currentStyle.color,
                fontSize: currentStyle.fontSize * 6, // Multiplicador para o PDF
                align: currentStyle.align,
                fontFamily: selectedFont?.value || 'Roboto',
                isBold: currentStyle.bold,
                isItalic: currentStyle.italic,
                isCustom: isCustom,
                customFontPath: customFontPath
            }
        };
    }));

    const savePath = await save({
        filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
        defaultPath: `${musicPresentation.activeSong?.fullName}.pdf`
    });

    if (!savePath) return;

    try {
        // 3. ENVIANDO PARA O RUST (O estilo global sumiu, agora vai dentro de slidesData)
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
                height: design.height
            }
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