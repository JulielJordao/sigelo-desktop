<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

const projectionContent = ref<string>('<div style="color: white; font-family: sans-serif; display: flex; height: 100vh; align-items: center; justify-content: center;">Aguardando projeção...</div>');
let unlistenUpdate: UnlistenFn | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;

// Função para puxar o HTML diretamente da memória do Rust
const loadCurrentHtml = async () => {
    try {
        const currentHtml = await invoke<string>('get_current_projection');
        // Só atualiza se o HTML for válido e diferente do atual (evita piscar a tela)
        if (currentHtml && currentHtml.trim() !== '' && currentHtml !== projectionContent.value) {
            projectionContent.value = currentHtml;
            console.log("HTML atualizado via sincronização!");
        }
    } catch (e) {
        console.error("Erro ao buscar projeção:", e);
    }
};

onMounted(async () => {
    // 1. Tenta carregar assim que a janela abre
    await loadCurrentHtml();

    // 2. FALLBACK ROBUSTO: Checa o Rust a cada 500ms 
    // Se o evento falhar, isso aqui garante que o telão mude quase instantaneamente
    syncInterval = setInterval(loadCurrentHtml, 500);

    // 3. O evento original (para ser instantâneo, caso funcione perfeitamente)
    unlistenUpdate = await listen<string>('update-projection', (event) => {
        if (event.payload && event.payload !== projectionContent.value) {
            projectionContent.value = event.payload;
            console.log("HTML atualizado via Evento!");
        }
    });
});

onUnmounted(() => {
    if (unlistenUpdate) unlistenUpdate();
    if (syncInterval) clearInterval(syncInterval);
});
</script>

<template>
    <div 
        class="projection-window-container" 
        v-html="projectionContent"
    ></div>
</template>

<style scoped>
.projection-window-container {
    margin: 0;
    padding: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background-color: #000;
}

:global(body) {
    margin: 0;
    overflow: hidden;
    background-color: black;
}
</style>