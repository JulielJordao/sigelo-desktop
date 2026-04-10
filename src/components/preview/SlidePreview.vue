<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import { useConfigStore } from '../../stores/useConfigStore';

const configStore = useConfigStore()

const props = defineProps({
    // Recebe o design e o estilo específicos
    design: { type: Object, required: true },
    textStyle: { type: Object, required: true },
    text: { type: String, default: 'Slide Text' },
    screenRatio: { type: Number, default: 16/9 },
    
    // Controles de comportamento
    editable: { type: Boolean, default: false }, // Se true, mostra as âncoras de edição
    autoFontSize: { type: Boolean, default: false }
});

const emit = defineEmits(['update-layout', 'update-font-size']);

const previewContainer = ref<HTMLElement | null>(null);
const interactionType = ref<string | null>(null);

// Lógica de Drag & Drop isolada
const startMouse = { x: 0, y: 0 };
const startBox = { x: 0, y: 0, w: 0, h: 0 };
let startFontSize = 0;

const startAction = (e: MouseEvent, type: string) => {
    e.preventDefault();
    if (!props.editable) return; // Só permite arrastar se for editável

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

    // Emite as novas posições para o componente pai salvar
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
};


onUnmounted(() => {
    stopAction();
});
</script>

<template>
    <div ref="previewContainer" class="preview-screen"
        :style="{ aspectRatio: screenRatio, backgroundColor: design.bgType === 'color' ? design.bgColor : '#000' }">

        <img v-if="design.bgType !== 'color' && !design.bgIsVideo && design.bgMedia" :src="design.bgMedia"
            class="video-bg" :style="{ objectFit: design.bgFit }" />

        <video v-if="design.bgType !== 'color' && design.bgIsVideo && design.bgMedia" :src="design.bgMedia" autoplay
            loop muted class="video-bg" :style="{ objectFit: design.bgFit }"></video>

        <div 
            class="dark-overlay" 
            :style="{ backgroundColor: `rgba(0, 0, 0, ${configStore.settings.bgOpacity / 100})` }"
        ></div>
        <div class="slide-text-box" :class="{
            'is-positioning': editable,
            'is-active': interactionType !== null
        }" :style="{
            left: `${design.posX}%`,
            top: `${design.posY}%`,
            width: `${design.width}%`,
            height: `${design.height}%`,
            fontFamily: textStyle.fontFamily
        }" @mousedown="startAction($event, 'move')">

            <div class="text-inner-content" :style="{
                fontSize: `${textStyle.fontSize}cqi`,
                textAlign: textStyle.align,
                fontWeight: textStyle.bold ? 'bold' : 'normal',
                fontStyle: textStyle.italic ? 'italic' : 'normal',
                color: textStyle.color,
                width: '100%',
                maxHeight: '100%',
                overflow: 'hidden'
            }">
                {{ text }}
            </div>

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

.dark-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 2; /* Nível 2 - Acima do fundo */
    pointer-events: none; 
    transition: background-color 0.3s ease; 
}

.video-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
}

.slide-text-box {
    position: absolute;
    z-index: 20;
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
    z-index: 3;
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
    /* Limita a 4 linhas no preview */
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
    /* Dá um leve zoom no botão selecionado */
}
</style>