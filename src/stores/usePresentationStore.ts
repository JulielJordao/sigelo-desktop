import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

// ==========================================
// 1. TIPAGENS REUTILIZÁVEIS E ESTRITAS
// ==========================================
export type ObjectFit = 'cover' | 'fill' | 'contain';
export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type BgType = 'color' | 'saved' | 'upload';

export interface TextStyle {
    fontFamily: string;
    fontSize: number;
    align: TextAlign;
    bold: boolean;
    italic: boolean;
    color: string;
}

export interface DesignState {
    bgType: BgType;
    bgColor: string;
    bgMedia: string;
    bgIsVideo: boolean;
    bgFit: ObjectFit;
    posX: number;
    posY: number;
    width: number;
    height: number;
    coverSlide: boolean;
    authorCredits: boolean;
    targetLines?: number;
    maxLines?: number;
}

export interface TextStylesState {
    geral: TextStyle;
    titulo: TextStyle;
    verso: TextStyle;
    refrao: TextStyle;
}

export interface Preset {
    id: string; // Sempre bom ter um ID para facilitar no v-for e buscas
    name: string;
    design: DesignState;
    textStyles: TextStylesState;
}

// ==========================================
// 2. O STORE
// ==========================================
export const usePresentationStore = defineStore('presentation', () => {

    // --- ESTADO (STATE) ---
    const presets = ref<Preset[]>([]);
    const currentPresetId = ref<string | null>(null);

    const currentPreset = computed(() => presets.value.find(it => it.id === currentPresetId.value))

    const design = ref<DesignState>({
        bgType: 'color',
        bgColor: '#000000',
        bgMedia: '',
        bgIsVideo: false,
        bgFit: 'cover',
        maxLines: undefined,
        coverSlide: false,
        authorCredits: false,
        posX: 5,
        posY: 5,
        width: 90,
        height: 90
    });

    const textStyles = ref<TextStylesState>({
        geral: { fontFamily: 'Inter', fontSize: 5, align: 'center', bold: false, italic: false, color: '#FFFFFF' },
        titulo: { fontFamily: 'Inter', fontSize: 8, align: 'center', bold: true, italic: false, color: '#FFFFFF' },
        verso: { fontFamily: 'Inter', fontSize: 4.5, align: 'left', bold: false, italic: false, color: '#FFFFFF' },
        refrao: { fontFamily: 'Inter', fontSize: 6, align: 'center', bold: true, italic: true, color: '#FFFFFF' }
    });

    const autoFontSize = ref(false);


    // --- AÇÕES (ACTIONS) ---

    // 1. Aplica o estilo "geral" para todos os outros
    const applyGeralToAll = () => {
        // Usa o spread operator para copiar os valores e não a referência
        const base = { ...textStyles.value.geral };
        textStyles.value.titulo = { ...base, fontSize: base.fontSize * 1.5, bold: true }; // Exemplo: Título um pouco maior por padrão
        textStyles.value.verso = { ...base };
        textStyles.value.refrao = { ...base, italic: true };
    };

    // 2. Salva a configuração atual como um novo Preset
    const saveCurrentAsPreset = (presetName: string) => {
        const newPreset: Preset = {
            id: crypto.randomUUID(), // Gera um ID único nativo do navegador
            name: presetName,
            // JSON parse/stringify garante um clone profundo (deep copy) desconectado da reatividade atual
            design: JSON.parse(JSON.stringify(design.value)),
            textStyles: JSON.parse(JSON.stringify(textStyles.value))
        };

        presets.value.push(newPreset);
        currentPresetId.value = newPreset.id;
    };

    // 3. Aplica um preset selecionado ao design "ao vivo"
    const applyPreset = (presetId: string) => {
        const presetToApply = presets.value.find(p => p.id === presetId);

        if (presetToApply) {
            // Novamente, usa clone profundo para que alterar o design ao vivo não altere o preset salvo
            design.value = JSON.parse(JSON.stringify(presetToApply.design));
            textStyles.value = JSON.parse(JSON.stringify(presetToApply.textStyles));
            currentPresetId.value = presetToApply.id;
        }
    };

    const renamePreset = (id: string, newName: string) => {
        const preset = presets.value.find(p => p.id === id);
        if (preset) {
            preset.name = newName;
        }
    };

    const updateActivePreset = () => {
        if (!currentPresetId.value) return;

        // Encontra o índice do preset atual na lista
        const index = presets.value.findIndex(p => p.id === currentPresetId.value);
        console.log(index)
        if (index !== -1) {
            // Usa o clone profundo para atualizar os dados desconectando da reatividade
            presets.value[index].design = JSON.parse(JSON.stringify(design.value));
            presets.value[index].textStyles = JSON.parse(JSON.stringify(textStyles.value));
        }
    };

    return {
        // Variáveis
        presets,
        currentPresetId,
        design,
        textStyles,
        autoFontSize,
        currentPreset,

        // Funções
        applyGeralToAll,
        updateActivePreset,
        saveCurrentAsPreset,
        applyPreset,
        renamePreset
    };
});