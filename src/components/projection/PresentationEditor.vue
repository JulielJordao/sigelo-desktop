<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core'; 
import { useConfigStore } from '../../stores/useConfigStore';
import { usePresentationStore } from '../../stores/usePresentationStore'; // NOVO STORE
import { getMaxLinesFromSlides, calculateMaxFontSize } from '../../utils/projection';
import { exportToPPTX } from '../../utils/pptxGen';
import { Slide } from '../../utils/pptxGen'; // Importando a interface Slide para tipagem

// Importação das Abas Separadas
import TabSlides from '../tabs/TabSlides.vue';
import TabBackground from '../tabs/TabBackground.vue';
import TabText from '../tabs/TabText.vue';
import TabPosition from '../tabs/TabPosition.vue';

const configStore = useConfigStore();
const presentationStore = usePresentationStore(); // INSTANCIANDO O STORE

const props = defineProps<{
    activeSong: { _id: string, fullName: string} | null;
    showSidebar: boolean;
}>();

const emit = defineEmits<{ (e: 'toggle-sidebar'): void }>();

const lyric = ref("");
const currentTab = ref('slides');
const isProjecting = ref(false);
const currentSlideIndex = ref<number>(0);
const previewContainer = ref<HTMLElement | null>(null);

const screenResolution = ref({ width: 1920, height: 1080 });
const screenRatio = computed(() => screenResolution.value.width / screenResolution.value.height);

// Drag & Drop (Mantido aqui pois interage diretamente com o DOM do Preview)
const interactionType = ref<string | null>(null);
const startMouse = { x: 0, y: 0 };
const startBox = { x: 0, y: 0, w: 0, h: 0 };
let startFontSize = 0; 

// AQUI ESTÁ O SEGREDO: Atalhos para os valores do Store para facilitar a leitura no componente principal
const design = computed(() => presentationStore.design);
const textStyles = computed(() => presentationStore.textStyles);

// --- PROCESSAMENTO DOS SLIDES (MANTIDO) ---
watch(() => props.activeSong, () => { currentSlideIndex.value = 0; });

const parseSlides = function(rawText: string) {
  const lines = rawText.split('\n')
  const estrofes = []
  let chorusLines = []
  let chorus = []
  let buffer = []
  const typeText = []
  const typeSlides = []

  // Pré-define o que é refrão e o que é estrofe
  for (let line of lines) {
    // Quebra de linha
    if (!line.trim()) {
      if (buffer.length > 0) {
        estrofes.push(buffer.join('\n'))
        buffer = []
        typeText.push(0) // Estrofe
      }

      if (chorusLines.length > 0) {
        if (chorus.length < 1) {
          typeText.push(1)
        } else {
          typeText.push(chorus.length + 1)
        }
        chorus.push(chorusLines.join('\n'))
        chorusLines = []
      }
      // Refrão (linha com 5 espaços)
    } else if (/^\s{5}/.test(line)) {
      chorusLines.push(line.trim())
    } else {
      buffer.push(line.trim())
    }
  }

  if (buffer.length > 0) {
    estrofes.push(buffer.join('\n'))
    typeText.push(0)
  }

  if (chorusLines.length > 0) {
    typeText.push(chorus.length + 1)
    chorus.push(chorusLines.join('\n'))
  }

  const slides = []
  let countChorus = 0
  let countVerse = 0
  let afterChorus = false
  let onVerse = false
  let sType = 0

  // Constroí os slides e adiciona o refrão onde é necessário
  for (let i = 0; i < typeText.length; i++) {
    sType = typeText[i]
    if (sType == 0) {
      slides.push(estrofes[countVerse])
      countVerse++
      typeSlides.push(0)
      onVerse = true
    } else if (sType == 1) {
      slides.push(chorus[0])
      onVerse = false
      typeSlides.push(1)
      afterChorus = true
    } else {
      countChorus++
      slides.push(chorus[countChorus])
      typeSlides.push(1)
      onVerse = false
    }

    if ((i + 1) < typeText.length) {
      if (afterChorus && onVerse && typeText[i + 1] < 1) {
        slides.push(chorus[countChorus])
        typeSlides.push(1)
      }
    } else {
      if (afterChorus && onVerse) {
        slides.push(chorus[countChorus])
        typeSlides.push(1)
      }
    }
  }
  return { slides, typeSlides }
}

const infoSlides = ref(parseSlides("")); // (Sua função parseSlides permanece inalterada)

const songSlides = computed(() => {
    if (!props.activeSong) return [];
    return infoSlides.value.slides.map((block, index) => {
        let label = infoSlides.value.typeSlides[index] == 0 ? `Slide ${index + 1} - verso` : `Slide ${index + 1} - refrão`
        return { label, text: block };
    });
});

const currentSlideText = computed(() => songSlides.value[currentSlideIndex.value]?.text || 'Selecione uma música');

const currentSlideType = computed(() => {
    if (!songSlides.value[currentSlideIndex.value]) return 'geral';
    const label = songSlides.value[currentSlideIndex.value].label.toLowerCase();
    if (label.includes('título') || label.includes('titulo')) return 'titulo';
    if (label.includes('refrão') || label.includes('refrao') || label.includes('coro')) return 'refrao';
    if (label.includes('verso') || label.includes('estrofe')) return 'verso';
    return 'geral';
});

const currentActiveStyle = computed(() => textStyles.value[currentSlideType.value]);

// Lógica de Drag & Drop (Atualizada para usar o store)
const startAction = (e: MouseEvent, type: string) => {
    e.preventDefault();
    if (currentTab.value !== 'posicao') return;

    interactionType.value = type;
    startMouse.x = e.clientX;
    startMouse.y = e.clientY;

    // Lendo do Store diretamente
    startBox.x = presentationStore.design.posX;
    startBox.y = presentationStore.design.posY;
    startBox.w = presentationStore.design.width;
    startBox.h = presentationStore.design.height;

    startFontSize = currentActiveStyle.value.fontSize;

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stopAction);
};

const onMove = (e: MouseEvent) => {
    if (!interactionType.value || !previewContainer.value) return;

    const rect = previewContainer.value.getBoundingClientRect();
    const deltaX = ((e.clientX - startMouse.x) / rect.width) * 100;
    const deltaY = ((e.clientY - startMouse.y) / rect.height) * 100;

    let newX = startBox.x, newY = startBox.y, newW = startBox.w, newH = startBox.h;

    switch (interactionType.value) {
        case 'move': newX = startBox.x + deltaX; newY = startBox.y + deltaY; break;
        case 'br': newW = startBox.w + deltaX; newH = startBox.h + deltaY; break;
        case 'bl': newW = startBox.w - deltaX; newX = startBox.x + deltaX; newH = startBox.h + deltaY; break;
        case 'tr': newW = startBox.w + deltaX; newH = startBox.h - deltaY; newY = startBox.y + deltaY; break;
        case 'tl': newW = startBox.w - deltaX; newX = startBox.x + deltaX; newH = startBox.h - deltaY; newY = startBox.y + deltaY; break;
        case 'r': newW = startBox.w + deltaX; break;
        case 'l': newW = startBox.w - deltaX; newX = startBox.x + deltaX; break;
        case 'b': newH = startBox.h + deltaY; break;
        case 't': newH = startBox.h - deltaY; newY = startBox.y + deltaY; break;
    }

    const minSize = 5;
    if (newW < minSize) { if (['l', 'tl', 'bl'].includes(interactionType.value)) newX += newW - minSize; newW = minSize; }
    if (newH < minSize) { if (['t', 'tl', 'tr'].includes(interactionType.value)) newY += newH - minSize; newH = minSize; }

    newX = Math.max(0, Math.min(100 - newW, newX));
    newY = Math.max(0, Math.min(100 - newH, newY));

    if (presentationStore.autoFontSize && interactionType.value !== 'move') {
        const scaleRatio = newH / startBox.h;
        presentationStore.textStyles[currentSlideType.value].fontSize = Math.max(2, Math.min(30, startFontSize * scaleRatio));
    }

    // Salvando no Store DIRETAMENTE
    presentationStore.design.posX = Math.round(newX);
    presentationStore.design.posY = Math.round(newY);
    presentationStore.design.width = Math.round(newW);
    presentationStore.design.height = Math.round(newH);
};

const stopAction = () => {
    interactionType.value = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', stopAction);
};

// 1. Descobre o número máximo de linhas na música atual
const maxLinesInSong = computed(() => {
    return getMaxLinesFromSlides(songSlides.value);
});

const maxAllowedFontSize = computed(() => {
    return calculateMaxFontSize({
        maxLines: maxLinesInSong.value,
        aspectRatio: configStore.settings.aspectRatio,
        customWidth: screenResolution.value.width,
        customHeight: screenResolution.value.height
    });
});

// 3. Monitora mudanças e "esmaga" a fonte se ela estourar o limite
watch(maxAllowedFontSize, (newMax) => {
    const styles = ['geral', 'titulo', 'verso', 'refrao'] as const;
    
    styles.forEach(style => {
        if (textStyles.value[style].fontSize > newMax) {
            textStyles.value[style].fontSize = newMax;
        }
    });
    
    if (isProjecting.value) projectCurrentSlide();
});

interface SlideProj {
    label: string;
    text: string;
}

function convertToSlideFmt(label: SlideProj[]): Slide[] {
    const props = ['título', 'verso', 'refrão', 'geral'];
    return label.map(slide => ({ text: slide.text, type: (removeAccents(props.find(p => slide.label.toLowerCase().includes(p))) || 'geral') as Slide['type'] }));
}

function removeAccents(str: string | undefined) : string | null{
    if (!str) return null;

    return str
        .toLowerCase()
        .normalize('NFD') // Decompõe os acentos
        .replace(/[\u0300-\u036f]/g, "");
}

const projectCurrentSlide = async () => {
    if (!props.activeSong) return;

    const style = currentActiveStyle.value;
    const conf = configStore.settings;
    const text = currentSlideText.value;
    const currentDesign = design.value;

    // Resolve o tipo de fundo de forma limpa
    let resolvedBgType = 'color';
    if (currentDesign.bgType !== 'color' && currentDesign.bgMedia) {
        resolvedBgType = currentDesign.bgIsVideo ? 'video' : 'image';
    }

    // Cria um objeto estruturado de dados (JSON) em vez de uma string HTML
    const slidePayload = {
        type: 'slide', // Identificador para o telão saber que não é um PDF
        background: {
            type: resolvedBgType,
            color: currentDesign.bgColor,
            media: currentDesign.bgMedia,
            fit: currentDesign.bgFit
        },
        layout: {
            theme: conf.activeTheme.toLowerCase(),
            chromaKey: conf.chromaKey !== 'none' ? conf.chromaKey : 'transparent',
            opacity: conf.bgOpacity / 100,
            transition: conf.transitionType === 'fade' ? 'ease-in-out' : 'none',
            padding: `${conf.marginTop}px ${conf.marginRight}px ${conf.marginBottom}px ${conf.marginLeft}px`
        },
        text: {
            content: text, // O texto muda aqui!
            posX: currentDesign.posX,
            posY: currentDesign.posY,
            width: currentDesign.width,
            height: currentDesign.height,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            color: style.color,
            align: style.align,
            bold: style.bold,
            italic: style.italic
        }
    };

    try {
        // Converte o objeto para string e envia no campo 'html' (o Rust não liga para o conteúdo)
        await invoke('update_projection', { 
            html: JSON.stringify(slidePayload), 
            targetMonitor: conf.selectedMonitor || null
        });
        isProjecting.value = true;
    } catch (error) { 
        console.error("Erro ao projetar o slide:", error);
    }
};

const stopProjection = async () => {
    isProjecting.value = false;
    try {
        await invoke('stop_projection');
    } catch (error) {
        console.error("Erro ao parar a projeção:", error);
    }
};

const handleKeydown = (e: KeyboardEvent) => {
    if (!isProjecting.value) return; // Só funciona se a projeção estiver rodando

    switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
            // Avança slide
            if (currentSlideIndex.value < songSlides.value.length - 1) {
                currentSlideIndex.value++;
            }
            break;
        case 'ArrowLeft':
        case 'ArrowUp':
            // Volta slide
            if (currentSlideIndex.value > 0) {
                currentSlideIndex.value--;
            }
            break;
        case 'Escape':
            // Pergunta se quer encerrar ao apertar ESC
            if (confirm("Deseja encerrar a apresentação?")) {
                stopProjection();
            }
            break;
    }
};

onMounted(() => {
    window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => { 
    stopAction(); 
    window.removeEventListener('keydown', handleKeydown);
});

watch(currentSlideIndex, () => {
    if (isProjecting.value) { // Só envia se estiver no modo apresentação
        projectCurrentSlide();
    }
});

defineExpose({
    updateLyric: (newLyric: string) => {
        lyric.value = newLyric
        infoSlides.value = parseSlides(newLyric)
    }
})


</script>

<template>
    <div class="d-flex flex-column fill-height bg-background">
        <v-toolbar density="compact" color="surface" elevation="0" class="border-b px-2 flex-shrink-0">
            <v-btn icon variant="text" size="small" class="mr-2" @click="emit('toggle-sidebar')">
                <v-icon>{{ showSidebar ? 'mdi-arrow-collapse-left' : 'mdi-arrow-expand-right' }}</v-icon>
            </v-btn>
            <v-toolbar-title class="text-subtitle-1 font-weight-bold">
                {{ activeSong ? activeSong.fullName : 'Modo de Apresentação' }}
            </v-toolbar-title>
            
            <v-spacer></v-spacer>

            <span v-if="isProjecting" class="text-caption text-medium-emphasis mr-4">
                (Use ← → para navegar, Esc para sair)
            </span>

            <v-btn v-if="activeSong && !isProjecting" color="primary" variant="flat" size="small"
                prepend-icon="mdi-play"
                @click="projectCurrentSlide">Projetar</v-btn>
                
            <v-btn v-if="activeSong && isProjecting" color="error" variant="flat" size="small"
                prepend-icon="mdi-stop"
                @click="stopProjection">Parar Apresentação</v-btn>
        </v-toolbar>

        <div v-if="activeSong" class="d-flex flex-column flex-grow-1 overflow-hidden">

            <div class="bg-black d-flex align-center justify-center relative flex-shrink-0 preview-wrapper">
                <div ref="previewContainer" class="preview-screen"
                    :style="{ aspectRatio: screenRatio, backgroundColor: design.bgType === 'color' ? design.bgColor : '#000' }">

                    <img v-if="design.bgType !== 'color' && !design.bgIsVideo && design.bgMedia" :src="design.bgMedia"
                        class="video-bg" :style="{ objectFit: design.bgFit }" />

                    <video v-if="design.bgType !== 'color' && design.bgIsVideo && design.bgMedia" :src="design.bgMedia"
                        autoplay loop muted class="video-bg" :style="{ objectFit: design.bgFit }"></video>

                    <div class="slide-text-box" :class="{
                        'is-positioning': currentTab === 'posicao',
                        'is-active': interactionType !== null
                    }" :style="{
                        left: `${design.posX}%`,
                        top: `${design.posY}%`,
                        width: `${design.width}%`,
                        height: `${design.height}%`,
                        fontFamily: currentActiveStyle.fontFamily
                    }" @mousedown="startAction($event, 'move')">

                        <div class="text-inner-content" :style="{
                            fontSize: `${currentActiveStyle.fontSize}cqi`,
                            textAlign: currentActiveStyle.align,
                            fontWeight: currentActiveStyle.bold ? 'bold' : 'normal',
                            fontStyle: currentActiveStyle.italic ? 'italic' : 'normal',
                            color: currentActiveStyle.color,
                            width: '100%',
                            maxHeight: '100%',
                            overflow: 'hidden'
                        }">
                            {{ currentSlideText }}
                        </div>

                        <template v-if="currentTab === 'posicao'">
                            <div class="handle tl" @mousedown.stop="startAction($event, 'tl')" />
                            <div class="handle tr" @mousedown.stop="startAction($event, 'tr')" />
                            <div class="handle bl" @mousedown.stop="startAction($event, 'bl')" />
                            <div class="handle br" @mousedown.stop="startAction($event, 'br')" />
                            <div class="handle t" @mousedown.stop="startAction($event, 't')" />
                            <div class="handle b" @mousedown.stop="startAction($event, 'b')" />
                            <div class="handle l" @mousedown.stop="startAction($event, 'l')" />
                            <div class="handle r" @mousedown.stop="startAction($event, 'r')" />
                        </template>
                    </div>
                </div>
            </div>

            <v-card class="flex-grow-1 rounded-0 elevation-0 d-flex flex-column border-t bg-background">
                <v-tabs v-model="currentTab" bg-color="surface" density="compact" class="border-b" color="primary">
                    <v-tab value="slides"><v-icon start>mdi-presentation-play</v-icon>Slides</v-tab>
                    <v-tab value="fundo"><v-icon start>mdi-image-outline</v-icon>Fundo</v-tab>
                    <v-tab value="texto"><v-icon start>mdi-format-text</v-icon>Texto</v-tab>
                    <v-tab value="posicao"><v-icon start>mdi-crosshairs-gps</v-icon>Posição</v-tab>
                </v-tabs>

                <v-card-text class="flex-grow-1 overflow-y-auto pa-0">
                    <v-window v-model="currentTab" class="fill-height">
                        
                        <v-window-item value="slides" class="pa-4 fill-height overflow-y-auto">
                            <TabSlides :slides="songSlides" v-model:currentSlideIndex="currentSlideIndex" />
                        </v-window-item>
                        
                        <v-window-item value="fundo" class="pa-6 fill-height">
                            <TabBackground />
                        </v-window-item>

                        <v-window-item value="texto" class="fill-height overflow-y-auto pa-2 pa-sm-4">
                            <TabText :maxAllowedFontSize="maxAllowedFontSize" />
                        </v-window-item>
                        
                        <v-window-item value="posicao" class="pa-6 fill-height d-flex flex-column align-center justify-center">
                            <TabPosition />
                        </v-window-item>

                    </v-window>
                </v-card-text>
            </v-card>
        </div>

        <div v-else class="flex-grow-1 d-flex flex-column align-center justify-center text-medium-emphasis">
            <v-icon icon="mdi-projector-screen-outline" size="64" class="mb-4 text-disabled"></v-icon>
            <h3 class="font-weight-medium">Selecione uma música no repertório</h3>
        </div>
    </div>
</template>

<style scoped>
/* O seu bloco <style> não precisou de alteração, mantém as configurações de exibição */
.preview-wrapper {
    height: 45vh;
    padding: 24px;
}

.preview-screen {
    width: 100%;
    max-width: 900px;
    max-height: 100%;
    border-radius: 4px;
    overflow: hidden;
    position: relative;
    transition: aspect-ratio 0.3s ease;
}

.video-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
}

.slide-text-box {
    position: absolute;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: white;
    /* Cor da fonte em branco na projeção */
    text-align: center;
    white-space: pre-wrap;
    user-select: none;
    border: 2px dashed rgba(255, 255, 255, 0.6);
    background-color: rgba(33, 150, 243, 0.1);
    cursor: move;

    container-type: inline-size;
}

.text-inner-content {
    pointer-events: none;
}

.slide-text-box.is-positioning {
    border: 2px dashed rgba(255, 255, 255, 0.8);
    background-color: rgba(0, 0, 0, 0.2);
    cursor: grab;
}

.slide-text-box.is-dragging {
    cursor: grabbing;
    border-color: #2196F3;
    background-color: rgba(33, 150, 243, 0.2);
    transition: none;
}

.border-primary {
    border-color: rgb(var(--v-theme-primary)) !important;
    border-width: 2px !important;
}

.text-truncate-multiline {
  display: -webkit-box;
  -webkit-line-clamp: 4; 
  line-clamp: 4;/* Limita a 4 linhas no preview */
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gap-2 {
    gap: 8px;
}

.is-active {
    border-color: #2196F3;
    background-color: rgba(33, 150, 243, 0.2);
}

.handle {
    position: absolute;
    width: 12px;
    height: 12px;
    background: white;
    border: 2px solid #1976d2;
    border-radius: 50%;
}

.tl {
    top: -6px;
    left: -6px;
    cursor: nwse-resize;
}

.tr {
    top: -6px;
    right: -6px;
    cursor: nesw-resize;
}

.bl {
    bottom: -6px;
    left: -6px;
    cursor: nesw-resize;
}

.br {
    bottom: -6px;
    right: -6px;
    cursor: nwse-resize;
}

.t {
    top: -6px;
    left: 50%;
    transform: translateX(-50%);
    cursor: ns-resize;
}

.b {
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    cursor: ns-resize;
}

.l {
    left: -6px;
    top: 50%;
    transform: translateY(-50%);
    cursor: ew-resize;
}

.r {
    right: -6px;
    top: 50%;
    transform: translateY(-50%);
    cursor: ew-resize;
}

.color-btn {
    transition: all 0.2s ease;
}

.color-btn.selected-color {
    outline: 2px solid rgb(var(--v-theme-primary));
    outline-offset: 3px;
    transform: scale(1.1); /* Dá um leve zoom no botão selecionado */
}
</style>