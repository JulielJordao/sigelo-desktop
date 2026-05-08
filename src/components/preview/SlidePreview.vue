<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue';
import { useConfigStore } from '../../stores/useConfigStore';
import { useStatusPresentationStore } from '../../stores/statusPresentationStore';
import { useMusicPresentationStore } from '../../stores/presentationStore';
import SmartVideo from '../SmartVideo.vue';
import { formatAuthorCredits } from '../../utils/formatCredits';
import { cleanSlideText } from '../../utils/convertData';

const configStore = useConfigStore()
const statusStore = useStatusPresentationStore()

const songInfo = useMusicPresentationStore();

const isReloadEngine = ref(true);

const props = defineProps({
    // Recebe o design e o estilo específicos
    design: { type: Object, required: true },
    textStyle: { type: Object, required: true },
    text: { type: String, default: 'Slide Text' },
    screenRatio: { type: Number, default: 16 / 9 },

    // Controles de comportamento
    editable: { type: Boolean, default: false },
    autoFontSize: { type: Boolean, default: false },

    isFixedPreview: { type: Boolean, default: false },

    // NOVO: Prop para forçar a pausa do vídeo externamente
    pauseVideo: { type: Boolean, default: false },
    isCoverSlide: { type: Boolean, default: false }
});

const emit = defineEmits(['update-layout', 'update-font-size']);

const previewContainer = ref<HTMLElement | null>(null);
const interactionType = ref<string | null>(null);

// NOVO: Referência ao elemento de vídeo e controle de pausa
const videoRef = ref<HTMLVideoElement | null>(null);

const isVideoPaused = computed(() => {
    // Pausa se a prop for verdadeira OU se houver alguma apresentação rodando
    return props.pauseVideo || statusStore.status.isPresentation !== 'none';
});

// Assiste à mudança de estado para pausar/tocar programaticamente
watch(isVideoPaused, (paused) => {
    if (!videoRef.value) return;

    if (paused) {
        videoRef.value.pause();
    } else {
        // O play() retorna uma Promise. Capturamos o erro silenciosamente
        // caso o navegador bloqueie o autoplay por algum motivo interno.
        videoRef.value.play().catch(e => console.warn("Autoplay bloqueado:", e));
    }
});

// Lógica de Drag & Drop isolada
const startMouse = { x: 0, y: 0 };
const startBox = { x: 0, y: 0, w: 0, h: 0 };
let startFontSize = 0;

const startAction = (e: MouseEvent, type: string) => {
    e.preventDefault();
    if (!props.editable) return;

    interactionType.value = type;
    startMouse.x = e.clientX;
    startMouse.y = e.clientY;

    startBox.x = props.design.posX;
    startBox.y = props.design.posY;
    startBox.w = props.design.width;
    startBox.h = props.design.height;

    startFontSize = props.textStyle.fontSize;

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

    if (props.autoFontSize && interactionType.value !== 'move') {
        const scaleRatio = newH / startBox.h;
        const newFontSize = Math.max(2, Math.min(30, startFontSize * scaleRatio));
        emit('update-font-size', newFontSize);
    }

    emit('update-layout', {
        posX: Math.round(newX),
        posY: Math.round(newY),
        width: Math.round(newW),
        height: Math.round(newH)
    });
};

const stopAction = () => {
    interactionType.value = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', stopAction);
}

onUnmounted(() => {
    stopAction();

});

onMounted(() => {
    if (props.pauseVideo === true) {
        videoRef.value?.pause()
    }
})

watch(() => props.design.bgMedia, async () => {
    await nextTick();
    console.log(props.design.bgMedia)
    if (videoRef.value) {
        // videoRef.value.load(); // ← força o browser a recarregar o novo src
        if (!isVideoPaused.value) {
            videoRef.value.play().catch(() => { });
        }
    }
});

watch(() => configStore.settings.videoEngine, (engine) => {
    console.log("engine", engine)
    isReloadEngine.value = false

    setTimeout(() => {
        isReloadEngine.value = true
    })
})

// Texto formatado dos créditos
const creditsText = computed(() => {

    const song = songInfo.activeSong as any;
    if (!song) return '';

    return formatAuthorCredits(song)

});

// Decide se mostra os créditos no canto
const showCornerCredits = computed(() => {
    return props.design.authorCredits
        && creditsText.value
        && !props.design.authorCreditsCoverOnly
        && !props.isCoverSlide;
});

// Decide se mostra os créditos abaixo do título (capa)
const showCoverCredits = computed(() => {
    return props.design.authorCredits
        && creditsText.value
        && props.design.authorCreditsCoverOnly
        && props.isCoverSlide;
});

const creditsPosition = computed(() => props.design.authorCreditsPosition || 'bottom-right');
</script>

<template>
    <div ref="previewContainer" class="preview-screen" :style="{
        aspectRatio: screenRatio,
        backgroundColor: design.bgType === 'color' ? design.bgColor : '#000',
        maxWidth: `min(900px, calc(400px * ${screenRatio}))`
    }">

        <img v-if="design.bgType !== 'color' && !design.bgIsVideo && design.bgMedia" :src="design.bgMedia"
            class="video-bg" :style="{ objectFit: design.bgFit }" />

        <div v-if="props.isFixedPreview">
            <SmartVideo ref="videoRef" v-if="design.bgType !== 'color' && design.bgIsVideo && design.bgMedia"
                :src="design.bgMedia" no-audio loop muted class="video-bg" :object-fit="design.bgFit" preview-only />
        </div>
        <div v-else>
            <SmartVideo ref="videoRef"
                v-if="design.bgType !== 'color' && design.bgIsVideo && design.bgMedia && isReloadEngine"
                :src="design.bgMedia" no-audio :autoplay="!isVideoPaused" loop muted class="video-bg"
                :object-fit="design.bgFit" :preview-timestamp="1" />
        </div>


        <v-fade-transition>
            <div v-if="design.bgIsVideo && isVideoPaused && !props.isFixedPreview" class="video-paused-indicator">
                <v-icon color="white" size="48">mdi-play-circle-outline</v-icon>
            </div>
        </v-fade-transition>

        <div class="dark-overlay"
            :style="{ backgroundColor: `rgba(0, 0, 0, ${configStore.settings.bgOpacity / 100})` }"></div>

        <div class="slide-text-box" :class="{ 'is-positioning': editable, 'is-active': interactionType !== null }"
            :style="{ left: `${design.posX}%`, top: `${design.posY}%`, width: `${design.width}%`, height: `${design.height}%`, fontFamily: textStyle.fontFamily }"
            @mousedown="startAction($event, 'move')">

            <div class="text-with-credits-wrapper-preview" :style="{ textAlign: textStyle.align }">
                <div class="text-inner-content" :style="{
                    fontSize: `${textStyle.fontSize}cqi`,
                    textAlign: textStyle.align,
                    fontWeight: textStyle.bold ? 'bold' : 'normal',
                    fontStyle: textStyle.italic ? 'italic' : 'normal',
                    color: textStyle.color,
                    width: '100%',
                    lineHeight: 1.2
                }">
                    {{ cleanSlideText(text) }}
                </div>

                <!-- Créditos abaixo do título (modo capa) -->
                <div v-if="showCoverCredits" class="author-credits-cover-preview" :style="{
                    fontFamily: textStyle.fontFamily,
                    fontSize: (textStyle.fontSize * 0.20) + 'cqi',
                    color: textStyle.color,
                    textAlign: textStyle.align
                }">
                    {{ creditsText }}
                </div>
            </div>

            <!-- Handles de edição -->
            <template v-if="editable">
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
        <!-- Créditos no canto (fora da text-box, no preview-screen) -->
        <div v-if="showCornerCredits" class="author-credits-corner-preview" :class="`pos-${creditsPosition}`" :style="{
            fontFamily: textStyle.fontFamily,
            fontSize: (textStyle.fontSize * 0.3) + 'cqi',
            color: textStyle.color
        }">
            {{ creditsText }}
        </div>
    </div>
</template>

<style scoped>
.preview-wrapper {
    height: 45vh;
    padding: 24px;
}

.preview-screen {
    width: 100%;
    border-radius: 4px;
    overflow: hidden;
    position: relative;
    transition: aspect-ratio 0.3s ease;
    contain: layout paint;
    transform: translateZ(0);
    container-type: inline-size;
}

.dark-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    pointer-events: none;
    transition: background-color 0.3s ease;
    will-change: background-color;
    transform: translateZ(0);
}

.video-bg {
    position: absolute;
    transform: translateZ(0);
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    will-change: contents;
    pointer-events: none;
}

.slide-text-box {
    position: absolute;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: white;
    text-align: center;
    white-space: pre-wrap;
    user-select: none;
    border: 2px dashed rgba(255, 255, 255, 0.6);
    background-color: rgba(33, 150, 243, 0.1);
    cursor: move;
    container-type: inline-size;
}

.text-with-credits-wrapper-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-height: 100%;
    overflow: hidden;
}

.text-inner-content {
    pointer-events: none;
    z-index: 3;
    width: 100%;
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
    line-clamp: 4;
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
    transform: scale(1.1);
}

.video-paused-indicator {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 10;
    background-color: rgba(0, 0, 0, 0.5);
}

.video-paused-indicator span {
    text-shadow: 0px 2px 4px rgba(0, 0, 0, 0.8);
    letter-spacing: 1px;
}

/* ════════════════════ CRÉDITOS ════════════════════ */

/* Créditos no canto dos slides */
.author-credits-corner-preview {
    position: absolute;
    z-index: 15;
    padding: 1.5cqi 2cqi;
    opacity: 0.85;
    pointer-events: none;
    text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.7);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.2;
    max-width: 40%;
}

.author-credits-corner-preview.pos-top-left {
    top: 0;
    left: 0;
    text-align: left;
}

.author-credits-corner-preview.pos-top-right {
    top: 0;
    right: 0;
    text-align: right;
}

.author-credits-corner-preview.pos-bottom-left {
    bottom: 0;
    left: 0;
    text-align: left;
}

.author-credits-corner-preview.pos-bottom-right {
    bottom: 0;
    right: 0;
    text-align: right;
}

/* Créditos abaixo do título (slide de capa) - dentro do flex wrapper */
.author-credits-cover-preview {
    margin-top: 2.5cqi;
    opacity: 0.85;
    font-style: italic;
    line-height: 1.3;
    width: 100%;
    pointer-events: none;
    white-space: pre-wrap;
    word-break: break-word;
}
</style>