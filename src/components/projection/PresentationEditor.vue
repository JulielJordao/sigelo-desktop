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

// Simulação de detecção do Tauri (ex: 1920x1080 = 16/9, 1024x768 = 4/3)
const screenResolution = ref({ width: 1920, height: 1080 });
const screenRatio = computed(() => screenResolution.value.width / screenResolution.value.height);

// Controles de interação
const interactionType = ref<string | null>(null)
const startMouse = { x: 0, y: 0 };
const startBox = { x: 0, y: 0, w: 0, h: 0 };

// --- ESTADOS DO DESIGN ---
const design = ref({
    // Fundo
    bgType: 'color', // 'color', 'saved', 'upload'
    bgColor: '#000000',
    bgMedia: '',
    bgIsVideo: false,
    bgFit: 'cover', // 'cover' (Cortar) ou 'fill' (Estender)

    // Texto
    fontFamily: 'Inter',
    fontSize: 6, // em vh para manter proporção

    // Posição (Porcentagem em relação ao slide)
    posX: 50,
    posY: 50,

    width: 80,
    height: 30
});

const fontOptions = ['Inter', 'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Montserrat'];

// --- MOCK DE FUNDOS SALVOS ---
const savedBackgrounds = [
    { id: 1, type: 'image', url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba', name: 'Montanhas' },
    { id: 2, type: 'image', url: 'https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0', name: 'Escuro/Abstrato' },
    { id: 3, type: 'video', url: 'https://www.w3schools.com/html/mov_bbb.mp4', name: 'Fundo Animado (Exemplo)' }
];

// --- LÓGICA DE ARRASTAR E SOLTAR (DRAG & DROP) ---
const startAction = (e: MouseEvent, type: string) => {
    e.preventDefault()
    if (currentTab.value !== 'posicao') return

    interactionType.value = type
    startMouse.x = e.clientX
    startMouse.y = e.clientY

    startBox.x = design.value.posX
    startBox.y = design.value.posY
    startBox.w = design.value.width
    startBox.h = design.value.height

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stopAction)
}

const onMove = (e: MouseEvent) => {
    if (!interactionType.value || !previewContainer.value) return

    const rect = previewContainer.value.getBoundingClientRect()

    const deltaX = ((e.clientX - startMouse.x) / rect.width) * 100
    const deltaY = ((e.clientY - startMouse.y) / rect.height) * 100

    let newX = startBox.x
    let newY = startBox.y
    let newW = startBox.w
    let newH = startBox.h

    switch (interactionType.value) {
        case 'move':
            newX = startBox.x + deltaX
            newY = startBox.y + deltaY
            break

        // Cantos
        case 'br':
            newW = startBox.w + deltaX
            newH = startBox.h + deltaY
            break

        case 'bl':
            newW = startBox.w - deltaX
            newX = startBox.x + deltaX
            newH = startBox.h + deltaY
            break

        case 'tr':
            newW = startBox.w + deltaX
            newH = startBox.h - deltaY
            newY = startBox.y + deltaY
            break

        case 'tl':
            newW = startBox.w - deltaX
            newX = startBox.x + deltaX
            newH = startBox.h - deltaY
            newY = startBox.y + deltaY
            break

        // Laterais
        case 'r':
            newW = startBox.w + deltaX
            break

        case 'l':
            newW = startBox.w - deltaX
            newX = startBox.x + deltaX
            break

        case 'b':
            newH = startBox.h + deltaY
            break

        case 't':
            newH = startBox.h - deltaY
            newY = startBox.y + deltaY
            break
    }

    // 🔒 Limites
    // tamanho mínimo
    const minSize = 5

    if (newW < minSize) {
        if (['l', 'tl', 'bl'].includes(interactionType.value!)) {
            newX += newW - minSize
        }
        newW = minSize
    }

    if (newH < minSize) {
        if (['t', 'tl', 'tr'].includes(interactionType.value!)) {
            newY += newH - minSize
        }
        newH = minSize
    }

    // limites do container
    newX = Math.max(0, Math.min(100 - newW, newX))
    newY = Math.max(0, Math.min(100 - newH, newY))

    design.value.posX = Math.round(newX)
    design.value.posY = Math.round(newY)
    design.value.width = Math.round(newW)
    design.value.height = Math.round(newH)
}

const stopAction = () => {
    interactionType.value = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', stopAction)
}

onUnmounted(() => { stopAction() }); // Limpeza de segurança

// --- LÓGICA DE DADOS ---
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
</script>

<template>
    <div class="d-flex flex-column fill-height bg-white">
        <v-toolbar density="compact" color="white" elevation="0" class="border-b px-2 flex-shrink-0">
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

            <div class="bg-grey-darken-4 d-flex align-center justify-center relative flex-shrink-0 preview-wrapper">
                <div ref="previewContainer" class="preview-screen"
                    :style="{ aspectRatio: screenRatio, backgroundColor: design.bgColor }">
                    <div class="slide-text-box" :class="{
                        'is-positioning': currentTab === 'posicao',
                        'is-active': interactionType !== null
                    }" :style="{
                        left: `${design.posX}%`,
                        top: `${design.posY}%`,
                        width: `${design.width}%`,
                        height: `${design.height}%`,
                        fontFamily: design.fontFamily,
                        fontSize: `${design.fontSize}cqi`
                    }" @mousedown="startAction($event, 'move')">
                        {{ currentSlideText }}

                        <template v-if="currentTab === 'posicao'">
                            <!-- Cantos -->
                            <div class="handle tl" @mousedown.stop="startAction($event, 'tl')" />
                            <div class="handle tr" @mousedown.stop="startAction($event, 'tr')" />
                            <div class="handle bl" @mousedown.stop="startAction($event, 'bl')" />
                            <div class="handle br" @mousedown.stop="startAction($event, 'br')" />

                            <!-- Laterais -->
                            <div class="handle t" @mousedown.stop="startAction($event, 't')" />
                            <div class="handle b" @mousedown.stop="startAction($event, 'b')" />
                            <div class="handle l" @mousedown.stop="startAction($event, 'l')" />
                            <div class="handle r" @mousedown.stop="startAction($event, 'r')" />
                        </template>
                    </div>
                </div>
            </div>


            <v-card class="flex-grow-1 rounded-0 elevation-0 d-flex flex-column border-t">
                <v-tabs v-model="currentTab" bg-color="white" density="compact" class="border-b" color="primary">
                    <v-tab value="slides"><v-icon start>mdi-presentation-play</v-icon>Slides</v-tab>
                    <v-tab value="fundo"><v-icon start>mdi-image-outline</v-icon>Fundo</v-tab>
                    <v-tab value="texto"><v-icon start>mdi-format-text</v-icon>Texto</v-tab>
                    <v-tab value="posicao"><v-icon start>mdi-crosshairs-gps</v-icon>Posição</v-tab>
                </v-tabs>

                <v-card-text class="flex-grow-1 overflow-y-auto pa-0 bg-white">
                    <v-window v-model="currentTab" class="fill-height">

                        <v-window-item value="slides" class="pa-4 fill-height">
                            <v-row dense>
                                <v-col cols="12" sm="4" md="3" v-for="(slide, index) in songSlides" :key="index">
                                    <v-card @click="currentSlideIndex = index"
                                        :color="currentSlideIndex === index ? 'primary-lighten-5' : 'white'"
                                        :class="['h-100 cursor-pointer', currentSlideIndex === index ? 'border-primary' : '']"
                                        variant="outlined">
                                        <v-card-title class="text-caption font-weight-bold bg-grey-lighten-4 pa-2">
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
                                        <v-card width="100" height="70"
                                            class="d-flex align-center justify-center cursor-pointer border"
                                            @click="design.bgType = 'color'; design.bgMedia = ''">
                                            <v-icon>mdi-palette</v-icon>
                                        </v-card>

                                        <v-card width="100" height="70"
                                            class="d-flex align-center justify-center cursor-pointer border bg-grey-lighten-4"
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
                                                class="bg-grey-darken-3 fill-height d-flex align-center justify-center text-white">
                                                <v-icon>mdi-play-circle-outline</v-icon>
                                            </div>
                                        </v-card>
                                    </div>
                                </v-col>
                            </v-row>
                        </v-window-item>

                        <v-window-item value="texto"
                            class="pa-6 fill-height d-flex flex-column justify-center align-center">
                            <v-card width="400" variant="outlined" class="pa-6 rounded-lg">
                                <p class="text-caption font-weight-bold mb-2">Família da Fonte</p>
                                <v-select v-model="design.fontFamily" :items="fontOptions" variant="outlined"
                                    density="compact" class="mb-4"></v-select>

                                <p class="text-caption font-weight-bold mb-0">Tamanho da Fonte</p>
                                <v-slider v-model="design.fontSize" min="2" max="15" step="0.5" thumb-label
                                    color="primary" append-icon="mdi-format-size"></v-slider>
                            </v-card>
                        </v-window-item>

                        <v-window-item value="posicao" class="pa-6 fill-height d-flex align-center justify-center">
                            <v-card width="400" variant="outlined"
                                class="pa-6 rounded-lg text-center bg-grey-lighten-5">
                                <v-icon icon="mdi-gesture-tap" size="40" color="primary" class="mb-2"></v-icon>
                                <h3 class="text-h6 font-weight-bold mb-1">Ajuste Livre</h3>
                                <p class="text-body-2 text-grey-darken-1 mb-6">Arraste a caixa pontilhada no telão acima
                                    para
                                    posicionar o texto onde desejar.</p>

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
                                        <v-text-field v-model="design.width" label="Largura" type="number"
                                            variant="outlined" density="compact" suffix="%"></v-text-field>
                                    </v-col>
                                    <v-col cols="6">
                                        <v-text-field v-model="design.height" label="Altura" type="number"
                                            variant="outlined" density="compact" suffix="%"></v-text-field>
                                    </v-col>
                                </v-row>
                            </v-card>
                        </v-window-item>

                    </v-window>
                </v-card-text>
            </v-card>
        </div>

        <div v-else class="flex-grow-1 d-flex flex-column align-center justify-center text-grey">
            <v-icon icon="mdi-projector-screen-outline" size="64" class="mb-4 text-grey-lighten-2"></v-icon>
            <h3 class="font-weight-medium">Selecione uma música no repertório</h3>
        </div>
    </div>
</template>

<style scoped>
.preview-wrapper {
    height: 45vh;
    padding: 24px;
    /* Ativa container queries para a fonte escalar perfeitamente dentro do preview */
    container-type: inline-size;
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

/* O container do texto */
.slide-text-box {
position: absolute;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    color: white;
    text-align: center;
    white-space: pre-wrap;
    user-select: none;

    border: 2px dashed rgba(255,255,255,0.6);
    background-color: rgba(33,150,243,0.1);

    cursor: move;
}

/* Modo de edição de posição (Aba "Posição" ativa) */
.slide-text-box.is-positioning {
    border: 2px dashed rgba(255, 255, 255, 0.8);
    background-color: rgba(0, 0, 0, 0.2);
    cursor: grab;
}

/* Durante o arrasto */
.slide-text-box.is-dragging {
    cursor: grabbing;
    border-color: #2196F3;
    background-color: rgba(33, 150, 243, 0.2);
    transition: none;
    /* Desativa a transição para o arrasto não ter "lag" */
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


.slide-text-box {
    position: absolute;
    /* Removido o transform translate para facilitar a lógica de redimensionamento */
    z-index: 10;
    display: flex;
    align-items: center;
    /* Centraliza o texto verticalmente dentro da caixa */
    justify-content: center;
    /* Centraliza o texto horizontalmente dentro da caixa */
    overflow: hidden;
    color: white;
    text-align: center;
    white-space: pre-wrap;
    cursor: default;
}

.is-positioning {
    border: 1px dashed rgba(255, 255, 255, 0.5);
    background-color: rgba(33, 150, 243, 0.1);
    cursor: move;
}

.is-active {
    border-color: #2196F3;
    background-color: rgba(33, 150, 243, 0.2);
}

/* A alça de redimensionamento no canto inferior direito */
.resize-handle {
    position: absolute;
    right: -5px;
    bottom: -5px;
    width: 12px;
    height: 12px;
    background-color: #2196F3;
    border: 2px solid white;
    border-radius: 50%;
    cursor: nwse-resize;
    /* Cursor de redimensionamento diagonal */
    z-index: 20;
}

.resize-handle:hover {
    transform: scale(1.2);
}

.handle {
    position: absolute;
    width: 12px;
    height: 12px;
    background: white;
    border: 2px solid #1976d2;
    border-radius: 50%;
}

/* Cantos */
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

/* Laterais */
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
</style>