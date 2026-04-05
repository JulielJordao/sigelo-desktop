<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface MediaFile {
  id: string;
  name: string;
  path: string;
  url: string;
  isVideo: boolean;
}

interface ScrollPayload { x: number; y: number; }

const projectionType = ref<'html' | 'slide' | 'media' | 'fixed' | 'none'>('none');

const htmlContent = ref<string>('<div style="color: white; display: flex; height: 100vh; align-items: center; justify-content: center;">Aguardando projeção...</div>');
const slideData = ref<any>(null);

const currentMedia = ref<MediaFile | null>(null);
const fixedMedia = ref<MediaFile | null>(null);

const debugLog = ref<string>("Iniciando...");

// *** NOVO: Guarda o último dado do Rust para o setInterval não atrapalhar ***
const lastBackendData = ref<string>('');

let unlistenUpdate: UnlistenFn | null = null;
let unlistenScroll: UnlistenFn | null = null;
let unlistenMedia: UnlistenFn | null = null;
let unlistenFixed: UnlistenFn | null = null;
let unlistenClear: UnlistenFn | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;

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
            debugLog.value = "Slide estruturado atualizado";
            return;
        }
    } catch (e) {
        // Ignora erro de parse
    }

    projectionType.value = 'html';
    htmlContent.value = data;
    debugLog.value = "HTML de PDF recebido";
};

const loadCurrentHtml = async () => {
    try {
        const currentData = await invoke<string>('get_current_projection');
        processIncomingData(currentData, false); // force = false (é apenas o loop automático)
    } catch (e) {
        console.error("Erro ao buscar projeção:", e);
    }
};

onMounted(async () => {
    await loadCurrentHtml();
    syncInterval = setInterval(loadCurrentHtml, 1000);

    unlistenUpdate = await listen<string>('update-projection', (event) => {
        processIncomingData(event.payload, true); // force = true (ação do usuário)
    });

    unlistenScroll = await listen<ScrollPayload>('sync-pdf-scroll', (event) => {
        const wrapper = document.getElementById('pdf-wrapper');
        if (!wrapper) return;
        const { x, y } = event.payload;
        wrapper.scrollTop = y * (wrapper.scrollHeight - wrapper.clientHeight);
        wrapper.scrollLeft = x * (wrapper.scrollWidth - wrapper.clientWidth);
    });

    unlistenMedia = await listen<MediaFile>('project-media', (event) => {
        currentMedia.value = event.payload;
        projectionType.value = 'media';
        debugLog.value = `Projetando mídia: ${event.payload.name}`;
    });

    unlistenFixed = await listen<MediaFile>('set-fixed-media', (event) => {
        fixedMedia.value = event.payload;
        debugLog.value = `Mídia fixa definida: ${event.payload.name}`;
        
        if (projectionType.value === 'none') {
            projectionType.value = 'fixed';
        }
    });

    unlistenClear = await listen('clear-projection', () => {
        projectionType.value = fixedMedia.value ? 'fixed' : 'none';
        debugLog.value = "Projeção limpa. " + (fixedMedia.value ? "Exibindo fundo." : "Tela preta.");
    });
});

onUnmounted(() => {
    if (unlistenUpdate) unlistenUpdate();
    if (unlistenScroll) unlistenScroll(); 
    if (unlistenMedia) unlistenMedia();
    if (unlistenFixed) unlistenFixed();
    if (unlistenClear) unlistenClear();
    if (syncInterval) clearInterval(syncInterval);
});
</script>

<template>
    <div class="projection-window-container">

        <div v-if="projectionType === 'html'" v-html="htmlContent" class="h-100 w-100"></div>

        <div v-else-if="projectionType === 'slide' && slideData"
             class="slide-root-container"
             :class="`theme-${slideData.layout.theme}`"
             :style="{
                 backgroundColor: slideData.layout.chromaKey,
                 opacity: slideData.layout.opacity,
                 transition: `opacity 0.3s ${slideData.layout.transition}`
             }">
            <div class="background-layer">
                <div v-if="slideData.background.type === 'color'" :style="{ backgroundColor: slideData.background.color, width: '100%', height: '100%' }"></div>
                <video v-else-if="slideData.background.type === 'video'" :src="slideData.background.media" autoplay loop muted :style="{ objectFit: slideData.background.fit }"></video>
                <img v-else-if="slideData.background.type === 'image'" :src="slideData.background.media" :style="{ objectFit: slideData.background.fit }" />
            </div>
            <div class="content-layer" :style="{ padding: slideData.layout.padding }">
                <div class="relative-box">
                    <div class="text-layer"
                         :style="{
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
            <video v-if="currentMedia.isVideo" :src="currentMedia.url" autoplay class="w-100 h-100 object-fit-contain"></video>
            <img v-else :src="currentMedia.url" class="w-100 h-100 object-fit-contain" />
        </div>

        <div v-else-if="projectionType === 'fixed' && fixedMedia" class="media-fullscreen-container bg-black">
            <video v-if="fixedMedia.isVideo" :src="fixedMedia.url" autoplay loop muted class="w-100 h-100 object-fit-cover"></video>
            <img v-else :src="fixedMedia.url" class="w-100 h-100 object-fit-cover" />
        </div>

        <div v-else class="w-100 h-100 bg-black"></div>

        <div style="position: absolute; top: 10px; left: 10px; background: rgba(255,0,0,0.8); color: white; padding: 10px; z-index: 9999; font-weight: bold; border-radius: 4px;">
            DEBUG: {{ debugLog }}
        </div>

    </div>
</template>

<style scoped>
/* Adicionado estilos para o modo de tela cheia das mídias */
.media-fullscreen-container {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
}

.object-fit-contain {
    object-fit: contain; /* Mostra a mídia inteira sem cortar, bom para projeção principal */
}

.object-fit-cover {
    object-fit: cover; /* Preenche a tela toda cortando bordas, ideal para imagens/loops de fundo */
}

/* Restante do seu CSS original... */
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
.slide-root-container { width: 100%; height: 100%; position: relative; }
.background-layer { position: absolute; inset: 0; z-index: 0; }
.background-layer video, .background-layer img { width: 100%; height: 100%; display: block; }
.content-layer { position: absolute; inset: 0; z-index: 10; box-sizing: border-box; }
.relative-box { position: relative; width: 100%; height: 100%; }
.text-layer { position: absolute; display: flex; align-items: center; justify-content: center; container-type: inline-size; pointer-events: none; }
:global(body) { margin: 0; overflow: hidden; background-color: black; }
</style>