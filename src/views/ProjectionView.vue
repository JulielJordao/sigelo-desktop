<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// Tipagem para o payload de scroll
interface ScrollPayload {
    x: number;
    y: number;
}

const projectionContent = ref<string>('<div style="color: white; font-family: sans-serif; display: flex; height: 100vh; align-items: center; justify-content: center;">Aguardando projeção...</div>');
const debugLog = ref<string>("Iniciando...");

let unlistenUpdate: UnlistenFn | null = null;
let unlistenScroll: UnlistenFn | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;

// Função para puxar o HTML diretamente da memória do Rust
const loadCurrentHtml = async () => {
    try {
        const currentHtml = await invoke<string>('get_current_projection');
        
        // Só atualiza se o HTML for válido e diferente do atual.
        // Isso evita que o scroll "pule" ou resete se o HTML for idêntico.
        if (currentHtml && currentHtml.trim() !== '' && currentHtml !== projectionContent.value) {
            projectionContent.value = currentHtml;
            debugLog.value = "HTML sincronizado via Rust";
        }
    } catch (e) {
        console.error("Erro ao buscar projeção:", e);
        debugLog.value = "Erro ao buscar do Rust";
    }
};

onMounted(async () => {
    // 1. Carregamento Inicial
    await loadCurrentHtml();

    // 2. Intervalo de Sincronização (Fallback)
    syncInterval = setInterval(loadCurrentHtml, 1000);

    // 3. Ouvir atualizações de conteúdo (Trigger imediato do Rust)
    unlistenUpdate = await listen<string>('update-projection', (event) => {
        if (event.payload && event.payload !== projectionContent.value) {
            projectionContent.value = event.payload;
            debugLog.value = "Conteúdo atualizado via Evento";
        }
    });

    // 4. Ouvir Sincronização de Scroll do PDF
    unlistenScroll = await listen<ScrollPayload>('sync-pdf-scroll', (event) => {
        const wrapper = document.getElementById('pdf-wrapper');

        if (!wrapper) {
            debugLog.value = "AVISO: pdf-wrapper não encontrado no DOM (Modo PDF inativo?)";
            return;
        }

        // Se chegamos aqui, o sinal chegou e o elemento existe
        const { x, y } = event.payload;
        debugLog.value = `Scroll: ${(y * 100).toFixed(0)}% | Elemento OK`;

        // Aplica a rolagem baseada na proporção recebida
        wrapper.scrollTop = y * (wrapper.scrollHeight - wrapper.clientHeight);
        wrapper.scrollLeft = x * (wrapper.scrollWidth - wrapper.clientWidth);
    });
});

onUnmounted(() => {
    // Cleanup de segurança
    if (unlistenUpdate) unlistenUpdate();
    if (unlistenScroll) unlistenScroll(); 
    if (syncInterval) clearInterval(syncInterval);
});
</script>

<template>
    <div 
        class="projection-window-container">
        <div v-html="projectionContent" class="h-100 w-100"></div>
        <div style="position: absolute; top: 10px; left: 10px; background: rgba(255,0,0,0.8); color: white; padding: 10px; z-index: 9999; font-weight: bold; border-radius: 4px;">
            DEBUG: {{ debugLog }}
        </div>

    </div>
</template>

<style scoped>
.projection-window-container {
    margin: 0;
    padding: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden; /* Oculta a rolagem geral (O PDF lida com a própria rolagem internamente) */
    background-color: #000;
}

:global(body) {
    margin: 0;
    overflow: hidden;
    background-color: black;
}
</style>