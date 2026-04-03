import pptxgen from "pptxgenjs";
import { usePresentationStore } from '../stores/usePresentationStore';
import { writeFile } from '@tauri-apps/plugin-fs'; 
import { save } from '@tauri-apps/plugin-dialog';

export interface Slide {
    text: string;
    type: 'titulo' | 'verso' | 'refrao' | 'geral';
}

export const exportToPPTX = async (songSlides: Slide[], songName: string) => {
    const store = usePresentationStore();
    const design = store.design;
    
    // 1. Inicializa a apresentação em 16:9
    let pptx = new pptxgen();
    pptx.layout = 'LAYOUT_16x9'; // 10 x 5.625 inches

    console.log(songSlides)

    // 2. Itera sobre os slides da sua música
    songSlides.forEach(slide => {
        let pptSlide = pptx.addSlide();

        // --- APLICAR FUNDO ---
        if (design.bgType === 'color') {
            pptSlide.background = { color: design.bgColor.replace('#', '') };
        } else if (design.bgMedia) {
            // Nota: Para ficheiros locais Tauri, talvez precise converter o path para Base64 antes.
            pptSlide.background = { path: design.bgMedia }; 
        }

        // --- MATEMÁTICA DAS POSIÇÕES ---
        // Converte as suas percentagens para polegadas
        const xPos = (design.posX / 100) * 10;
        const yPos = (design.posY / 100) * 5.625;
        const wSize = (design.width / 100) * 10;
        const hSize = (design.height / 100) * 5.625;

        // --- ESTILO DINÂMICO ---
        // Usa o tipo do slide atual para buscar as configurações no Store.
        // O fallback || 'geral' garante que não quebra se o tipo vier vazio.
        const currentStyle = store.textStyles[slide.type || 'geral']; 

        // --- APLICAR TEXTO ---
        pptSlide.addText(slide.text, {
            x: xPos,
            y: yPos,
            w: wSize,
            h: hSize,
            color: currentStyle.color.replace('#', ''),
            fontFace: currentStyle.fontFamily,
            fontSize: currentStyle.fontSize * 8, // Multiplicador fictício para converter CQI em PT
            align: currentStyle.align,
            bold: currentStyle.bold,
            italic: currentStyle.italic,
            valign: 'middle'
        });
    });

    // 3. Gerar o ficheiro como Uint8Array
    const buffer = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;

    // 4. Salvar usando as APIs seguras do Tauri
    const savePath = await save({
        filters: [{ name: 'Apresentação PowerPoint', extensions: ['pptx'] }],
        defaultPath: `${songName}.pptx`
    });

    if (savePath) {
        await writeFile(savePath, buffer);
        console.log("PPTX Exportado com sucesso!");
    }
};