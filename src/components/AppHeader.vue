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
  <header class="app-header d-flex align-center px-4" data-tauri-drag-region>
    
    <div v-if="isMac" style="width: 70px;" data-tauri-drag-region></div>

    <v-spacer data-tauri-drag-region></v-spacer>

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
  </header>
</template>

<style scoped>
.app-header {
  height: 48px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  user-select: none;
  flex-shrink: 0;
  position: relative;
  z-index: 50;
}

.z-10 {
  z-index: 10;
}

/* Container flexível para os controles nativos */
.window-controls {
  gap: 4px; /* Pequeno espaço entre os botões */
  margin-right: -4px; /* Ajuste fino para encostar na borda direita */
}

/* Força as dimensões do botão para garantir o alinhamento perfeito */
.window-btn {
  width: 32px !important;
  height: 32px !important;
  border-radius: 6px !important;
  color: #666;
  font-size: 0.8rem; /* Controla o tamanho interno do ícone */
}

.window-btn:hover {
  background-color: rgba(0, 0, 0, 0.06);
}

.btn-close:hover {
  background-color: #e81123 !important;
  color: white !important;
}
</style>