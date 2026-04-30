import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { readDir, mkdir, copyFile, exists } from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join, basename } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export interface FontOption {
    title: string;
    value: string;
    cssValue: string;
    isCustom: boolean;
    /** Nome do arquivo sem extensão (ex: "Inter_18pt-Regular"). Usado pelo servidor de fontes. */
    fileName?: string;
    /** Caminho absoluto no disco — só presente em fontes custom */
    filePath?: string;
}

export const useFontStore = defineStore('fonts', () => {
    // 1. Começa VAZIO! Será preenchido automaticamente pela pasta
    const defaultFonts = ref<FontOption[]>([]);

    const customFonts = ref<FontOption[]>([]);
    const isLoading = ref(false);

    const allFonts = computed(() => [...customFonts.value, ...defaultFonts.value]);

    // ==========================================
    // CARREGA FONTES PADRÃO (Da pasta src/fonts)
    // ==========================================
    const loadDefaultFonts = async () => {
        // Evita carregar de novo se já preencheu a lista
        if (defaultFonts.value.length > 0) return;

        const fontFiles = import.meta.glob('../fonts/*.{ttf,otf}', {
            eager: true,
            query: '?url',
            import: 'default'
        });

        for (const [path, url] of Object.entries(fontFiles)) {
            const fileName = path.split('/').pop()?.replace(/\.[^/.]+$/, "") || "";

            // Separa o nome da família da variação (Ex: "Roboto-Bold" vira "Roboto")
            const family = fileName.split('-')[0];
            let weight = 'normal';
            let style = 'normal';

            if (fileName.includes('-Bold')) weight = 'bold';
            if (fileName.includes('Italic')) style = 'italic';

            try {
                const fontFace = new FontFace(family, `url(${url as string})`, { weight, style });
                const loadedFont = await fontFace.load();
                (document.fonts as any).add(loadedFont);

                // Só adiciona na lista do menu se ainda não existir essa família lá
                const alreadyExists = defaultFonts.value.some(f => f.title === family);
                if (!alreadyExists) {
                    defaultFonts.value.push({
                        title: family,
                        value: family,
                        cssValue: `"${family}", sans-serif`,
                        isCustom: false,
                        fileName, // ex: "Inter_18pt-Regular" — o servidor usa isso pra achar o arquivo
                    });
                }
            } catch (e) {
                console.error(`Erro ao injetar fonte padrão ${fileName}:`, e);
            }
        }
    };

    // ==========================================
    // CARREGA FONTES DO CACHE (HD)
    // ==========================================
    const loadCustomFonts = async () => {
        try {
            isLoading.value = true;
            const appData = await appLocalDataDir();
            const fontsFolder = await join(appData, 'cache', 'fonts');

            if (!(await exists(fontsFolder))) {
                await mkdir(fontsFolder, { recursive: true });
                return;
            }

            const entries = await readDir(fontsFolder);
            customFonts.value = [];

            for (const entry of entries) {
                if (entry.isFile && (entry.name.endsWith('.ttf') || entry.name.endsWith('.otf'))) {
                    const filePath = await join(fontsFolder, entry.name);
                    const assetUrl = convertFileSrc(filePath);
                    const fontFamilyName = entry.name.replace(/\.[^/.]+$/, "");

                    const fontFace = new FontFace(fontFamilyName, `url(${assetUrl})`);
                    const loadedFont = await fontFace.load();
                    (document.fonts as any).add(loadedFont);

                    customFonts.value.push({
                        title: fontFamilyName,
                        value: fontFamilyName,
                        cssValue: `"${fontFamilyName}", sans-serif`,
                        isCustom: true,
                        filePath,   // caminho absoluto para o servidor de fontes
                    });
                }
            }
        } catch (error) {
            console.error("Erro ao carregar fontes customizadas:", error);
        } finally {
            isLoading.value = false;
        }
    };

    const addNewFont = async () => {
        try {
            // Abre o selecionador de arquivos nativo do Windows/Mac
            const selectedPath = await open({
                multiple: false,
                filters: [{ name: 'Fonts', extensions: ['ttf', 'otf'] }]
            });

            if (!selectedPath || Array.isArray(selectedPath)) return; // Cancelou ou selecionou vários

            const appData = await appLocalDataDir();
            const fontsFolder = await join(appData, 'cache', 'fonts');
            const fileName = await basename(selectedPath);
            const destinationPath = await join(fontsFolder, fileName);

            // Copia o arquivo original para a pasta interna do app
            await copyFile(selectedPath, destinationPath);

            // Recarrega a lista para a nova fonte aparecer imediatamente
            await loadCustomFonts();

        } catch (error) {
            console.error("Erro ao importar fonte:", error);
            alert("Erro ao importar a fonte. Tente novamente.");
        }
    };

    return { allFonts, customFonts, isLoading, addNewFont, loadDefaultFonts, loadCustomFonts }; // Não esqueça de exportar a loadDefaultFonts
});