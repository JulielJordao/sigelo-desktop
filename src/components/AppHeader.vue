<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { type } from '@tauri-apps/plugin-os';
import { listen } from '@tauri-apps/api/event';

const osType = type();
const isMac = osType === 'macos';
const appWindow = getCurrentWindow();

const emit = defineEmits<{
  (e: 'import'): void;
  (e: 'export'): void;
}>();

const minimize = () => appWindow.minimize();
const toggleMaximize = () => appWindow.toggleMaximize();
const close = () => appWindow.close();

const handleImport = () => emit('import');
const handleExport = () => emit('export');

let unlistenImport: () => void;
let unlistenExport: () => void;

onMounted(async () => {
  unlistenImport = await listen('menu-import', () => { handleImport(); });
  unlistenExport = await listen('menu-export', () => { handleExport(); });
});

onUnmounted(() => {
  if (unlistenImport) unlistenImport();
  if (unlistenExport) unlistenExport();
});
</script>

<template>
  <v-app-bar 
    height="48" 
    elevation="0" 
    class="app-header px-4" 
  >
    <div data-tauri-drag-region class="drag-layer"></div>
    
    <div v-if="isMac" style="width: 70px;" data-tauri-drag-region class="z-10"></div>

    <v-spacer data-tauri-drag-region class="z-10"></v-spacer>

    <div class="z-10" :class="isMac ? '' : 'mr-4'">
      <v-btn-group 
        color="surface-variant" 
        variant="outlined" 
        density="comfortable" 
        divided 
        class="rounded-pill overflow-hidden bg-white"
      >
        <v-tooltip text="Importar Arquivo" location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn 
              v-bind="props" 
              icon="mdi-import" 
              @click="handleImport"
            ></v-btn>
          </template>
        </v-tooltip>

        <v-tooltip text="Exportar Arquivo" location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn 
              v-bind="props" 
              icon="mdi-export" 
              @click="handleExport"
            ></v-btn>
          </template>
        </v-tooltip>
      </v-btn-group>
    </div>

    <div v-if="!isMac" class="window-controls z-10 d-flex align-center">
      <v-btn 
        icon="mdi-window-minimize" 
        variant="text" 
        class="window-btn" 
        @click="minimize"
      ></v-btn>
      
      <v-btn 
        icon="mdi-window-maximize" 
        variant="text" 
        class="window-btn" 
        @click="toggleMaximize"
      ></v-btn>
      
      <v-btn 
        icon="mdi-close" 
        variant="text" 
        class="window-btn btn-close" 
        @click="close"
      ></v-btn>
    </div>
  </v-app-bar>
</template>

<style scoped>
.app-header {
  background: rgba(255, 255, 255, 0.85) !important;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08) !important;
  
  /* MÁGICA 2: Mata qualquer comportamento de seleção de texto nativo */
  user-select: none !important;
  -webkit-user-select: none !important;
  cursor: default !important; /* Trava o cursor como setinha */
  z-index: 50;
}

/* Oculta completamente a camada extra do layout visual, mas captura cliques */
.drag-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1; /* Fica atrás de tudo no header */
  cursor: default !important;
}

.z-10 {
  z-index: 10;
  position: relative; /* Necessário para que o z-index funcione e fique sobre a drag-layer */
}

/* Container flexível para os controles nativos */
.window-controls {
  gap: 4px;
  margin-right: -4px;
}

/* Força as dimensões do botão para garantir o alinhamento perfeito */
.window-btn {
  width: 32px !important;
  height: 32px !important;
  border-radius: 6px !important;
  color: #666;
  font-size: 0.8rem;
  /* Garante que botões não deixem arrastar a tela acidentalmente */
  -webkit-app-region: no-drag; 
}

.window-btn:hover {
  background-color: rgba(0, 0, 0, 0.06);
}

.btn-close:hover {
  background-color: #e81123 !important;
  color: white !important;
}
</style>