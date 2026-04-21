<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useMediaStore } from '../stores/mediaStore';
import { useNoticeStore } from '../stores/noticeStore';
import type { MediaFile } from '../stores/mediaStore';
import { useTimerStore } from '../stores/timerStore';

import { useConfigStore } from '../stores/useConfigStore';

const isDev = import.meta.env.DEV;

// Apenas leitura
const noticeStore = useNoticeStore()
noticeStore.enableAutoSave = false;

const configStore = useConfigStore();

const mediaStore = useMediaStore();

const timerStore = useTimerStore();
timerStore.enableAutoSave = false;

interface MediaControlPayload {
    action: 'play' | 'pause' | 'mute' | 'unmute' | 'restart' | 'seek';
    time: number
}

interface ScrollPayload { x: number; y: number; }

const projectionType = ref<'html' | 'slide' | 'media' | 'timer' | 'fixed' | 'none'>('none');

const htmlContent = ref<string>('<div style="color: white; display: flex; height: 100vh; align-items: center; justify-content: center;">Aguardando projeção...</div>');
const slideData = ref<any>(null);

const currentMedia = ref<MediaFile | null>(null);

const debugLog = ref<string>("Iniciando...");

// *** NOVO: Guarda o último dado do Rust para o setInterval não atrapalhar ***
const lastBackendData = ref<string>('');

let unlistenUpdate: UnlistenFn | null = null;
let unlistenScroll: UnlistenFn | null = null;
let unlistenMedia: UnlistenFn | null = null;
let unlistenFixed: UnlistenFn | null = null;
let unlistenClear: UnlistenFn | null = null;
let unlistenMediaControl: UnlistenFn | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;

// Listening de Avisos
let unlistenNoticeSettings: UnlistenFn | null = null;
let unlistenNoticePlayback: UnlistenFn | null = null;

// Listening do Timer
let unlistenTimerSettings: UnlistenFn | null = null;
let unlistenTimerPlayback: UnlistenFn | null = null;
let localTimerInterval: ReturnType<typeof setInterval> | null = null;

// let unlistenRemoveFixed: UnlistenFn | null = null;

const videoRef = ref<HTMLVideoElement | null>(null);

// Agora aceita um 'force'. Se for o setInterval, force = false. Se for o clique do botão, force = true.
const processIncomingData = (data: string, force: boolean = false) => {
    if (!data || data.trim() === '') return;

    // Se o dado for igual ao último e não for uma atualização forçada, aborta.
    // Isso protege a Mídia de ser esmagada pelo setInterval!
    if (!force && data === lastBackendData.value) {
        return;
    }

    lastBackendData.value = data;

    try {
        const parsed = JSON.parse(data);
        if (parsed && parsed.type === 'slide') {
            projectionType.value = 'slide';
            slideData.value = parsed;
            // debugLog.value = "Slide estruturado atualizado";
            return;
        }
    } catch (e) {
        // Ignora erro de parse
    }

    projectionType.value = 'html';
    htmlContent.value = data;
    //debugLog.value = "HTML de PDF recebido";
};

const loadCurrentHtml = async () => {
    try {
        const currentData = await invoke<string>('get_current_projection');
        processIncomingData(currentData, false); // force = false (é apenas o loop automático)
    } catch (e) {
        console.error("Erro ao buscar projeção:", e);
    }
};

// Transforma a cor sólida do Store em um fundo com 30% de opacidade
const getTransparentBackground = (hexColor: string, style: string) => {
    if (style !== 'solid') return 'transparent';
    if (!hexColor) return 'rgba(0, 0, 0, 0.3)'; // Fallback de segurança

    // Remove o '#'
    const hex = hexColor.replace('#', '');
    
    // Converte para RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Retorna com 30% de opacidade (quase transparente)
    return `rgba(${r}, ${g}, ${b}, 0.3)`; 
};

onMounted(async () => {
    await loadCurrentHtml();
    syncInterval = setInterval(loadCurrentHtml, 1000);

    unlistenUpdate = await listen<string>('update-projection', async (event) => {
        await configStore.loadSettings()
        debugLog.value = `Opacidade: ${configStore.settings.bgOpacity}`;

        processIncomingData(event.payload, true); // force = true (ação do usuário)

    });

    unlistenScroll = await listen<ScrollPayload>('sync-pdf-scroll', (event) => {
        const wrapper = document.getElementById('pdf-wrapper');
        if (!wrapper) return;
        const { x, y } = event.payload;
        wrapper.scrollTop = y * (wrapper.scrollHeight - wrapper.clientHeight);
        wrapper.scrollLeft = x * (wrapper.scrollWidth - wrapper.clientWidth);
    });

    unlistenMedia = await listen<MediaFile>('project-media', async (event) => {
        currentMedia.value = event.payload;
        projectionType.value = 'media';
        debugLog.value = `Projetando mídia: ${event.payload.name}`;

        // NOVO: Faz a janela oculta aparecer na tela e ganhar foco
        try {
            const appWindow = getCurrentWindow();
            await appWindow.show();
        } catch (err) {
            console.error("Erro ao exibir janela de projeção:", err);
        }
    });

    unlistenFixed = await listen<MediaFile>('set-fixed-media', async (event) => {
        const oldFixedMedia = { ...mediaStore.fixedMedia }

        debugLog.value = `Mídia fixa definida: ${event.payload?.isVideo}`;
        await mediaStore.setFixedMedia(event.payload);

        if ((projectionType.value === 'none' || projectionType.value === 'fixed') && oldFixedMedia.id != event.payload.id) {
            projectionType.value = 'fixed';

            try {
                const appWindow = getCurrentWindow();
                await appWindow.show();

            } catch (err) {
                console.error("Erro ao exibir janela de projeção:", err);
            }
        }
    });

    unlistenClear = await listen<boolean>('clear-projection', (event) => {
        const cleanFixed = event.payload;

        projectionType.value = mediaStore.fixedMedia && !cleanFixed ? 'fixed' : 'none';
        debugLog.value = mediaStore.fixedMedia + "";
    });

    unlistenMediaControl = await listen<MediaControlPayload>('media-control', (event) => {
        if (!videoRef.value) return;

        const { action, time } = event.payload;
        debugLog.value = `Comando recebido: ${action}`;

        try {
            switch (action) {
                case 'play':
                    videoRef.value.play();
                    break;
                case 'pause':
                    videoRef.value.pause();
                    break;
                case 'mute':
                    videoRef.value.muted = true;
                    break;
                case 'unmute':
                    videoRef.value.muted = false;
                    break;
                case 'restart':
                    videoRef.value.currentTime = 0;
                    //videoRef.value.play();
                    break;
                case 'seek':
                    if (time !== undefined) {
                        videoRef.value.currentTime = time;
                    }
                    break;
           }
        } catch (e) {
            console.error("Erro ao controlar vídeo:", e);
        }
    });

    unlistenNoticeSettings = await listen<string>('update-notice-settings', (event) => {
        try {
            const parsed = JSON.parse(event.payload);
            if (parsed.text) noticeStore.text = parsed.text;
            if (parsed.format) noticeStore.format = { ...noticeStore.format, ...parsed.format };
        } catch (e) {
            console.error("Erro ao aplicar novas configurações de aviso", e);
        }
    });

    // Escuta comandos de reprodução (Play, Pause, Stop) da janela principal
    unlistenNoticePlayback = await listen<{ action: string, isActive: boolean, isPaused: boolean }>('sync-notice-playback', (event) => {
        const { isActive, isPaused } = event.payload;

        debugLog.value = `Sync: ${isActive}`;

        // Atualiza as variáveis de controle visual da projeção
        noticeStore.isActive = isActive;
        noticeStore.isPaused = isPaused;

        if (isActive) {
            try {
                const appWindow = getCurrentWindow();
                appWindow.show(); // Garante que a tela apareça se estiver oculta
            } catch (err) { }
        }
    });

    // =========================================================================
    // LISTENERS DO TIMER
    // =========================================================================
    unlistenTimerSettings = await listen<string>('update-timer-settings', (event) => {
        try {
            const parsed = JSON.parse(event.payload);
            if (parsed.timerMode) timerStore.timerMode = parsed.timerMode;
            if (parsed.durationSecs !== undefined) timerStore.durationSecs = parsed.durationSecs;
            if (parsed.position) timerStore.position = parsed.position;
            if (parsed.fontFamily) timerStore.fontFamily = parsed.fontFamily;
            if (parsed.bgType) timerStore.bgType = parsed.bgType;
            if (parsed.bgMediaUrl !== undefined) timerStore.bgMediaUrl = parsed.bgMediaUrl;
            if (parsed.bgIsVideo !== undefined) timerStore.bgIsVideo = parsed.bgIsVideo;
            if (parsed.gradientColors) timerStore.gradientColors = parsed.gradientColors;
        } catch (e) {
            console.error("Erro ao atualizar configurações do timer", e);
        }
    });

    unlistenTimerPlayback = await listen<{ action: string, timeRemaining: number }>('sync-timer-playback', async (event) => {
        const { action, timeRemaining } = event.payload;

        timerStore.timeRemaining = timeRemaining;

        if (action === 'start' || action === 'resume') {
            projectionType.value = 'timer';
            timerStore.isActive = true;
            timerStore.isPaused = false;

            // NOVO: Define a hora logo de cara pro relógio não piscar "00:00" na tela
            const now = new Date();
            timerStore.currentClockTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            if (localTimerInterval) clearInterval(localTimerInterval);
            localTimerInterval = setInterval(() => {
                // NOVO: Condicional de Modo
                if (timerStore.timerMode === 'clock') {
                    const now = new Date();
                    timerStore.currentClockTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                } else {
                    if (!timerStore.isPaused && timerStore.timeRemaining > 0) {
                        timerStore.timeRemaining--;
                    }
                }
            }, 1000);

            try {
                const appWindow = getCurrentWindow();
                await appWindow.show();
            } catch (err) {}
        } 
        else if (action === 'pause') {
            timerStore.isPaused = true;
        } 
        else if (action === 'stop') {
            timerStore.isActive = false;
            timerStore.isPaused = false;
            if (localTimerInterval) clearInterval(localTimerInterval);

            if (projectionType.value === 'timer') {
                projectionType.value = mediaStore.fixedMedia ? 'fixed' : 'none';
            }
        }
    });
});

const handleKeyDown = async (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
        // Quando apertar ESC, chama o Rust para fechar/ocultar a tela
        await invoke('stop_projection');
    }
};

const timerBackgroundStyle = computed(() => {
    if (timerStore.bgType === 'gradient') {
        return {
            background: `linear-gradient(135deg, ${timerStore.gradientColors[0]}, ${timerStore.gradientColors[1]})`
        };
    }
    return {};
});

onUnmounted(() => {
    if (unlistenUpdate) unlistenUpdate();
    if (unlistenScroll) unlistenScroll();
    if (unlistenMedia) unlistenMedia();
    if (unlistenFixed) unlistenFixed();
    if (unlistenClear) unlistenClear();
    if (unlistenMediaControl) unlistenMediaControl()
    if (syncInterval) clearInterval(syncInterval);

    if (unlistenNoticeSettings) unlistenNoticeSettings();
    if (unlistenNoticePlayback) unlistenNoticePlayback();

    if (unlistenTimerSettings) unlistenTimerSettings();
    if (unlistenTimerPlayback) unlistenTimerPlayback();
    if (localTimerInterval) clearInterval(localTimerInterval);

    window.removeEventListener('keydown', handleKeyDown);
});

onMounted(() => {
    window.addEventListener('keydown', handleKeyDown);
})

</script>

<template>

    <div class="projection-window-container">

        <div v-if="projectionType === 'html'" v-html="htmlContent" class="h-100 w-100"></div>

        <div v-else-if="projectionType === 'slide' && slideData" class="slide-root-container"
            :class="`theme-${slideData.layout.theme}`" :style="{
                backgroundColor: slideData.layout.chromaKey,
                transition: `opacity 0.3s ${slideData.layout.transition}`
            }">
            <div class="background-layer">
                <div v-if="slideData.background.type === 'color'"
                    :style="{ backgroundColor: slideData.background.color, width: '100%', height: '100%' }"></div>
                <video playsinline crossorigin="anonymous" v-else-if="slideData.background.type === 'video'"
                    :src="slideData.background.media" autoplay loop muted
                    :style="{ objectFit: slideData.background.fit }"></video>
                <img v-else-if="slideData.background.type === 'image'" :src="slideData.background.media"
                    :style="{ objectFit: slideData.background.fit }" />
            </div>
            <div class="dark-overlay"
                :style="{ backgroundColor: `rgba(0, 0, 0, ${configStore.settings.bgOpacity / 100})` }"></div>
            <div class="content-layer" :style="{ padding: slideData.layout.padding }">
                <div class="relative-box">
                    <div class="text-layer" :style="{
                        left: slideData.text.posX + '%', top: slideData.text.posY + '%',
                        width: slideData.text.width + '%', height: slideData.text.height + '%'
                    }">
                        <div :style="{
                            fontFamily: `'${slideData.text.fontFamily}', sans-serif`, fontSize: slideData.text.fontSize + 'cqi',
                            color: slideData.text.color, textAlign: slideData.text.align,
                            fontWeight: slideData.text.bold ? 'bold' : 'normal', fontStyle: slideData.text.italic ? 'italic' : 'normal',
                            whiteSpace: 'pre-wrap', width: '100%', maxHeight: '100%', overflow: 'hidden'
                        }">
                            {{ slideData.text.content }}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div v-else-if="projectionType === 'media' && currentMedia" class="media-fullscreen-container">
            <video v-if="currentMedia.isVideo" ref="videoRef" :src="currentMedia.url" autoplay
                class="w-100 h-100 object-fit-contain"></video>
            <img v-else :src="currentMedia.url" class="w-100 h-100 object-fit-contain" />
        </div>

        <div v-else-if="projectionType === 'fixed' && mediaStore.fixedMedia"
            class="media-fullscreen-container bg-black">
            <video v-if="mediaStore.fixedMedia?.isVideo" :src="mediaStore.fixedMedia?.url" autoplay loop muted
                class="w-100 h-100 object-fit-cover"></video>
            <img v-else :src="mediaStore.fixedMedia?.url" class="w-100 h-100 object-fit-cover" />
        </div>
        <div v-else-if="projectionType === 'timer'" 
             class="timer-projection-layer" 
             :class="`pos-${timerStore.position}`" 
             :style="timerBackgroundStyle">
            
            <div v-if="timerStore.bgType === 'media' && timerStore.bgMediaUrl" class="timer-bg-media">
                <video v-if="timerStore.bgIsVideo" :src="timerStore.bgMediaUrl" autoplay loop muted class="w-100 h-100 object-fit-cover"></video>
                <img v-else :src="timerStore.bgMediaUrl" class="w-100 h-100 object-fit-cover" />
            </div>

            <div v-if="timerStore.bgType === 'media'" class="dark-overlay" style="background-color: rgba(0,0,0,0.5); z-index: 2;"></div>

            <div class="timer-display" :style="{ fontFamily: `'${timerStore.fontFamily}', sans-serif` }">
                {{ timerStore.formattedTime }}
            </div>
        </div>

        <div v-else class="w-100 h-100 bg-black"></div>

        <transition name="fade">
            <div v-if="noticeStore.isActive && noticeStore.text" class="notice-overlay" :class="[
                `position-${noticeStore.format.position}`,
                `style-${noticeStore.format.style}`
            ]" :style="{
                    color: noticeStore.format.color,
                    backgroundColor: getTransparentBackground(noticeStore.format.bgColor, noticeStore.format.style)
                }">

                <div class="notice-animator" :class="`anim-${noticeStore.format.animation}`"
                    :style="{ animationPlayState: noticeStore.isPaused ? 'paused' : 'running' }">
                    <span class="notice-text">{{ noticeStore.text }}</span>
                </div>

            </div>
        </transition>
        <div v-if="isDev"
            style="position: absolute; top: 10px; left: 10px; background: rgba(255,0,0,0.8); color: white; padding: 10px; z-index: 9999; font-weight: bold; border-radius: 4px;">
            DEBUG: {{ debugLog }}
        </div>

    </div>
</template>

<style scoped>
/* Reset global essencial para janela de projeção secundária */
:global(body) {
    margin: 0;
    overflow: hidden;
    background-color: black;
}

.projection-window-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    margin: 0;
    padding: 0;
    background-color: #000;
    z-index: 9999;
    overflow: hidden;
}

/* --------------------------------- */
/* ESTRUTURA DOS SLIDES (COM TEXTO)  */
/* --------------------------------- */
.slide-root-container {
    width: 100vw;
    height: 100vh;
    position: relative;
}

/* CAMADA 1: O Fundo */
.background-layer {
    position: absolute;
    inset: 0;
    z-index: 1;
    /* Nível 1 */
}

.background-layer video,
.background-layer img {
    width: 100%;
    height: 100%;
    display: block;
}

/* CAMADA 2: A Película Escura */
.dark-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    /* Nível 2 - Acima do fundo */
    pointer-events: none;
    transform: translateZ(0);
    transition: background-color 0.3s ease;
}

/* CAMADA 3: O Container de Textos */
.content-layer {
    position: absolute;
    inset: 0;
    z-index: 3;
    /* Nível 3 - Acima de tudo */
    box-sizing: border-box;
    pointer-events: none;
    /* Deixe 'none' para não bugar nada caso clique na tela de projeção */
}

.relative-box {
    position: relative;
    width: 100%;
    height: 100%;
}

.text-layer {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    container-type: inline-size;
}

/* --------------------------------- */
/* MÍDIAS AVULSAS E FUNDO FIXO       */
/* --------------------------------- */
.media-fullscreen-container {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
}

.object-fit-contain {
    object-fit: contain;
}

.object-fit-cover {
    object-fit: cover;
}

/* ================================================================== */
/* ESTILIZAÇÃO E ANIMAÇÃO DOS AVISOS                                  */
/* ================================================================== */

.notice-overlay {
    position: absolute;
    left: 0;
    width: 100vw;
    z-index: 999999; /* Garante que ficará acima até das mídias/PDFs */
    display: flex;
    align-items: center;
    overflow: hidden;
    padding: 2vh 2vw;
    box-sizing: border-box;
    font-size: clamp(32px, 5vw, 80px); /* Escalável conforme tamanho da tela */
    font-family: sans-serif;
    font-weight: bold;
}

/* Posicionamento */
.position-top { top: 0; }
.position-bottom { bottom: 0; }

/* Estilos de Fundo */
.style-solid {
    box-shadow: 0px 4px 20px rgba(0,0,0,0.6);
}
.style-transparent {
    /* Borda (stroke) simulada via sombra para o texto aparecer independentemente da imagem de fundo */
    text-shadow: 
        3px 3px 0 #000, -1px -1px 0 #000, 
        1px -1px 0 #000, -1px 1px 0 #000, 
        1px 1px 0 #000, 0px 5px 15px rgba(0,0,0,0.8);
}

/* Container de Animação */
.notice-animator {
    width: 100%;
    white-space: nowrap;
}

/* Transição Vue Genérica (Aparecer/Desaparecer a barra como um todo) */
.fade-enter-active, .fade-leave-active {
    transition: opacity 0.5s ease, transform 0.5s ease;
}
.fade-enter-from, .fade-leave-to {
    opacity: 0;
}

/* TIPO DE ANIMAÇÃO 1: Letreiro Passando (Marquee) */
.anim-marquee {
    display: inline-block;
    padding-left: 100%; /* Inicia totalmente escondido à direita */
    /* Você pode ajustar o tempo (20s) na configuração futuramente se quiser rolar mais rápido/devagar */
    animation: notice-scroll-left 20s linear infinite;
}

@keyframes notice-scroll-left {
    0%   { transform: translateX(0); }
    100% { transform: translateX(-100%); }
}

/* TIPO DE ANIMAÇÃO 2: Piscar Suave (Fade in out) */
.anim-fade {
    text-align: center;
    white-space: normal; /* Para textos curtos, permite quebra de linha se necessário */
    animation: notice-pulse 3s ease-in-out infinite;
}

@keyframes notice-pulse {
    0% { opacity: 0.8; }
    50% { opacity: 1; transform: scale(1.02); }
    100% { opacity: 0.8; }
}

/* TIPO DE ANIMAÇÃO 3: Deslizar de baixo/cima e parar (Slide) */
.anim-slide {
    text-align: center;
    white-space: normal;
    animation: notice-slide-in 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}

@keyframes notice-slide-in {
    0% { transform: translateY(100%); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
}

/** ## Timer */

.timer-projection-layer {
    position: absolute;
    inset: 0;
    z-index: 999998; /* Logo abaixo dos avisos */
    display: flex;
    align-items: center;
    justify-content: center;
}

.pos-top { align-items: flex-start; padding-top: 10vh; }
.pos-bottom { align-items: flex-end; padding-bottom: 10vh; }
.pos-center { align-items: center; }

.timer-display {
    font-size: 25vw;
    font-weight: 800;
    color: white;
    text-shadow: 0 10px 30px rgba(0,0,0,0.8);
    z-index: 10;
}

.timer-bg-media {
    position: absolute;
    inset: 0;
    z-index: 1;
}
</style>