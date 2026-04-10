import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { readDir, mkdir, copyFile, exists } from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join, basename } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export interface FontOption {
    title: string;
    value: string;
    isCustom: boolean; // Para sabermos se foi o usuário que adicionou
}

export const useFontStore = defineStore('fonts', () => {
    // Fontes nativas do sistema (Padrão)
    const systemFonts = ref<FontOption[]>([
        { title: 'Arial', value: 'Arial, sans-serif', isCustom: false },
        { title: 'Verdana', value: 'Verdana, sans-serif', isCustom: false },
        { title: 'Tahoma', value: 'Tahoma, sans-serif', isCustom: false },
        { title: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif', isCustom: false },
        { title: 'Times New Roman', value: '"Times New Roman", serif', isCustom: false },
        { title: 'Georgia', value: 'Georgia, serif', isCustom: false },
        { title: 'Courier New', value: '"Courier New", monospace', isCustom: false },
        { title: 'Roboto', value: 'Roboto' , isCustom: false },
        { title: 'Inter', value: 'Inter', isCustom: false  }
    ]);

    const customFonts = ref<FontOption[]>([]);
    const isLoading = ref(false);

    // Junta as duas listas, ordenando as customizadas primeiro
    const allFonts = computed(() => [...customFonts.value, ...systemFonts.value]);

    // LÊ A PASTA E INJETA AS FONTES NO CSS
    const loadCustomFonts = async () => {
        try {
            isLoading.value = true;
            const appData = await appLocalDataDir();
            // Criando o caminho cache/fontes
            const fontsFolder = await join(appData, 'cache', 'fonts');

            // Garante que a pasta existe
            const folderExists = await exists(fontsFolder);
            if (!folderExists) {
                await mkdir(fontsFolder, { recursive: true });
                return;
            }

            const entries = await readDir(fontsFolder);
            customFonts.value = [];

            for (const entry of entries) {
                if (entry.isFile && (entry.name.endsWith('.ttf') || entry.name.endsWith('.otf'))) {
                    const filePath = await join(fontsFolder, entry.name);
                    const assetUrl = convertFileSrc(filePath);
                    
                    // O nome da família será o nome do arquivo sem extensão
                    const fontFamilyName = entry.name.replace(/\.[^/.]+$/, "");

                    // MÁGICA: Injeta a fonte física no DOM do navegador
                    const fontFace = new FontFace(fontFamilyName, `url(${assetUrl})`);
                    const loadedFont = await fontFace.load();
                    (document.fonts as any).add(loadedFont);

                    customFonts.value.push({
                        title: fontFamilyName,
                        value: `"${fontFamilyName}", sans-serif`,
                        isCustom: true
                    });
                }
            }
        } catch (error) {
            console.error("Erro ao carregar fontes customizadas:", error);
        } finally {
            isLoading.value = false;
        }
    };

    // ABRE JANELA DO SISTEMA PARA ADICIONAR NOVA FONTE
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

    return { allFonts, customFonts, isLoading, loadCustomFonts, addNewFont };
});