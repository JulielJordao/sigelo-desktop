<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useStatusPresentationStore } from '../../stores/statusPresentationStore';
import { useMenuStore } from '../../stores/menuStore';
import { useMediaPlaybackStore } from '../../stores/mediaPlaybackStore';
import SmartVideo from '../SmartVideo.vue'; // ajuste o path

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

// ═════════════════════════════════════════════════════════════════════════
// REF DO PREVIEW
// ─────────────────────────────────────────────────────────────────────────
// Usamos tipo genérico `any` para aceitar tanto SmartVideo quanto FFmpegVideo
// (mesma API pública). Se preferir tipar estrito, troque para:
//   ref<InstanceType<typeof SmartVideo> | null>(null)
// ═════════════════════════════════════════════════════════════════════════
const previewVideo = ref<any>(null);

const sliderValue = ref(0);

const previewSrc = computed(() => {
    const file = statusPresStore.projectedFile;
    if (!file?.url) return '';
    return file.url;
});

// ═════════════════════════════════════════════════════════════════════════
// SINCRONIZAÇÃO DE TEMPO — preview local + tempo fantasma
// ─────────────────────────────────────────────────────────────────────────
// Cenários:
//
// 1. MENU ABERTO + modo Ao Vivo/Preview: <SmartVideo> monta, emite
//    timeupdate → sobrescreve playbackStore.currentTime.
//
// 2. MENU FECHADO: só existe o pill da toolbar mostrando o tempo.
//    O preview NÃO está montado → timeupdate não é emitido.
//    O "ghost timer" (no store) avança o tempo local baseado no wall clock.
//    Quando o menu reabre, o preview seek para esse tempo.
//
// O ghost timer é controlado por `playbackStore.startGhostTimer()` e
// é PAUSADO automaticamente quando o preview está vivo emitindo timeupdate
// (ver watchdog abaixo).
// ═════════════════════════════════════════════════════════════════════════

let _lastTimeUpdateAt = 0;
let _lastAcceptedTime = -1; // último tempo aceito (para detectar regressões falsas)
let _ghostWatchdog: ReturnType<typeof setInterval> | null = null;

const onLoadedMetadata = (e: any) => {
    const target = e.target;
    const dur = target?.duration?.value ?? target?.duration;
    if (dur && isFinite(dur) && dur > 0) {
        playbackStore.duration = dur;
    }
};

const onTimeUpdate = (e: any) => {
    const target = e.target;
    // Lê currentTime de SmartVideo (computed ref) ou <video> nativo (number)
    const rawCt = target?.currentTime;
    const ct: number = (rawCt && typeof rawCt === 'object' && 'value' in rawCt)
        ? rawCt.value
        : (rawCt ?? -1);

    // Descarta zeros — emitidos durante load/seek/buffering do <video> nativo
    if (!isFinite(ct) || ct <= 0) return;

    // Descarta regressões grandes (> 2s para trás) que não foram seek explícito
    // — evita o efeito de vai-e-volta quando o nativo emite frames antigos
    if (_lastAcceptedTime > 0 && ct < _lastAcceptedTime - 2) return;

    _lastTimeUpdateAt = performance.now();
    _lastAcceptedTime = ct;

    if (!playbackStore.isDragging) {
        playbackStore.currentTime = ct;
    }
};

const onSeeked = () => {
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

// ═════════════════════════════════════════════════════════════════════════
// TEMPO FANTASMA (GHOST TIMER)
// ─────────────────────────────────────────────────────────────────────────
// Quando o preview NÃO está montado mas o vídeo do telão está rodando,
// precisamos atualizar o tempo localmente via wall clock.
//
// Lógica:
//   - Se `playbackStore.isPlaying === true` e `_lastTimeUpdateAt` foi há
//     mais de 500ms (preview não está emitindo timeupdate) → avança o
//     tempo localmente a cada 250ms.
//   - Se o preview estiver emitindo timeupdate, o watchdog não faz nada
//     (o onTimeUpdate já atualiza o tempo com valor real).
//   - Loop back ao fim da duração.
// ═════════════════════════════════════════════════════════════════════════

function _startGhostWatchdog() {
    if (_ghostWatchdog) return;
    _ghostWatchdog = setInterval(() => {
        if (!playbackStore.isPlaying) return;
        if (playbackStore.isDragging) return;

        const sincePreview = performance.now() - _lastTimeUpdateAt;
        // Só atua se preview não emitiu timeupdate válido nos últimos 600ms
        if (sincePreview < 600) return;

        // Não avança a partir de zero — espera pelo menos um tempo real chegar
        const current = playbackStore.currentTime;
        if (current <= 0) return;

        const delta = 0.25;
        let next = current + delta;

        if (playbackStore.duration > 0 && next >= playbackStore.duration) {
            next = next % playbackStore.duration;
        }
        playbackStore.currentTime = next;
    }, 250);
}

function _stopGhostWatchdog() {
    if (_ghostWatchdog) {
        clearInterval(_ghostWatchdog);
        _ghostWatchdog = null;
    }
}

// ═════════════════════════════════════════════════════════════════════════
// SCRUBBING (arrastar slider)
// ═════════════════════════════════════════════════════════════════════════

let _pendingResumeAfterSeek = false;
let _wasPlayingBeforeDrag = false;

const onDragStart = async () => {
    playbackStore.isDragging = true;
    _wasPlayingBeforeDrag = playbackStore.isPlaying;

    if (previewVideo.value) previewVideo.value.pause();
    if (!playbackStore.isPreviewMode) {
        await emit('media-control', { action: 'pause' });
    }
};

// ─── Throttle para emit de seek ao telão ───
let _lastLiveSeekTime = 0;
let _liveSeekThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingLiveSeekVal: number | null = null;

async function _emitLiveSeek(val: number) {
    const now = performance.now();
    _pendingLiveSeekVal = val;

    if (now - _lastLiveSeekTime < 120) {
        if (!_liveSeekThrottleTimer) {
            _liveSeekThrottleTimer = setTimeout(() => {
                _liveSeekThrottleTimer = null;
                if (_pendingLiveSeekVal !== null && playbackStore.isDragging) {
                    _lastLiveSeekTime = performance.now();
                    const v = _pendingLiveSeekVal;
                    _pendingLiveSeekVal = null;
                    emit('media-control', { action: 'seek', time: v }).catch(() => { });
                }
            }, 120 - (now - _lastLiveSeekTime));
        }
        return;
    }

    _lastLiveSeekTime = now;
    _pendingLiveSeekVal = null;
    await emit('media-control', { action: 'seek', time: val });
}

const onDrag = async (val: number) => {
    if (!playbackStore.isDragging) return;
    sliderValue.value = val;
    playbackStore.currentTime = val;

    // Preview local — funciona igual em FFmpegVideo e SmartVideo (computed writable)
    if (previewVideo.value) {
        try { previewVideo.value.currentTime = val; } catch { }
    }

    if (!playbackStore.isPreviewMode) {
        _emitLiveSeek(val);
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

    if (_liveSeekThrottleTimer) {
        clearTimeout(_liveSeekThrottleTimer);
        _liveSeekThrottleTimer = null;
    }
    _pendingLiveSeekVal = null;
    _lastLiveSeekTime = 0;

    // Aceita o novo tempo após seek (sem restrição de regressão)
    _lastAcceptedTime = finalTime;

    // Ativa sincronização pós-seek: quando o primeiro projection-time-sync
    // chegar com o tempo real da projeção, ajustamos o preview.
    // Timeout de segurança: se não chegar sync em 3s, cancela.
    _pendingPostSeekSync = true;
    if (_postSeekSyncTimeout) clearTimeout(_postSeekSyncTimeout);
    _postSeekSyncTimeout = setTimeout(() => {
        _pendingPostSeekSync = false;
        _postSeekSyncTimeout = null;
    }, 3000);

    await emit('media-control', { action: 'seek', time: finalTime });

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

// ═════════════════════════════════════════════════════════════════════════
// BOTÕES
// ═════════════════════════════════════════════════════════════════════════

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
    await emit('media-control', { action: playbackStore.isMuted ? 'mute' : 'unmute' });
};

// ═════════════════════════════════════════════════════════════════════════
// SINCRONIZAÇÃO DE TEMPO — recebe da ProjectionWindow via emitTo('main')
// ─────────────────────────────────────────────────────────────────────────
// A ProjectionWindow faz emitTo('main', 'projection-time-sync', ...) a cada
// 1s. Como usa emitTo específico, NÃO volta para a ProjectionWindow (sem loop).
//
// SINCRONIZAÇÃO PÓS-SEEK:
// Dois <video> independentes fazem seek para keyframes diferentes, podendo
// ficar até 4s dessincronizados. A projeção é a fonte da verdade.
// Após um seek, quando o primeiro projection-time-sync chegar com o tempo
// real da projeção, ajustamos o preview para esse tempo.
// ═════════════════════════════════════════════════════════════════════════

let _unlistenSync: UnlistenFn | null = null;
let _pendingPostSeekSync = false   // aguardando o tempo real da projeção pós-seek
let _postSeekSyncTimeout: ReturnType<typeof setTimeout> | null = null

async function _startSyncListener() {
    try {
        _unlistenSync = await listen<{ currentTime: number; duration?: number }>(
            'projection-time-sync',
            (event) => {
                if (playbackStore.isDragging) return;

                const { currentTime, duration } = event.payload;

                if (typeof currentTime !== 'number' || !isFinite(currentTime) || currentTime <= 0) return;
                if (_lastAcceptedTime > 0 && currentTime < _lastAcceptedTime - 2) return;

                // ── Sincronização pós-seek ────────────────────────────────
                // Se acabou de fazer seek e o preview está em modo nativo,
                // ajusta o preview para o tempo REAL da projeção (não o pedido).
                if (_pendingPostSeekSync && previewVideo.value) {
                    const previewCt = _getPreviewCurrentTime()
                    const diff = Math.abs(previewCt - currentTime)

                    if (diff > 0.3) {
                        // Preview está dessincronizado — corrige silenciosamente
                        try { previewVideo.value.seek
                            ? previewVideo.value.seek(currentTime)
                            : (previewVideo.value.currentTime = currentTime)
                        } catch {}
                    }
                    _pendingPostSeekSync = false
                    if (_postSeekSyncTimeout) { clearTimeout(_postSeekSyncTimeout); _postSeekSyncTimeout = null }
                }

                // Se preview está vivo e já está sincronizado, não sobrescreve
                // (deixa o timeupdate local ser mais preciso)
                if (performance.now() - _lastTimeUpdateAt < 800) {
                    // Mesmo assim atualiza duration se necessário
                    if (duration && duration > 0) playbackStore.duration = duration;
                    return;
                }

                playbackStore.currentTime = currentTime;
                _lastAcceptedTime = currentTime;
                _lastTimeUpdateAt = performance.now();

                if (duration && duration > 0) {
                    playbackStore.duration = duration;
                }
            }
        );
    } catch (e) {
        console.warn('[LiveMediaController] sync listener falhou:', e);
    }
}

// Lê o currentTime atual do preview de forma segura (ComputedRef ou number)
function _getPreviewCurrentTime(): number {
    if (!previewVideo.value) return 0
    const raw = previewVideo.value.currentTime
    if (raw && typeof raw === 'object' && 'value' in raw) return raw.value ?? 0
    return raw ?? 0
}

function _stopRustPoll() {} // mantido por compatibilidade

// ═════════════════════════════════════════════════════════════════════════
// REATIVIDADE CRUZADA E REGISTROS
// ═════════════════════════════════════════════════════════════════════════

watch(() => statusPresStore.projectedFile?.id, () => {
    playbackStore.resetMedia();
    sliderValue.value = 0;
    _lastTimeUpdateAt = 0;
    _lastAcceptedTime = -1;
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
        // Preview desmontou — reseta timer para ghost assumir
        _lastTimeUpdateAt = 0;
    }
});

// ═════════════════════════════════════════════════════════════════════════
// CICLO DE VIDA
// ═════════════════════════════════════════════════════════════════════════

onMounted(() => {
    playbackStore.startGhostTimer();
    sliderValue.value = playbackStore.currentTime;
    _startGhostWatchdog();
    _startSyncListener();
});

onUnmounted(() => {
    _stopGhostWatchdog();
    _stopRustPoll();
    if (_liveSeekThrottleTimer) {
        clearTimeout(_liveSeekThrottleTimer);
        _liveSeekThrottleTimer = null;
    }
    if (_postSeekSyncTimeout) {
        clearTimeout(_postSeekSyncTimeout);
        _postSeekSyncTimeout = null;
    }
    if (_unlistenSync) {
        _unlistenSync();
        _unlistenSync = null;
    }
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
                                <!-- ── Preview com SmartVideo (mesma engine do telão) ── -->
                                <SmartVideo
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
    <v-card
        v-else-if="!props.isToolbar && statusPresStore.projectedFile?.id && statusPresStore.status.isPresentation === 'Media'"
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
                    <SmartVideo
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
    0% { opacity: 1; }
    50% { opacity: 0.4; }
    100% { opacity: 1; }
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