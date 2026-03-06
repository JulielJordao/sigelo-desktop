<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';

const props = defineProps<{
    activeSong: { _id: string, fullName: string, lyrics: string } | null;
    showSidebar: boolean;
}>();

const emit = defineEmits<{
    (e: 'toggle-sidebar'): void
}>();

// --- ESTADOS GERAIS E TELA ---
const currentTab = ref('slides');
const currentSlideIndex = ref<number>(0);
const previewContainer = ref<HTMLElement | null>(null);

// Simulação de detecção da resolução
const screenResolution = ref({ width: 1920, height: 1080 });
const screenRatio = computed(() => screenResolution.value.width / screenResolution.value.height);

// Controles de interação (Drag & Drop)
const interactionType = ref<string | null>(null);
const startMouse = { x: 0, y: 0 };
const startBox = { x: 0, y: 0, w: 0, h: 0 };
let startFontSize = 0; // Guardará a fonte inicial no momento do clique

// --- ESTADOS DO DESIGN ---

// 1. Posição e Fundo (Geral para todos os slides)
const design = ref({
    bgType: 'color', // 'color', 'saved', 'upload'
    bgColor: '#000000',
    bgMedia: '',
    bgIsVideo: false,
    bgFit: 'cover', // 'cover' (Cortar) ou 'fill' (Estender)

    // Posição da caixa
    posX: 10,
    posY: 35,
    width: 80,
    height: 30
});

// 2. Estilos de Texto Separados por Tipo de Slide
const textStyles = ref({
    geral: { fontFamily: 'Inter', fontSize: 6, align: 'center', bold: false, italic: false, color: '#FFFFFF' },
    titulo: { fontFamily: 'Inter', fontSize: 8, align: 'center', bold: true, italic: false, color: '#FFFFFF' },
    verso: { fontFamily: 'Inter', fontSize: 6, align: 'left', bold: false, italic: false, color: '#FFFFFF' },
    refrao: { fontFamily: 'Inter', fontSize: 6.5, align: 'center', bold: true, italic: true, color: '#FFFFFF' }
});
const activeTextSetting = ref('geral'); // Controla qual tipo estamos editando na Aba Texto
const autoFontSize = ref(false);
const fontOptions = ['Inter', 'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Montserrat'];

// --- PROCESSAMENTO DOS SLIDES ---
watch(() => props.activeSong, () => { currentSlideIndex.value = 0; });

const songSlides = computed(() => {
    if (!props.activeSong) return [];
    return props.activeSong.lyrics.split('\n\n').map(block => {
        const lines = block.split('\n');
        return {
            label: lines[0].startsWith('[') ? lines[0] : '',
            text: lines[0].startsWith('[') ? lines.slice(1).join('\n') : block
        };
    });
});

const currentSlideText = computed(() => songSlides.value[currentSlideIndex.value]?.text || 'Selecione uma música');

// Descobre o TIPO de slide atual para aplicar a fonte certa no telão
const currentSlideType = computed(() => {
    if (!songSlides.value[currentSlideIndex.value]) return 'geral';
    const label = songSlides.value[currentSlideIndex.value].label.toLowerCase();

    if (label.includes('título') || label.includes('titulo')) return 'titulo';
    if (label.includes('refrão') || label.includes('refrao') || label.includes('coro')) return 'refrao';
    if (label.includes('verso') || label.includes('estrofe')) return 'verso';

    return 'geral';
});

// Retorna os estilos da fonte aplicável para o slide atual
const currentActiveStyle = computed(() => textStyles.value[currentSlideType.value]);

const applyToAll = () => {
    const base = textStyles.value.geral;
    textStyles.value.titulo = { ...base };
    textStyles.value.verso = { ...base };
    textStyles.value.refrao = { ...base };
};

// --- MOCK DE FUNDOS SALVOS ---
const savedBackgrounds = [
    { id: 1, type: 'image', url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba', name: 'Montanhas' },
    { id: 2, type: 'image', url: 'https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0', name: 'Escuro/Abstrato' },
    { id: 3, type: 'video', url: 'https://www.w3schools.com/html/mov_bbb.mp4', name: 'Fundo Animado' }
];

const selectSavedBackground = (bg: any) => {
    design.value.bgType = 'saved';
    design.value.bgMedia = bg.url;
    design.value.bgIsVideo = bg.type === 'video';
};

const handleFileUpload = (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
        design.value.bgType = 'upload';
        design.value.bgMedia = URL.createObjectURL(file);
        design.value.bgIsVideo = file.type.startsWith('video/');
    }
};

// --- LÓGICA DE ARRASTAR E SOLTAR (DRAG & DROP) ---
const startAction = (e: MouseEvent, type: string) => {
    e.preventDefault();
    if (currentTab.value !== 'posicao') return;

    interactionType.value = type;
    startMouse.x = e.clientX;
    startMouse.y = e.clientY;

    startBox.x = design.value.posX;
    startBox.y = design.value.posY;
    startBox.w = design.value.width;
    startBox.h = design.value.height;

    // Captura o tamanho da fonte do slide atual
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
    if (newW < minSize) { if (['l', 'tl', 'bl'].includes(interactionType.value!)) newX += newW - minSize; newW = minSize; }
    if (newH < minSize) { if (['t', 'tl', 'tr'].includes(interactionType.value!)) newY += newH - minSize; newH = minSize; }

    newX = Math.max(0, Math.min(100 - newW, newX));
    newY = Math.max(0, Math.min(100 - newH, newY));

    // Ajuste Automático da fonte baseado no TIPO de slide selecionado no momento
    if (autoFontSize.value && interactionType.value !== 'move') {
        const scaleRatio = newH / startBox.h;
        textStyles.value[currentSlideType.value].fontSize = Math.max(2, Math.min(30, startFontSize * scaleRatio));
    }

    design.value.posX = Math.round(newX);
    design.value.posY = Math.round(newY);
    design.value.width = Math.round(newW);
    design.value.height = Math.round(newH);
};

const stopAction = () => {
    interactionType.value = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', stopAction);
};

onUnmounted(() => { stopAction(); });
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
            <v-btn v-if="activeSong" color="primary" variant="flat" size="small"
                prepend-icon="mdi-play">Projetar</v-btn>
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
                        /* A propriedade fontSize saiu daqui e foi para o elemento filho */
                    }" @mousedown="startAction($event, 'move')">

                        <div class="text-inner-content" :style="{
                            fontSize: `${currentActiveStyle.fontSize}cqi`,
                            textAlign: currentActiveStyle.align,
                            fontWeight: currentActiveStyle.bold ? 'bold' : 'normal',
                            fontStyle: currentActiveStyle.italic ? 'italic' : 'normal',
                            color: currentActiveStyle.color, /* ADICIONE ESTA LINHA */
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

                        <v-window-item value="slides" class="pa-4 fill-height">
                            <v-row density="compact">
                                <v-col cols="12" sm="4" md="3" v-for="(slide, index) in songSlides" :key="index">
                                    <v-card @click="currentSlideIndex = index"
                                        :color="currentSlideIndex === index ? 'primary' : ''"
                                        :variant="currentSlideIndex === index ? 'tonal' : 'outlined'"
                                        class="h-100 cursor-pointer bg-surface">
                                        <v-card-title class="text-caption font-weight-bold bg-surface-variant pa-2">
                                            {{ slide.label || `Slide ${index + 1}` }}
                                        </v-card-title>
                                        <v-card-text class="pa-2 text-caption text-truncate-multiline">{{ slide.text
                                            }}</v-card-text>
                                    </v-card>
                                </v-col>
                            </v-row>
                        </v-window-item>

                        <v-window-item value="fundo" class="pa-6 fill-height">
                            <v-row>
                                <v-col cols="12" md="4" class="border-e">
                                    <p class="text-caption font-weight-bold mb-2">Preenchimento da Tela</p>
                                    <v-radio-group v-model="design.bgFit" hide-details density="compact">
                                        <v-radio label="Cortar (Cover - Sem bordas)" value="cover"
                                            color="primary"></v-radio>
                                        <v-radio label="Estender (Fill - Distorce)" value="fill"
                                            color="primary"></v-radio>
                                    </v-radio-group>
                                </v-col>

                                <v-col cols="12" md="8">
                                    <p class="text-caption font-weight-bold mb-2">Selecione o Fundo</p>
                                    <div class="d-flex gap-2 overflow-x-auto pb-2">
                                        <v-card width="100" height="70" color="surface"
                                            class="d-flex align-center justify-center cursor-pointer border"
                                            @click="design.bgType = 'color'; design.bgMedia = ''">
                                            <v-icon>mdi-palette</v-icon>
                                        </v-card>

                                        <v-card width="100" height="70" color="surface-variant"
                                            class="d-flex align-center justify-center cursor-pointer border"
                                            @click="$refs.fileInput.click()">
                                            <v-icon>mdi-upload</v-icon>
                                            <input type="file" ref="fileInput" class="d-none" accept="image/*,video/*"
                                                @change="handleFileUpload">
                                        </v-card>

                                        <v-card v-for="bg in savedBackgrounds" :key="bg.id" width="100" height="70"
                                            class="cursor-pointer border position-relative"
                                            @click="selectSavedBackground(bg)">
                                            <v-img v-if="bg.type === 'image'" :src="bg.url" cover height="100%"></v-img>
                                            <div v-if="bg.type === 'video'"
                                                class="bg-black fill-height d-flex align-center justify-center text-white">
                                                <v-icon>mdi-play-circle-outline</v-icon>
                                            </div>
                                        </v-card>
                                    </div>
                                </v-col>
                            </v-row>
                        </v-window-item>

                        <v-window-item value="texto" class="fill-height overflow-y-auto pa-2 pa-sm-4">
                            <div class="d-flex justify-center pb-4">
                                <v-card max-width="750" width="100%" variant="outlined" class="rounded-lg bg-surface">

                                    <v-tabs v-model="activeTextSetting" color="primary" density="compact" show-arrows
                                        class="border-b bg-surface-light">
                                        <v-tab value="geral">Geral</v-tab>
                                        <v-tab value="refrao">Refrão</v-tab>
                                        <v-tab value="verso">Verso</v-tab>
                                        <v-tab value="titulo">Título</v-tab>
                                    </v-tabs>

                                    <v-card-text class="pa-4 pa-sm-6">

                                        <v-btn v-if="activeTextSetting === 'geral'" prepend-icon="mdi-content-copy"
                                            variant="tonal" color="primary" class="mb-6 w-100" size="small"
                                            @click="applyToAll">
                                            Aplicar este estilo a todos os slides
                                        </v-btn>

                                        <v-row>
                                            <v-col cols="12" md="6">
                                                <p class="text-caption font-weight-bold mb-2">Cor do Texto</p>
                                                <div class="d-flex align-center gap-4 mb-6">

                                                    <v-btn icon size="small" class="border color-btn"
                                                        :class="{ 'selected-color': textStyles[activeTextSetting].color === '#FFFFFF' }"
                                                        color="#FFFFFF"
                                                        @click="textStyles[activeTextSetting].color = '#FFFFFF'">
                                                        <v-icon v-if="textStyles[activeTextSetting].color === '#FFFFFF'"
                                                            color="black" size="18">mdi-check</v-icon>
                                                    </v-btn>

                                                    <v-btn icon size="small" class="border color-btn"
                                                        :class="{ 'selected-color': textStyles[activeTextSetting].color === '#000000' }"
                                                        color="#000000"
                                                        @click="textStyles[activeTextSetting].color = '#000000'">
                                                        <v-icon v-if="textStyles[activeTextSetting].color === '#000000'"
                                                            color="white" size="18">mdi-check</v-icon>
                                                    </v-btn>

                                                    <v-divider vertical class="mx-1"></v-divider>

                                                    <div class="d-flex align-center">
                                                        <label
                                                            class="text-caption font-weight-bold mr-3">Customizada:</label>
                                                        <div class="position-relative">
                                                            <v-btn icon size="small" class="border color-btn"
                                                                :class="{ 'selected-color': !['#FFFFFF', '#000000'].includes(textStyles[activeTextSetting].color) }"
                                                                :color="!['#FFFFFF', '#000000'].includes(textStyles[activeTextSetting].color) ? textStyles[activeTextSetting].color : 'surface-variant'">
                                                                <v-icon
                                                                    :color="!['#FFFFFF', '#000000'].includes(textStyles[activeTextSetting].color) ? 'white' : 'primary'">mdi-palette</v-icon>
                                                            </v-btn>

                                                            <input type="color"
                                                                v-model="textStyles[activeTextSetting].color"
                                                                class="position-absolute top-0 left-0 w-100 h-100 cursor-pointer"
                                                                style="opacity: 0;">
                                                        </div>
                                                    </div>
                                                </div>

                                                <p class="text-caption font-weight-bold mb-2">Alinhamento</p>
                                                <v-btn-toggle v-model="textStyles[activeTextSetting].align"
                                                    color="primary" variant="outlined" divided density="compact"
                                                    mandatory class="mb-4 mb-md-0">
                                                    <v-btn value="left" icon="mdi-format-align-left"></v-btn>
                                                    <v-btn value="center" icon="mdi-format-align-center"></v-btn>
                                                    <v-btn value="right" icon="mdi-format-align-right"></v-btn>
                                                </v-btn-toggle>
                                            </v-col>

                                            <v-col cols="12" md="6">
                                                <p class="text-caption font-weight-bold mb-2">Família da Fonte</p>
                                                <v-select v-model="textStyles[activeTextSetting].fontFamily"
                                                    :items="fontOptions" variant="outlined" density="compact"
                                                    class="mb-6" hide-details></v-select>

                                                <p class="text-caption font-weight-bold mb-2">Estilo</p>
                                                <div class="d-flex gap-2 mb-4 mb-md-0">
                                                    <v-btn
                                                        :variant="textStyles[activeTextSetting].bold ? 'flat' : 'outlined'"
                                                        :color="textStyles[activeTextSetting].bold ? 'primary' : 'surface-variant'"
                                                        icon="mdi-format-bold" density="compact"
                                                        @click="textStyles[activeTextSetting].bold = !textStyles[activeTextSetting].bold"></v-btn>
                                                    <v-btn
                                                        :variant="textStyles[activeTextSetting].italic ? 'flat' : 'outlined'"
                                                        :color="textStyles[activeTextSetting].italic ? 'primary' : 'surface-variant'"
                                                        icon="mdi-format-italic" density="compact"
                                                        @click="textStyles[activeTextSetting].italic = !textStyles[activeTextSetting].italic"></v-btn>
                                                </div>
                                            </v-col>
                                        </v-row>

                                        <v-divider class="my-6"></v-divider>

                                        <p class="text-caption font-weight-bold mb-0">Tamanho da Fonte</p>
                                        <v-slider v-model="textStyles[activeTextSetting].fontSize" min="2" max="25"
                                            step="0.5" thumb-label color="primary" append-icon="mdi-format-size"
                                            hide-details></v-slider>

                                    </v-card-text>
                                </v-card>
                            </div>
                        </v-window-item>
                        <v-window-item value="posicao"
                            class="pa-6 fill-height d-flex flex-column align-center justify-center">

                            <v-checkbox v-model="autoFontSize" label="Ajustar fonte automaticamente ao redimensionar"
                                color="primary" density="compact" hide-details class="mb-4"></v-checkbox>

                            <v-card width="400" variant="outlined" class="pa-6 rounded-lg text-center bg-surface">
                                <v-icon icon="mdi-gesture-tap" size="40" color="primary" class="mb-2"></v-icon>
                                <h3 class="text-h6 font-weight-bold mb-1">Ajuste Livre</h3>
                                <p class="text-body-2 text-medium-emphasis mb-6">Arraste a caixa pontilhada no telão
                                    acima
                                    para posicionar o texto onde desejar.</p>

                                <v-row>
                                    <v-col cols="6">
                                        <v-text-field v-model="design.posX" label="Eixo X (%)" type="number"
                                            variant="outlined" density="compact" suffix="%"></v-text-field>
                                    </v-col>
                                    <v-col cols="6">
                                        <v-text-field v-model="design.posY" label="Eixo Y (%)" type="number"
                                            variant="outlined" density="compact" suffix="%"></v-text-field>
                                    </v-col>
                                </v-row>
                                <v-row>
                                    <v-col cols="6">
                                        <v-text-field v-model="design.width" label="Largura (%)" type="number"
                                            variant="outlined" density="compact" suffix="%"></v-text-field>
                                    </v-col>
                                    <v-col cols="6">
                                        <v-text-field v-model="design.height" label="Altura (%)" type="number"
                                            variant="outlined" density="compact" suffix="%"></v-text-field>
                                    </v-col>
                                </v-row>
                            </v-card>
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
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
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