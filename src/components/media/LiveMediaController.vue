<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed, nextTick } from 'vue';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useStatusPresentationStore } from '../../stores/statusPresentationStore';
import { useMenuStore } from '../../stores/menuStore';
import { useMediaPlaybackStore } from '../../stores/mediaPlaybackStore';
import SmartVideo from '../SmartVideo.vue';

const props = defineProps({
    isToolbar: { type: Boolean, default: false }
});

const menuStore = useMenuStore();
const statusPresStore = useStatusPresentationStore();
const playbackStore = useMediaPlaybackStore();
const menuOpen = ref(false);

// ═════════════════════════════════════════════════════════════════════════
// ARQUITETURA
// ─────────────────────────────────────────────────────────────────────────
// A ProjectionWindow é a ÚNICA fonte de verdade. Todo estado de playback
// (currentTime, isPlaying, duration, ended) vem do evento
// `projection-time-sync`, que traz:
//
//   { eventType, currentTime, duration, isPlaying }
//
// onde eventType ∈ {tick, play, pause, seeked, ended, loadedmetadata}.
//
// O preview local <SmartVideo> é puramente decorativo: ele SEGUE o store
// via watch, mas NUNCA escreve nele.
//
// Comandos (play/pause/seek) são enviados via `media-control` e o UI
// aguarda confirmação do telão antes de atualizar isPlaying/currentTime.
// Durante a espera, `isPendingStateChange=true` e o botão mostra loading.
// ═════════════════════════════════════════════════════════════════════════

const previewVideo = ref<any>(null);
const sliderValue = ref(0);

const previewSrc = computed(() => statusPresStore.projectedFile?.url || '');

// ─── Último valor aceito (para rejeitar regressões em ticks) ─────────
let _lastAcceptedTime = 0;
let _lastSyncAt = 0;

// ─── Timeout de segurança para comandos não confirmados ──────────────
let _pendingStateTimeout: ReturnType<typeof setTimeout> | null = null;

function _armPendingTimeout(ms = 2500) {
    if (_pendingStateTimeout) clearTimeout(_pendingStateTimeout);
    playbackStore.isPendingStateChange = true;
    _pendingStateTimeout = setTimeout(() => {
        playbackStore.isPendingStateChange = false;
        _pendingStateTimeout = null;
    }, ms);
}

function _clearPendingTimeout() {
    if (_pendingStateTimeout) {
        clearTimeout(_pendingStateTimeout);
        _pendingStateTimeout = null;
    }
    playbackStore.isPendingStateChange = false;
}

// ═════════════════════════════════════════════════════════════════════════
// LISTENER DO SYNC — único ponto de escrita no store
// ═════════════════════════════════════════════════════════════════════════

type SyncEventType = 'tick' | 'play' | 'pause' | 'seeked' | 'ended' | 'loadedmetadata';

interface SyncPayload {
    eventType: SyncEventType;
    currentTime: number;
    duration?: number;
    isPlaying: boolean;
}

let _unlistenSync: UnlistenFn | null = null;

async function _startSyncListener() {
    try {
        _unlistenSync = await listen<SyncPayload>('projection-time-sync', (event) => {
            const { eventType, currentTime, duration, isPlaying } = event.payload;
            console.log('[SYNC RX]', {
                eventType,
                currentTime,
                isPlaying,
                storeBefore: playbackStore.currentTime,
                sliderBefore: sliderValue.value
            });

            // Validação básica
            if (typeof currentTime !== 'number' || !isFinite(currentTime) || currentTime < 0) return;

            // Atualiza duration sempre que vier um valor válido
            if (duration && isFinite(duration) && duration > 0) {
                playbackStore.duration = duration;
            }

            // ─────────────────────────────────────────────────────────
            // REGRA DE ACEITAÇÃO
            // ─────────────────────────────────────────────────────────
            // Eventos (play/pause/seeked/ended/loadedmetadata) são sempre
            // aceitos — são fatos confirmados pelo telão.
            //
            // Ticks são rejeitados se vierem com regressão > 0.1s
            // (protege contra pacotes atrasados fora de ordem).
            //
            // Exceção: 00:00 inicial é legítimo quando _lastAcceptedTime
            // também é ~0 (vídeo acabou de carregar).
            // ─────────────────────────────────────────────────────────
            const isTick = eventType === 'tick';
            if (isTick && currentTime < _lastAcceptedTime - 0.1) {
                return; // tick atrasado, descarta
            }

            // Se é um evento que indica estado de playback, atualiza isPlaying
            if (eventType === 'play' || eventType === 'pause' || eventType === 'ended') {
                playbackStore.isPlaying = isPlaying;
                _clearPendingTimeout();
            }

            // seeked confirma o comando de seek — libera pending
            if (eventType === 'seeked') {
                _clearPendingTimeout();
            }

            // Ao receber loadedmetadata, sincroniza flag de reprodução real
            if (eventType === 'loadedmetadata') {
                playbackStore.isPlaying = isPlaying;
            }

            // Atualiza tempo
            if (!playbackStore.isDragging) {
                playbackStore.currentTime = currentTime;
            }

            _lastAcceptedTime = currentTime;
            _lastSyncAt = performance.now();
            console.log('[SYNC END]', {
                storeAfter: playbackStore.currentTime,
                sliderAfter: sliderValue.value
            });
        });
    } catch (e) {
        console.warn('[LiveMediaController] sync listener falhou:', e);
    }
}

// ═════════════════════════════════════════════════════════════════════════
// GHOST TIMER VISUAL — suaviza slider entre ticks
// ─────────────────────────────────────────────────────────────────────────
// Nunca toca no store. Apenas avança sliderValue visualmente se faz mais
// de 200ms que não chega sync (ex: menu fechado, aba inativa momentânea).
// O próximo tick/evento do telão corrige instantaneamente se necessário.
// ═════════════════════════════════════════════════════════════════════════

let _visualGhostTimer: ReturnType<typeof setInterval> | null = null;

function _startVisualGhost() {
    if (_visualGhostTimer) return;
    _visualGhostTimer = setInterval(() => {
        if (!playbackStore.isPlaying) return;
        if (playbackStore.isDragging) return;
        if (performance.now() - _lastSyncAt < 200) return; // sync recente

        const max = playbackStore.duration || Infinity;
        const next = Math.min(sliderValue.value + 0.1, max);
        if (next !== sliderValue.value) sliderValue.value = next;
    }, 100);
}

function _stopVisualGhost() {
    if (_visualGhostTimer) {
        clearInterval(_visualGhostTimer);
        _visualGhostTimer = null;
    }
}

// ═════════════════════════════════════════════════════════════════════════
// SYNC slider ← store
// ─────────────────────────────────────────────────────────────────────────
// Sempre que o store atualiza currentTime (via sync do telão), reflete
// no slider — exceto durante drag.
// ═════════════════════════════════════════════════════════════════════════

watch(() => playbackStore.currentTime, (t) => {
    if (playbackStore.isDragging) return;
    sliderValue.value = t;
});

// ═════════════════════════════════════════════════════════════════════════
// SYNC preview local ← store
// ─────────────────────────────────────────────────────────────────────────
// Preview local é decorativo. Segue o store com tolerância de 0.5s
// (evita puxar a cada frame — o <video> local já avança por conta própria).
// ═════════════════════════════════════════════════════════════════════════

watch(() => playbackStore.currentTime, (t) => {
    if (!previewVideo.value) return;
    if (!playbackStore.isPreviewMode) return;
    if (playbackStore.isDragging) return;

    const previewCt = _getPreviewCurrentTime();
    if (Math.abs(previewCt - t) > 0.5) {
        try { previewVideo.value.currentTime = t; } catch { }
    }
});

watch(previewVideo, async (newRef) => {
    if (!newRef) return;

    // Espera o SmartVideo montar internamente (pode ter resolvedEngine null por 1 tick)
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 50));

    // 1. Sincroniza tempo
    if (playbackStore.currentTime > 0) {
        try {
            newRef.currentTime = playbackStore.currentTime;
        } catch { }
    }

    // 2. Sincroniza estado de play/pause IMPERATIVAMENTE
    //    (não confia em autoplay, que é frágil para motor nativo)
    try {
        if (playbackStore.isPlaying && playbackStore.isPreviewMode) {
            await newRef.play();
        } else {
            newRef.pause();
        }
    } catch { }
});

watch(() => playbackStore.isPlaying, async (playing) => {
    if (!previewVideo.value) return;
    if (!playbackStore.isPreviewMode) {
        previewVideo.value.pause();
        return;
    }
    try {
        if (playing) {
            await previewVideo.value.play();
        } else {
            previewVideo.value.pause();
        }
    } catch { }
});

watch(() => playbackStore.isPreviewMode, async (isPreview) => {
    if (!previewVideo.value) return;

    try {
        if (!isPreview) {
            previewVideo.value.pause();
        } else if (playbackStore.isPlaying) {
            await previewVideo.value.play();
        }
    } catch { }
});

// ═════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════

function _getPreviewCurrentTime(): number {
    if (!previewVideo.value) return 0;
    const raw = previewVideo.value.currentTime;
    if (raw && typeof raw === 'object' && 'value' in raw) return raw.value ?? 0;
    return raw ?? 0;
}

const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
};

// ═════════════════════════════════════════════════════════════════════════
// SCRUBBING
// ═════════════════════════════════════════════════════════════════════════

let _wasPlayingBeforeDrag = false;
let _lastLiveSeekTime = 0;
let _liveSeekThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingLiveSeekVal: number | null = null;

const onDragStart = async () => {
    playbackStore.isDragging = true;
    _wasPlayingBeforeDrag = playbackStore.isPlaying;

    // Pausa ambos enquanto o usuário arrasta (telão e preview)
    if (previewVideo.value) previewVideo.value.pause();
    await emit('media-control', { action: 'pause' });
};

async function _emitLiveSeek(val: number) {
    if (!Number.isFinite(val)) return;
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
    if (!Number.isFinite(val)) return;

    sliderValue.value = val;

    // Atualiza preview local otimisticamente (resposta imediata ao arrasto)
    if (previewVideo.value && playbackStore.isPreviewMode) {
        try { previewVideo.value.currentTime = val; } catch { }
    }

    // Em modo Ao Vivo, transmite seek para o telão com throttle
    if (!playbackStore.isPreviewMode) {
        _emitLiveSeek(val);
    }
};

const onDragEnd = async () => {
    const finalTime = sliderValue.value;
    playbackStore.isDragging = false;

    if (_liveSeekThrottleTimer) {
        clearTimeout(_liveSeekThrottleTimer);
        _liveSeekThrottleTimer = null;
    }
    _pendingLiveSeekVal = null;
    _lastLiveSeekTime = 0;

    _armPendingTimeout(3000);
    await emit('media-control', { action: 'seek', time: finalTime });

    // Se estava tocando, pede para retomar. O telão vai confirmar via evento 'play'.
    if (_wasPlayingBeforeDrag) {
        // Pequeno delay para garantir que o seek processou primeiro
        setTimeout(() => {
            emit('media-control', { action: 'play', time: finalTime }).catch(() => { });
        }, 100);
    }
};

// ═════════════════════════════════════════════════════════════════════════
// BOTÕES — todos esperam confirmação do telão
// ═════════════════════════════════════════════════════════════════════════

const togglePlay = async () => {
    if (playbackStore.isPendingStateChange) return; // evita double-click
    const targetPlaying = !playbackStore.isPlaying;
    const ct = playbackStore.currentTime || 0;

    _armPendingTimeout();
    await emit('media-control', {
        action: targetPlaying ? 'play' : 'pause',
        time: ct
    });
    // O listener de sync atualiza isPlaying quando o telão confirmar
};

const restartMedia = async () => {
    if (playbackStore.isPendingStateChange) return;
    _armPendingTimeout(3000);
    // Zera slider otimisticamente para feedback imediato
    sliderValue.value = 0;
    _lastAcceptedTime = 0;
    await emit('media-control', { action: 'restart', time: 0 });
    // Telão vai emitir seeked(0) e depois play — o listener cuida do resto
};

const toggleVolume = async () => {
    playbackStore.isMuted = !playbackStore.isMuted;
    const ct = playbackStore.currentTime || 0;
    await emit('media-control', {
        action: playbackStore.isMuted ? 'mute' : 'unmute',
        time: ct
    });
};

// ═════════════════════════════════════════════════════════════════════════
// TROCA DE ARQUIVO
// ═════════════════════════════════════════════════════════════════════════

watch(() => statusPresStore.projectedFile?.id, (newId, oldId) => {
    console.log('[PROJECTED FILE CHANGED]', { newId, oldId });
    playbackStore.resetMedia();
    sliderValue.value = 0;
    _lastAcceptedTime = 0;
    _lastSyncAt = 0;
    _clearPendingTimeout();
});

// ═════════════════════════════════════════════════════════════════════════
// CICLO DE VIDA
// ═════════════════════════════════════════════════════════════════════════

onMounted(() => {
    sliderValue.value = playbackStore.currentTime;
    _startSyncListener();
    _startVisualGhost();
});

onUnmounted(() => {
    _stopVisualGhost();
    _clearPendingTimeout();
    if (_liveSeekThrottleTimer) {
        clearTimeout(_liveSeekThrottleTimer);
        _liveSeekThrottleTimer = null;
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
                        <v-btn :icon="playbackStore.isPlaying ? 'mdi-pause' : 'mdi-play'"
                            :loading="playbackStore.isPendingStateChange"
                            size="x-small" variant="text"
                            color="medium-emphasis" @click.stop="togglePlay"></v-btn>
                        <v-btn icon="mdi-replay" size="x-small" variant="text" color="medium-emphasis"
                            :disabled="playbackStore.isPendingStateChange"
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

                                <SmartVideo v-if="statusPresStore.projectedFile?.isVideo && previewSrc"
                                    ref="previewVideo" :src="previewSrc" :autoplay="playbackStore.isPreviewMode" muted
                                    no-audio object-fit="cover" class="w-100 h-100 transition-opacity"
                                    :style="{ opacity: !playbackStore.isPreviewMode ? '0.4' : '1' }" />

                                <v-img v-else-if="!statusPresStore.projectedFile?.isVideo"
                                    :src="statusPresStore.projectedFile?.url" cover class="w-100 h-100" />

                                <div v-if="statusPresStore.projectedFile?.isVideo && !playbackStore.isPreviewMode"
                                    class="position-absolute d-flex align-center justify-center text-white text-center"
                                    style="inset: 0; background: rgba(0,0,0,0.4); z-index: 10; pointer-events: none;">
                                    <div class="d-flex flex-column align-center">
                                        <v-icon size="small" color="white" class="mb-1">mdi-broadcast</v-icon>
                                        <span class="text-caption font-weight-bold"
                                            style="line-height: 1.1; letter-spacing: 0.5px;">
                                            MODO<br>AO VIVO
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div class="flex-grow-1 overflow-hidden">
                                <div class="text-subtitle-2 font-weight-bold text-truncate mb-2"
                                    :title="statusPresStore.projectedFile?.name">
                                    {{ statusPresStore.projectedFile?.name }}
                                </div>
                                <div class="d-flex gap-2">
                                    <v-btn v-if="statusPresStore.projectedFile?.isVideo"
                                        :icon="playbackStore.isPlaying ? 'mdi-pause' : 'mdi-play'"
                                        :loading="playbackStore.isPendingStateChange"
                                        size="small" variant="tonal" @click="togglePlay"
                                        :color="playbackStore.isPlaying ? 'primary' : 'default'"></v-btn>
                                    <v-btn v-if="statusPresStore.projectedFile?.isVideo" icon="mdi-replay" size="small"
                                        variant="tonal" @click="restartMedia"
                                        :disabled="playbackStore.isPendingStateChange"
                                        title="Reiniciar vídeo"></v-btn>
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
                    <SmartVideo v-if="statusPresStore.projectedFile?.isVideo && previewSrc" ref="previewVideo"
                        :src="previewSrc" :autoplay="playbackStore.isPreviewMode" muted no-audio object-fit="cover"
                        class="w-100 h-100 transition-opacity"
                        :style="{ opacity: !playbackStore.isPreviewMode ? '0.4' : '1' }" />

                    <v-img v-else-if="!statusPresStore.projectedFile?.isVideo" :src="statusPresStore.projectedFile?.url"
                        cover class="w-100 h-100" />

                    <div v-if="statusPresStore.projectedFile?.isVideo && !playbackStore.isPreviewMode"
                        class="position-absolute d-flex align-center justify-center text-white text-center"
                        style="inset: 0; background: rgba(0,0,0,0.4); z-index: 10; pointer-events: none;">
                        <div class="d-flex flex-column align-center">
                            <v-icon size="small" color="white" class="mb-1">mdi-broadcast</v-icon>
                            <span class="text-caption font-weight-bold"
                                style="line-height: 1.1; letter-spacing: 0.5px;">
                                MODO<br>AO VIVO
                            </span>
                        </div>
                    </div>
                </div>

                <div class="flex-grow-1 overflow-hidden">
                    <div class="text-subtitle-2 font-weight-bold text-truncate mb-2"
                        :title="statusPresStore.projectedFile.name">
                        {{ statusPresStore.projectedFile.name }}
                    </div>
                    <div class="d-flex gap-2">
                        <v-btn v-if="statusPresStore.projectedFile.isVideo"
                            :icon="playbackStore.isPlaying ? 'mdi-pause' : 'mdi-play'"
                            :loading="playbackStore.isPendingStateChange"
                            size="small" variant="tonal" @click="togglePlay"
                            :color="playbackStore.isPlaying ? 'primary' : 'default'"></v-btn>
                        <v-btn v-if="statusPresStore.projectedFile.isVideo" icon="mdi-replay" size="small"
                            variant="tonal" @click="restartMedia"
                            :disabled="playbackStore.isPendingStateChange"
                            title="Reiniciar vídeo"></v-btn>
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
.gap-2 { gap: 8px; }
.object-cover { object-fit: cover; }
.media-slider { margin-top: 0px !important; }
.blink-anim { animation: blink-red 1.5s infinite; }

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