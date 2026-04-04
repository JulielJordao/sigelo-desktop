<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface ScrollPayload { x: number; y: number; }

// Variáveis para gerir o modo de exibição
const projectionType = ref<'html' | 'slide'>('html');
const htmlContent = ref<string>('<div style="color: white; display: flex; height: 100vh; align-items: center; justify-content: center;">Aguardando projeção...</div>');
const slideData = ref<any>(null); // Guardará os dados do JSON

const debugLog = ref<string>("Iniciando...");

let unlistenUpdate: UnlistenFn | null = null;
let unlistenScroll: UnlistenFn | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;

// Função central para processar o que chega do Tauri
const processIncomingData = (data: string) => {
    if (!data || data.trim() === '') return;

    try {
        // Tenta converter para JSON. Se for o nosso slide, ele processa reativamente.
        const parsed = JSON.parse(data);
        if (parsed && parsed.type === 'slide') {
            projectionType.value = 'slide';
            slideData.value = parsed;
            debugLog.value = "Slide estruturado atualizado";
            return;
        }
    } catch (e) {
        // Se der erro no JSON.parse, é porque é o HTML bruto do PDF. Segue o jogo!
    }

    // Fallback: Exibe como HTML se não for um slide de música
    if (data !== htmlContent.value) {
        projectionType.value = 'html';
        htmlContent.value = data;
        debugLog.value = "HTML de PDF recebido";
    }
};

const loadCurrentHtml = async () => {
    try {
        const currentData = await invoke<string>('get_current_projection');
        processIncomingData(currentData);
    } catch (e) {
        console.error("Erro ao buscar projeção:", e);
    }
};

onMounted(async () => {
    await loadCurrentHtml();
    syncInterval = setInterval(loadCurrentHtml, 1000);

    unlistenUpdate = await listen<string>('update-projection', (event) => {
        processIncomingData(event.payload);
    });

    unlistenScroll = await listen<ScrollPayload>('sync-pdf-scroll', (event) => {
        const wrapper = document.getElementById('pdf-wrapper');
        if (!wrapper) return;
        const { x, y } = event.payload;
        wrapper.scrollTop = y * (wrapper.scrollHeight - wrapper.clientHeight);
        wrapper.scrollLeft = x * (wrapper.scrollWidth - wrapper.clientWidth);
    });
});

onUnmounted(() => {
    if (unlistenUpdate) unlistenUpdate();
    if (unlistenScroll) unlistenScroll(); 
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
                <div v-if="slideData.background.type === 'color'"
                     :style="{ backgroundColor: slideData.background.color, width: '100%', height: '100%' }">
                </div>
                <video v-else-if="slideData.background.type === 'video'"
                       :src="slideData.background.media"
                       autoplay loop muted
                       :style="{ objectFit: slideData.background.fit }">
                </video>
                <img v-else-if="slideData.background.type === 'image'"
                     :src="slideData.background.media"
                     :style="{ objectFit: slideData.background.fit }" />
            </div>

            <div class="content-layer" :style="{ padding: slideData.layout.padding }">
                <div class="relative-box">
                    <div class="text-layer"
                         :style="{
                             left: slideData.text.posX + '%',
                             top: slideData.text.posY + '%',
                             width: slideData.text.width + '%',
                             height: slideData.text.height + '%'
                         }">
                        <div :style="{
                            fontFamily: `'${slideData.text.fontFamily}', sans-serif`,
                            fontSize: slideData.text.fontSize + 'cqi',
                            color: slideData.text.color,
                            textAlign: slideData.text.align,
                            fontWeight: slideData.text.bold ? 'bold' : 'normal',
                            fontStyle: slideData.text.italic ? 'italic' : 'normal',
                            whiteSpace: 'pre-wrap',
                            width: '100%',
                            maxHeight: '100%',
                            overflow: 'hidden'
                        }">
                            {{ slideData.text.content }}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div style="position: absolute; top: 10px; left: 10px; background: rgba(255,0,0,0.8); color: white; padding: 10px; z-index: 9999; font-weight: bold; border-radius: 4px;">
            DEBUG: {{ debugLog }}
        </div>

    </div>
</template>

<style scoped>
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

.slide-root-container {
    width: 100%;
    height: 100%;
    position: relative;
}

.background-layer {
    position: absolute;
    inset: 0;
    z-index: 0;
}

/* display: block remove o espaço extra inferior (baseline gap) nativo dos browsers */
.background-layer video,
.background-layer img {
    width: 100%;
    height: 100%;
    display: block; 
}

.content-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
    box-sizing: border-box;
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
    pointer-events: none;
}

:global(body) {
    margin: 0;
    overflow: hidden;
    background-color: black;
}
</style>