<template>
    <div class="media-player-wrap" 
         @mouseenter="showControls = true" 
         @mouseleave="onMouseLeave"
         @mousemove="onMouseMove">
        
        <SmartVideo
            ref="videoRef"
            :src="src"
            :autoplay="autoplay"
            :muted="muted"
            :loop="loop"
            :object-fit="objectFit"
            class="media-player-video"
            @loadedmetadata="onLoadedMetadata"
            @timeupdate="onTimeUpdate"
            @play="onPlay"
            @pause="onPause"
            @ended="onEnded"
            @click="togglePlay" />

        <!-- Overlay de controles -->
        <transition name="fade">
            <div v-show="showControls || paused" class="media-controls">
                <!-- Barra de progresso -->
                <div class="progress-row">
                    <span class="time-label">{{ formatTime(currentTime) }}</span>
                    <v-slider
                        v-model="sliderValue"
                        :max="duration"
                        min="0"
                        step="0.1"
                        color="white"
                        hide-details
                        density="compact"
                        class="progress-slider"
                        @start="onDragStart"
                        @update:model-value="onDrag"
                        @end="onDragEnd" />
                    <span class="time-label">{{ formatTime(duration) }}</span>
                </div>

                <!-- Botões -->
                <div class="buttons-row">
                    <v-btn 
                        :icon="paused ? 'mdi-play' : 'mdi-pause'" 
                        size="small" 
                        variant="text" 
                        color="white"
                        @click="togglePlay" />
                    
                    <v-btn 
                        icon="mdi-replay" 
                        size="small" 
                        variant="text" 
                        color="white"
                        @click="restart"
                        title="Reiniciar" />

                    <!-- Volume -->
                    <div class="volume-group" @mouseenter="showVolumeSlider = true" @mouseleave="showVolumeSlider = false">
                        <v-btn
                            :icon="volumeIcon"
                            size="small"
                            variant="text"
                            color="white"
                            @click="toggleMute" />
                        <transition name="slide">
                            <div v-show="showVolumeSlider" class="volume-slider-wrap">
                                <v-slider
                                    v-model="volumeValue"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    color="white"
                                    hide-details
                                    density="compact"
                                    class="volume-slider" />
                            </div>
                        </transition>
                    </div>

                    <v-spacer />

                    <!-- Slot opcional para botões extras à direita -->
                    <slot name="extra-buttons" />
                </div>
            </div>
        </transition>

        <!-- Botão play grande no centro quando pausado -->
        <transition name="scale">
            <div v-if="paused && hasStarted" class="center-play" @click="togglePlay">
                <v-icon size="64" color="white">mdi-play-circle</v-icon>
            </div>
        </transition>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import SmartVideo from '../SmartVideo.vue';

const props = withDefaults(defineProps<{
    src?: string;
    autoplay?: boolean;
    muted?: boolean;
    loop?: boolean;
    objectFit?: 'contain' | 'cover' | 'fill' | 'none';
}>(), {
    autoplay: false,
    muted: false,
    loop: false,
    objectFit: 'contain',
});

const videoRef = ref<any>(null);

// ─── Estado UI ───────────────────────────────────────────────────────
const currentTime = ref(0);
const duration = ref(0);
const paused = ref(true);
const sliderValue = ref(0);
const volumeValue = ref(1);
const internalMuted = ref(props.muted);
const hasStarted = ref(false);
const isDragging = ref(false);

// ─── Controle de visibilidade dos controles ──────────────────────────
const showControls = ref(true);
const showVolumeSlider = ref(false);
let _hideTimer: ReturnType<typeof setTimeout> | null = null;

function _scheduleHide() {
    if (_hideTimer) clearTimeout(_hideTimer);
    _hideTimer = setTimeout(() => {
        if (!paused.value && !isDragging.value) {
            showControls.value = false;
        }
    }, 2500);
}

function onMouseMove() {
    showControls.value = true;
    _scheduleHide();
}

function onMouseLeave() {
    if (!paused.value && !isDragging.value) {
        showControls.value = false;
    }
}

// ─── Handlers de eventos do SmartVideo ───────────────────────────────
function onLoadedMetadata(e: any) {
    const target = e.target;
    const dur = target?.duration?.value ?? target?.duration ?? 0;
    if (isFinite(dur) && dur > 0) {
        duration.value = dur;
    }
}

function onTimeUpdate(e: any) {
    if (isDragging.value) return;
    const target = e.target;
    const rawCt = target?.currentTime;
    const ct = (rawCt && typeof rawCt === 'object' && 'value' in rawCt) ? rawCt.value : (rawCt ?? 0);
    if (isFinite(ct) && ct >= 0) {
        currentTime.value = ct;
        sliderValue.value = ct;
    }
}

function onPlay() {
    paused.value = false;
    hasStarted.value = true;
    _scheduleHide();
}

function onPause() {
    paused.value = true;
    if (_hideTimer) clearTimeout(_hideTimer);
    showControls.value = true;
}

function onEnded() {
    paused.value = true;
    showControls.value = true;
}

// ─── Ações ───────────────────────────────────────────────────────────
async function togglePlay() {
    if (!videoRef.value) return;
    if (paused.value) {
        await videoRef.value.play();
    } else {
        videoRef.value.pause();
    }
}

async function restart() {
    if (!videoRef.value) return;
    try {
        videoRef.value.currentTime = 0;
        currentTime.value = 0;
        sliderValue.value = 0;
        await videoRef.value.play();
    } catch { }
}

function toggleMute() {
    internalMuted.value = !internalMuted.value;
    if (videoRef.value?.setMuted) {
        videoRef.value.setMuted(internalMuted.value);
    }
}

// ─── Scrubbing ───────────────────────────────────────────────────────
let _wasPlayingBeforeDrag = false;

function onDragStart() {
    isDragging.value = true;
    _wasPlayingBeforeDrag = !paused.value;
    if (videoRef.value) videoRef.value.pause();
}

function onDrag(val: number) {
    if (!isDragging.value) return;
    sliderValue.value = val;
    currentTime.value = val;
    if (videoRef.value) {
        try { videoRef.value.currentTime = val; } catch { }
    }
}

async function onDragEnd() {
    isDragging.value = false;
    if (videoRef.value) {
        try { videoRef.value.currentTime = sliderValue.value; } catch { }
    }
    if (_wasPlayingBeforeDrag && videoRef.value) {
        try { await videoRef.value.play(); } catch { }
    }
    _scheduleHide();
}

// ─── Volume ──────────────────────────────────────────────────────────
watch(volumeValue, (v) => {
    if (!videoRef.value?.setVolume) return;
    videoRef.value.setVolume(v);
    if (v > 0 && internalMuted.value) {
        internalMuted.value = false;
        if (videoRef.value?.setMuted) videoRef.value.setMuted(false);
    }
});

const volumeIcon = computed(() => {
    if (internalMuted.value || volumeValue.value === 0) return 'mdi-volume-off';
    if (volumeValue.value < 0.5) return 'mdi-volume-medium';
    return 'mdi-volume-high';
});

// ─── Helpers ─────────────────────────────────────────────────────────
function formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '00:00';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// ─── Limpeza ─────────────────────────────────────────────────────────
onUnmounted(() => {
    if (_hideTimer) clearTimeout(_hideTimer);
});

// ─── Expor API para o pai (opcional) ─────────────────────────────────
defineExpose({
    play: () => videoRef.value?.play(),
    pause: () => videoRef.value?.pause(),
    seek: (t: number) => videoRef.value?.seek?.(t),
    videoRef,
});
</script>

<style scoped>
.media-player-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    background: black;
    overflow: hidden;
    border-radius: 8px;
}

.media-player-video {
    width: 100%;
    height: 100%;
    display: block;
    cursor: pointer;
}

/* ══════ Overlay de controles ══════ */
.media-controls {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 16px 16px 10px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.5) 60%, transparent 100%);
    z-index: 2;
    color: white;
    user-select: none;
}

.progress-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
}

.progress-slider {
    flex: 1;
}

.time-label {
    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    min-width: 42px;
    text-align: center;
    color: rgba(255, 255, 255, 0.9);
}

.buttons-row {
    display: flex;
    align-items: center;
    gap: 4px;
}

/* ══════ Volume ══════ */
.volume-group {
    display: flex;
    align-items: center;
    overflow: hidden;
}

.volume-slider-wrap {
    width: 80px;
    margin-left: 4px;
}

.volume-slider :deep(.v-slider-track) {
    --v-slider-track-size: 3px;
}

/* ══════ Play grande central ══════ */
.center-play {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 1;
    pointer-events: none;
}

.center-play .v-icon {
    pointer-events: auto;
    opacity: 0.85;
    filter: drop-shadow(0 2px 12px rgba(0, 0, 0, 0.6));
    transition: transform 0.15s ease, opacity 0.15s ease;
}

.center-play:hover .v-icon {
    transform: scale(1.1);
    opacity: 1;
}

/* ══════ Slider com estilo nativo ══════ */
.progress-slider :deep(.v-slider-track__fill),
.progress-slider :deep(.v-slider-thumb) {
    transition: none;
}

.progress-slider :deep(.v-slider-track) {
    --v-slider-track-size: 4px;
}

.progress-slider :deep(.v-slider-thumb__surface) {
    width: 14px;
    height: 14px;
}

/* ══════ Transições ══════ */
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
    transition: width 0.2s ease, opacity 0.2s ease;
}

.slide-enter-from,
.slide-leave-to {
    width: 0 !important;
    opacity: 0;
}

.scale-enter-active,
.scale-leave-active {
    transition: transform 0.2s ease, opacity 0.2s ease;
}

.scale-enter-from,
.scale-leave-to {
    transform: scale(0.5);
    opacity: 0;
}
</style>