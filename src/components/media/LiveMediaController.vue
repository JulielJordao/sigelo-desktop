<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue';
import { emit } from '@tauri-apps/api/event';
import { useStatusPresentationStore } from '../../stores/statusPresentationStore';
import { useMenuStore } from '../../stores/menuStore';
import { useMediaPlaybackStore } from '../../stores/mediaPlaybackStore';
import FFmpegVideo from '../../FFmpegVideo.vue'; // ajuste o path
import SmartVideo from '../SmartVideo.vue';

const props = defineProps({
    isToolbar: {
        type: Boolean,
        default: false
    }
});

const menuStore = useMenuStore();
const statusPresStore = useStatusPresentationStore();
const playbackStore = useMediaPlaybackStore();
const menuOpen = ref(false);

// ── Ref do FFmpegVideo de preview ──────────────────────────────────────────
// Quando o usuário abre o menu, este componente é montado e usa <ffmpeg-video>
// com `noAudio` para mostrar o preview SEM áudio (áudio toca só no telão).
const previewVideo = ref<InstanceType<typeof FFmpegVideo> | null>(null);

const sliderValue = ref(0);

// ── Resolve path para passar ao FFmpegVideo ───────────────────────────────
const previewSrc = computed(() => {
    const file = statusPresStore.projectedFile;
    if (!file?.url) return '';
    return file.url;
});

// ─────────────────────────────────────────────────────────────────────────
// SINCRONIZAÇÃO DE TEMPO
// ─────────────────────────────────────────────────────────────────────────
// O preview emite eventos como o <video> nativo (loadedmetadata, timeupdate,
// seeking, seeked). Usamos isso para atualizar a store sem hack de timer.

const onLoadedMetadata = (e: any) => {
    const target = e.target;
    if (target?.duration) {
        playbackStore.duration = target.duration;
    }
};

const onTimeUpdate = (e: any) => {
    const target = e.target;
    if (target && !playbackStore.isDragging) {
        playbackStore.currentTime = target.currentTime ?? 0;
    }
};

const onSeeked = () => {
    // Disparado quando o ffmpeg-video terminou o seek e mostrou o primeiro frame
    // (sem timeout fixo de 1s — usa o evento real)
    if (_pendingResumeAfterSeek) {
        _pendingResumeAfterSeek = false;
        _resumeAfterSeek();
    }
};

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

// ─────────────────────────────────────────────────────────────────────────
// SCRUBBING (arrastar slider)
// ─────────────────────────────────────────────────────────────────────────
let _pendingResumeAfterSeek = false;
let _wasPlayingBeforeDrag = false;

const onDragStart = async () => {
    playbackStore.isDragging = true;
    _wasPlayingBeforeDrag = playbackStore.isPlaying;

    // Pausa preview e telão durante o arrasto
    if (previewVideo.value) previewVideo.value.pause();
    if (!playbackStore.isPreviewMode) {
        await emit('media-control', { action: 'pause' });
    }
};

// ─── Throttle para emit de seek ao telão ───
// Em modo "Ao Vivo" o onDrag pode disparar 30-60 vezes/segundo. Enviar
// todos os eventos via IPC Tauri satura o canal e atrapalha o FFmpegVideo
// da outra janela. Throttle garante no máximo 1 emit a cada 120ms,
// sempre enviando o ÚLTIMO valor quando termina o período.
//
let _lastLiveSeekTime = 0
let _liveSeekThrottleTimer: ReturnType<typeof setTimeout> | null = null
let _pendingLiveSeekVal: number | null = null

async function _emitLiveSeek(val: number) {
    const now = performance.now()
    _pendingLiveSeekVal = val

    // Se está em cooldown, agenda o envio para quando terminar
    if (now - _lastLiveSeekTime < 120) {
        if (!_liveSeekThrottleTimer) {
            _liveSeekThrottleTimer = setTimeout(() => {
                _liveSeekThrottleTimer = null
                if (_pendingLiveSeekVal !== null && playbackStore.isDragging) {
                    _lastLiveSeekTime = performance.now()
                    const v = _pendingLiveSeekVal
                    _pendingLiveSeekVal = null
                    emit('media-control', { action: 'seek', time: v }).catch(() => { })
                }
            }, 120 - (now - _lastLiveSeekTime))
        }
        return
    }

    _lastLiveSeekTime = now
    _pendingLiveSeekVal = null
    await emit('media-control', { action: 'seek', time: val })
}

const onDrag = async (val: number) => {
    if (!playbackStore.isDragging) return;
    sliderValue.value = val;
    playbackStore.currentTime = val;

    // Preview local
    if (previewVideo.value) {
        try { previewVideo.value.currentTime = val; } catch { }
    }

    // Telão: envia via IPC. O FFmpegVideo da outra janela tem locked mode
    // que acumula seeks e executa apenas quando o pipeline estabiliza.
    // Throttle leve aqui apenas para não saturar o canal IPC.
    if (!playbackStore.isPreviewMode) {
        _emitLiveSeek(val)
    }
};

const _resumeAfterSeek = async () => {
    if (_wasPlayingBeforeDrag) {
        if (previewVideo.value) {
            try { await previewVideo.value.play(); } catch { }
        }
        playbackStore.isPlaying = true;
        await emit('media-control', { action: 'play' });
    }
};

const onDragEnd = async () => {
    playbackStore.isDragging = false;
    const finalTime = sliderValue.value;

    // Cancela throttle pendente e envia o valor FINAL imediatamente
    if (_liveSeekThrottleTimer) {
        clearTimeout(_liveSeekThrottleTimer)
        _liveSeekThrottleTimer = null
    }
    _pendingLiveSeekVal = null
    _lastLiveSeekTime = 0  // reseta para próximo arrasto

    // Envia seek FINAL (tanto em modo Preview quanto Ao Vivo)
    await emit('media-control', { action: 'seek', time: finalTime });

    // Aguarda o evento `seeked` do preview local para retomar.
    // Fallback de 2s caso algo trave.
    if (_wasPlayingBeforeDrag) {
        _pendingResumeAfterSeek = true;
        setTimeout(() => {
            if (_pendingResumeAfterSeek) {
                _pendingResumeAfterSeek = false;
                _resumeAfterSeek();
            }
        }, 2000);
    }
};

// ─────────────────────────────────────────────────────────────────────────
// BOTÕES
// ─────────────────────────────────────────────────────────────────────────
const togglePlay = async () => {
    playbackStore.isPlaying = !playbackStore.isPlaying;
    if (playbackStore.isPlaying) {
        if (previewVideo.value) {
            try { await previewVideo.value.play(); } catch { }
        }
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
        try {
            previewVideo.value.currentTime = 0;
            await previewVideo.value.play();
        } catch { }
    }
    playbackStore.isPlaying = true;
    await emit('media-control', { action: 'restart' });
};

const toggleVolume = async () => {
    playbackStore.isMuted = !playbackStore.isMuted;
    // Preview SEMPRE muted (áudio toca só no telão).
    // Apenas o telão recebe o comando real de volume.
    await emit('media-control', { action: playbackStore.isMuted ? 'mute' : 'unmute' });
};

// ─────────────────────────────────────────────────────────────────────────
// REATIVIDADE CRUZADA E REGISTROS
// ─────────────────────────────────────────────────────────────────────────
watch(() => statusPresStore.projectedFile?.id, () => {
    playbackStore.resetMedia();
    sliderValue.value = 0;
});

watch(() => playbackStore.isPlaying, async (playing) => {
    if (!previewVideo.value) return;
    try {
        if (playing) await previewVideo.value.play();
        else previewVideo.value.pause();
    } catch { }
});

watch(previewVideo, (newRef, oldRef) => {
    if (newRef && !oldRef) {
        playbackStore.registerVideo();
        // Sincroniza estado quando o preview é montado
        if (playbackStore.currentTime > 0) {
            try { newRef.currentTime = playbackStore.currentTime; } catch { }
            sliderValue.value = playbackStore.currentTime;
        }
        if (!playbackStore.isPlaying) {
            try { newRef.pause(); } catch { }
        }
    }
    if (!newRef && oldRef) {
        playbackStore.unregisterVideo();
    }
});

onMounted(() => {
    playbackStore.startGhostTimer();
    sliderValue.value = playbackStore.currentTime;
});
</script>

<template>
    <!-- ═══════════════ TOOLBAR (PILL) ═══════════════ -->
    <div class="d-flex align-center"
        v-if="props.isToolbar && statusPresStore.projectedFile?.id && statusPresStore.status.isPresentation === 'Media'">

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
                                <!-- ── Preview com FFmpegVideo (MESMA engine do telão) ── -->
                                <FFmpegVideo
                                    v-if="statusPresStore.projectedFile?.isVideo && playbackStore.isPreviewMode && previewSrc"
                                    ref="previewVideo" :src="previewSrc" autoplay muted no-audio object-fit="cover"
                                    class="w-100 h-100" @loadedmetadata="onLoadedMetadata" @timeupdate="onTimeUpdate"
                                    @seeked="onSeeked" />
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
                                    <span class="text-caption font-weight-medium text-primary">
                                        {{ formatTime(playbackStore.currentTime) }}
                                    </span>
                                    <v-spacer></v-spacer>
                                    <span class="text-caption text-medium-emphasis">
                                        {{ formatTime(playbackStore.duration) }}
                                    </span>
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

    <!-- ═══════════════ STANDALONE (CARD) ═══════════════ -->
    <v-card v-else-if="!props.isToolbar && statusPresStore.projectedFile?.id && statusPresStore.status.isPresentation === 'Media'"
        class="border-md d-flex flex-column" style="border-color: rgb(var(--v-theme-error)) !important;" elevation="2">
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
                    <FFmpegVideo
                        v-if="statusPresStore.projectedFile.isVideo && playbackStore.isPreviewMode && previewSrc"
                        ref="previewVideo" :src="previewSrc" autoplay muted no-audio object-fit="cover"
                        class="w-100 h-100" @loadedmetadata="onLoadedMetadata" @timeupdate="onTimeUpdate"
                        @seeked="onSeeked" />
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
                        <span class="text-caption font-weight-medium text-primary">
                            {{ formatTime(playbackStore.currentTime) }}
                        </span>
                        <v-spacer></v-spacer>
                        <span class="text-caption text-medium-emphasis">
                            {{ formatTime(playbackStore.duration) }}
                        </span>
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