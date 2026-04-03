import { defineStore } from 'pinia';
import { ref } from 'vue';

export const usePresentationStore = defineStore('presentation', () => {
    // 1. Posição e Fundo
    const design = ref({
        bgType: 'color', // 'color', 'saved', 'upload'
        bgColor: '#000000',
        bgMedia: '',
        bgIsVideo: false,
        bgFit: 'cover' as 'cover' | 'fill' | 'contain',

        posX: 5,
        posY: 5,
        width: 90,
        height: 90
    });

    // 2. Estilos de Texto
    const textStyles = ref({
        geral: { fontFamily: 'Inter', fontSize: 5, align: 'center' as 'left' | 'center' | 'right' | 'justify', bold: false, italic: false, color: '#FFFFFF' },
        titulo: { fontFamily: 'Inter', fontSize: 8, align: 'center' as 'left' | 'center' | 'right' | 'justify', bold: true, italic: false, color: '#FFFFFF' },
        verso: { fontFamily: 'Inter', fontSize: 4.5, align: 'left' as 'left' | 'center' | 'right' | 'justify', bold: false, italic: false, color: '#FFFFFF' },
        refrao: { fontFamily: 'Inter', fontSize: 6, align: 'center' as 'left' | 'center' | 'right' | 'justify', bold: true, italic: true, color: '#FFFFFF' }
    });

    const autoFontSize = ref(false);

    // Função auxiliar para aplicar estilo geral a todos
    const applyGeralToAll = () => {
        const base = textStyles.value.geral;
        textStyles.value.titulo = { ...base };
        textStyles.value.verso = { ...base };
        textStyles.value.refrao = { ...base };
    };

    return { 
        design, 
        textStyles, 
        autoFontSize,
        applyGeralToAll
    };
});