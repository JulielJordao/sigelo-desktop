<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { emit } from '@tauri-apps/api/event';
import { useStatusPresentationStore } from '../../stores/statusPresentationStore';
import { useMenuStore } from '../../stores/menuStore';
import { useMediaPlaybackStore } from '../../stores/mediaPlaybackStore'; // <-- NOVA STORE

const props = defineProps({
    isToolbar: {
        type: Boolean,
        default: false
    }
});

const menuStore = useMenuStore();
const statusPresStore = useStatusPresentationStore();
const playbackStore = useMediaPlaybackStore(); // Instância da nova Store
const menuOpen = ref(false);

const previewVideo = ref<HTMLVideoElement | null>(null);

// Barra de progresso local (suavidade ao arrastar)
const sliderValue = ref(0);

// ==========================================
// SINCRONIZAÇÃO DE TEMPO OFICIAL (Via Vídeo)
// ==========================================
const onLoadedMetadata = () => {
    if (previewVideo.value) {
        playbackStore.duration = previewVideo.value.duration;
    }
};

const onTimeUpdate = () => {
    if (previewVideo.value && !playbackStore.isDragging) {
        if (previewVideo.value.readyState >= 1) {
            playbackStore.currentTime = previewVideo.value.currentTime;
        }
    }
};

// Sincroniza o slider local com o tempo da Store (se não estiver sendo arrastado)
watch(() => playbackStore.currentTime, (newVal) => {
    if (!playbackStore.isDragging) {
        sliderValue.value = newVal;
    }
});

const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
};

// ==========================================
// LÓGICA DE ARRASTO (SCRUBBING)
// ==========================================
const onDragStart = async () => {
    playbackStore.isDragging = true;
    playbackStore.isPlaying = false;
    if (previewVideo.value) previewVideo.value.pause();

    if (!playbackStore.isPreviewMode) {
        await emit('media-control', { action: 'pause' });
    }
};

const onDrag = async (val: number) => {
    if (!playbackStore.isDragging) return;
    playbackStore.currentTime = val;
    if (previewVideo.value) previewVideo.value.currentTime = val;

    if (!playbackStore.isPreviewMode) {
        await emit('media-control', { action: 'seek', time: val });
    }
};

const onDragEnd = async () => {
    playbackStore.isDragging = false;

    await emit('media-control', { action: 'pause' });
    await emit('media-control', { action: 'seek', time: sliderValue.value });

    setTimeout(async () => {
        if (previewVideo.value) previewVideo.value.play();
        playbackStore.isPlaying = true;
        await emit('media-control', { action: 'play' });
    }, 1000);
};

// ==========================================
// BOTÕES DE CONTROLE
// ==========================================
const togglePlay = async () => {
    playbackStore.isPlaying = !playbackStore.isPlaying;
    if (playbackStore.isPlaying) {
        if (previewVideo.value) previewVideo.value.play();
        await emit('media-control', { action: 'play' });
    } else {
        if (previewVideo.value) previewVideo.value.pause();
        await emit('media-control', { action: 'pause' });
    }
};

const restartMedia = async () => {
    playbackStore.currentTime = 0;
    sliderValue.value = 0;

    if (previewVideo.value) {
        previewVideo.value.currentTime = 0;
        previewVideo.value.play();
    }
    playbackStore.isPlaying = true;
    await emit('media-control', { action: 'restart' });
};

const toggleVolume = async () => {
    playbackStore.isMuted = !playbackStore.isMuted;
    await emit('media-control', { action: playbackStore.isMuted ? 'mute' : 'unmute' });
};

// ==========================================
// GESTÃO DE ESTADO E MEMÓRIA
// ==========================================
// Quando a mídia global muda, reseta a store.
watch(() => statusPresStore.projectedFile?.id, () => {
    playbackStore.resetMedia();
});

// Reatividade cruzada: Se a outra instância (ex: Toolbar) pausar, a Standalone pausa junto.
watch(() => playbackStore.isPlaying, (playing) => {
    if (previewVideo.value) {
        playing ? previewVideo.value.play() : previewVideo.value.pause();
    }
});

// REGISTRO DE VÍDEO & Pulo do Gato (Ao abrir o menu/aba)
watch(previewVideo, (newVideoElement, oldVideoElement) => {
    // Comunica a Store Global se o vídeo está ou não na tela
    if (newVideoElement && !oldVideoElement) playbackStore.registerVideo();
    if (!newVideoElement && oldVideoElement) playbackStore.unregisterVideo();

    if (newVideoElement) {
        if (playbackStore.currentTime > 0) {
            newVideoElement.currentTime = playbackStore.currentTime;
            sliderValue.value = playbackStore.currentTime;
        }
        if (!playbackStore.isPlaying) {
            newVideoElement.pause();
        }
    }
});

// Apenas garante que o relógio global está vivo assim que qualquer componente for montado
onMounted(() => {
    playbackStore.startGhostTimer();
    sliderValue.value = playbackStore.currentTime;
});

</script>

<template>
    <div class="d-flex align-center" v-if="props.isToolbar && statusPresStore.projectedFile?.id">

        <v-expand-x-transition>
            <div v-if="statusPresStore.projectedFile?.id" id="media-pill-activator"
                class="d-flex align-center bg-surface-variant rounded-pill pl-1 pr-1 py-1 mr-2 border shadow-sm"
                style="height: 36px; min-width: 120px; white-space: nowrap;">
                <div class="d-flex align-center justify-center flex-grow-1 px-3 h-100 cursor-pointer"
                    @click.stop="menuOpen = menuStore.menuOpened === 'Media' ? false : !menuOpen">
                    <template v-if="statusPresStore.projectedFile?.isVideo">
                        <v-icon size="x-small" class="mr-1 text-primary" style="pointer-events: none;">
                            mdi-clock-outline
                        </v-icon>
                        <span class="text-caption font-weight-bold text-primary" style="pointer-events: none;">
                            {{ formatTime(playbackStore.currentTime) }}
                        </span>
                    </template>

                    <template v-else>
                        <v-icon size="small" color="primary" style="pointer-events: none;">
                            mdi-image
                        </v-icon>
                    </template>
                </div>

                <v-divider vertical class="mx-1" style="height: 16px;"></v-divider>

                <div class="d-flex align-center px-1">
                    <template v-if="statusPresStore.projectedFile?.isVideo">
                        <v-btn :icon="playbackStore.isPlaying ? 'mdi-pause' : 'mdi-play'" size="x-small" variant="text"
                            color="medium-emphasis" @click.stop="togglePlay"></v-btn>

                        <v-btn icon="mdi-replay" size="x-small" variant="text" color="medium-emphasis"
                            @click.stop="restartMedia" title="Reiniciar vídeo"></v-btn>
                    </template>

                    <v-btn icon="mdi-stop" size="x-small" variant="text" color="error"
                        @click.stop="statusPresStore.clean"></v-btn>
                </div>
            </div>
        </v-expand-x-transition>

        <v-menu v-model="menuOpen" :close-on-content-click="false" location="bottom end"
            activator="#media-pill-activator" transition="slide-y-transition">
            <div style="width: 500px;" v-if="menuStore.menuOpened !== 'Media'" class="mt-3">
                <v-card class="border-md d-flex flex-column" style="border-color: rgb(var(--v-theme-error)) !important;"
                    elevation="4">
                    <div class="bg-error px-3 py-1 d-flex align-center text-white" style="height: 40px;">
                        <v-icon start size="small" class="blink-anim mr-2">mdi-record-circle-outline</v-icon>
                        <span class="text-caption font-weight-bold">AO VIVO NO TELÃO</span>
                        <v-spacer></v-spacer>
                        <v-btn-toggle v-if="statusPresStore.projectedFile?.isVideo"
                            v-model="playbackStore.isPreviewMode" mandatory density="compact" variant="outlined"
                            class="header-toggle">
                            <v-tooltip
                                text="Busca Oculta: O tempo arrastado aparece só no seu menu. A projeção pula ao soltar."
                                location="bottom">
                                <template v-slot:activator="{ props }">
                                    <v-btn v-bind="props" :value="true" size="small" class="px-2 text-caption">
                                        <v-icon size="small" class="mr-1">mdi-eye-outline</v-icon> Preview
                                    </v-btn>
                                </template>
                            </v-tooltip>
                            <v-tooltip text="Busca Ao Vivo: A projeção principal acompanha o seu mouse em tempo real."
                                location="bottom">
                                <template v-slot:activator="{ props }">
                                    <v-btn v-bind="props" :value="false" size="small" class="px-2 text-caption">
                                        <v-icon size="small" class="mr-1">mdi-broadcast</v-icon> Ao Vivo
                                    </v-btn>
                                </template>
                            </v-tooltip>
                        </v-btn-toggle>
                    </div>

                    <div class="pa-3 bg-surface-variant">
                        <div class="d-flex align-center mb-3">
                            <div class="preview-container mr-3 rounded border border-surface overflow-hidden flex-shrink-0 bg-black position-relative"
                                style="width: 120px; aspect-ratio: 16/9;">
                                <video v-if="statusPresStore.projectedFile?.isVideo && playbackStore.isPreviewMode"
                                    ref="previewVideo" :src="statusPresStore.projectedFile?.url"
                                    class="w-100 h-100 object-cover" muted autoplay @timeupdate="onTimeUpdate"
                                    @loadedmetadata="onLoadedMetadata">
                                </video>
                                <v-img v-else :src="statusPresStore.projectedFile?.url" cover class="w-100 h-100"
                                    :class="{ 'opacity-40': statusPresStore.projectedFile?.isVideo }">
                                    <div v-if="statusPresStore.projectedFile?.isVideo"
                                        class="d-flex align-center justify-center w-100 h-100 text-caption font-weight-bold text-white text-center"
                                        style="background: rgba(0,0,0,0.3)">
                                        MODO<br>AO VIVO
                                    </div>
                                </v-img>

                            </div>

                            <div class="flex-grow-1 overflow-hidden">
                                <div class="text-subtitle-2 font-weight-bold text-truncate mb-2"
                                    :title="statusPresStore.projectedFile?.name">
                                    {{ statusPresStore.projectedFile?.name }}
                                </div>
                                <div class="d-flex gap-2">
                                    <v-btn v-if="statusPresStore.projectedFile?.isVideo"
                                        :icon="playbackStore.isPlaying ? 'mdi-pause' : 'mdi-play'" size="small"
                                        variant="tonal" @click="togglePlay"
                                        :color="playbackStore.isPlaying ? 'primary' : 'default'"></v-btn>
                                    <v-btn v-if="statusPresStore.projectedFile?.isVideo" icon="mdi-replay" size="small"
                                        variant="tonal" @click="restartMedia" title="Reiniciar vídeo"></v-btn>
                                    <v-btn v-if="statusPresStore.projectedFile?.isVideo"
                                        :icon="playbackStore.isMuted ? 'mdi-volume-off' : 'mdi-volume-high'"
                                        size="small" variant="tonal" @click="toggleVolume"
                                        :color="playbackStore.isMuted ? 'error' : 'default'"></v-btn>
                                    <v-spacer></v-spacer>
                                    <v-btn size="small" color="error" variant="flat" icon="mdi-stop"
                                        @click="statusPresStore.clean" title="Parar Apresentação"></v-btn>
                                </div>
                            </div>
                        </div>

                        <v-expand-transition>
                            <div v-if="statusPresStore.projectedFile?.isVideo" class="mt-1 pb-1">
                                <div class="d-flex align-center px-1 mb-n2">
                                    <span class="text-caption font-weight-medium text-primary">{{
                                        formatTime(playbackStore.currentTime) }}</span>
                                    <v-spacer></v-spacer>
                                    <span class="text-caption text-medium-emphasis">{{
                                        formatTime(playbackStore.duration)
                                        }}</span>
                                </div>
                                <v-slider v-model="sliderValue" :max="playbackStore.duration" min="0" color="primary"
                                    hide-details class="media-slider" @start="onDragStart" @update:model-value="onDrag"
                                    @end="onDragEnd"></v-slider>
                            </div>
                        </v-expand-transition>
                    </div>
                </v-card>
            </div>
        </v-menu>
    </div>

    <v-card v-else-if="!props.isToolbar && statusPresStore.projectedFile?.id" class="border-md d-flex flex-column"
        style="border-color: rgb(var(--v-theme-error)) !important;" elevation="2">
        <div class="bg-error px-3 py-1 d-flex align-center text-white" style="height: 40px;">
            <v-icon start size="small" class="blink-anim mr-2">mdi-record-circle-outline</v-icon>
            <span class="text-caption font-weight-bold">AO VIVO NO TELÃO</span>
            <v-spacer></v-spacer>
            <v-btn-toggle v-if="statusPresStore.projectedFile.isVideo" v-model="playbackStore.isPreviewMode" mandatory
                density="compact" variant="outlined" class="header-toggle">
                <v-tooltip text="Busca Oculta: O tempo arrastado aparece só no seu menu." location="bottom">
                    <template v-slot:activator="{ props }">
                        <v-btn v-bind="props" :value="true" size="small" class="px-2 text-caption">
                            <v-icon size="small" class="mr-1">mdi-eye-outline</v-icon> Preview
                        </v-btn>
                    </template>
                </v-tooltip>
                <v-tooltip text="Busca Ao Vivo: A projeção principal acompanha o seu mouse em tempo real."
                    location="bottom">
                    <template v-slot:activator="{ props }">
                        <v-btn v-bind="props" :value="false" size="small" class="px-2 text-caption">
                            <v-icon size="small" class="mr-1">mdi-broadcast</v-icon> Ao Vivo
                        </v-btn>
                    </template>
                </v-tooltip>
            </v-btn-toggle>
        </div>

        <div class="pa-3 bg-surface-variant">
            <div class="d-flex align-center mb-3">
                <div class="preview-container mr-3 rounded border border-surface overflow-hidden flex-shrink-0 bg-black position-relative"
                    style="width: 120px; aspect-ratio: 16/9;">
                    <video v-if="statusPresStore.projectedFile.isVideo && playbackStore.isPreviewMode"
                        ref="previewVideo" :src="statusPresStore.projectedFile.url" class="w-100 h-100 object-cover"
                        muted autoplay @timeupdate="onTimeUpdate" @loadedmetadata="onLoadedMetadata">
                    </video>
                    <v-img v-else :src="statusPresStore.projectedFile.url" cover class="w-100 h-100"
                        :class="{ 'opacity-40': statusPresStore.projectedFile.isVideo }">
                        <div v-if="statusPresStore.projectedFile.isVideo"
                            class="d-flex align-center justify-center w-100 h-100 text-caption font-weight-bold text-white text-center"
                            style="background: rgba(0,0,0,0.3)">
                            MODO<br>AO VIVO
                        </div>
                    </v-img>
                </div>

                <div class="flex-grow-1 overflow-hidden">
                    <div class="text-subtitle-2 font-weight-bold text-truncate mb-2"
                        :title="statusPresStore.projectedFile.name">
                        {{ statusPresStore.projectedFile.name }}
                    </div>
                    <div class="d-flex gap-2">
                        <v-btn v-if="statusPresStore.projectedFile.isVideo"
                            :icon="playbackStore.isPlaying ? 'mdi-pause' : 'mdi-play'" size="small" variant="tonal"
                            @click="togglePlay" :color="playbackStore.isPlaying ? 'primary' : 'default'"></v-btn>
                        <v-btn v-if="statusPresStore.projectedFile.isVideo" icon="mdi-replay" size="small"
                            variant="tonal" @click="restartMedia" title="Reiniciar vídeo"></v-btn>
                        <v-btn v-if="statusPresStore.projectedFile.isVideo"
                            :icon="playbackStore.isMuted ? 'mdi-volume-off' : 'mdi-volume-high'" size="small"
                            variant="tonal" @click="toggleVolume"
                            :color="playbackStore.isMuted ? 'error' : 'default'"></v-btn>
                        <v-spacer></v-spacer>
                        <v-btn size="small" color="error" variant="flat" icon="mdi-stop" @click="statusPresStore.clean"
                            title="Parar Apresentação"></v-btn>
                    </div>
                </div>
            </div>

            <v-expand-transition>
                <div v-if="statusPresStore.projectedFile.isVideo" class="mt-1 pb-1">
                    <div class="d-flex align-center px-1 mb-n2">
                        <span class="text-caption font-weight-medium text-primary">{{
                            formatTime(playbackStore.currentTime) }}</span>
                        <v-spacer></v-spacer>
                        <span class="text-caption text-medium-emphasis">{{ formatTime(playbackStore.duration) }}</span>
                    </div>
                    <v-slider v-model="sliderValue" :max="playbackStore.duration" min="0" color="primary" hide-details
                        class="media-slider" @start="onDragStart" @update:model-value="onDrag"
                        @end="onDragEnd"></v-slider>
                </div>
            </v-expand-transition>
        </div>
    </v-card>
</template>

<style scoped>
.gap-2 {
    gap: 8px;
}

.object-cover {
    object-fit: cover;
}

.media-slider {
    margin-top: 0px !important;
}

.blink-anim {
    animation: blink-red 1.5s infinite;
}

@keyframes blink-red {
    0% {
        opacity: 1;
    }

    50% {
        opacity: 0.4;
    }

    100% {
        opacity: 1;
    }
}

.header-toggle {
    height: 26px !important;
    border-color: rgba(255, 255, 255, 0.4) !important;
    background-color: transparent !important;
}

.header-toggle :deep(.v-btn) {
    color: rgba(255, 255, 255, 0.7) !important;
    border-color: rgba(255, 255, 255, 0.4) !important;
}

.header-toggle :deep(.v-btn--active) {
    background-color: rgba(255, 255, 255, 0.2) !important;
    color: white !important;
    font-weight: bold;
}
</style>