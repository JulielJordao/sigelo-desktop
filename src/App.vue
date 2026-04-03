<script setup lang="ts">
import PdfPresenter from './components/projection/PdfPresenter.vue';
import AppHeader from './components/AppHeader.vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';

const refPdfPresenter = ref<InstanceType<typeof PdfPresenter> | null>(null);
const windowLabel = ref('');
const route = useRoute();

const showToolbar = computed(() => {
  const isProjectionWindow = windowLabel.value === 'projection';
  const isProjectionRoute = route.path.includes('projection');
  
  return !isProjectionWindow && !isProjectionRoute;
});

// Aqui você conecta com a sua função do PDF!
const handleImportAction = () => {
  refPdfPresenter.value?.openPdfFile()
  console.log("Usuário clicou em importar ou usou o menu nativo!");
  // ex: pdfPresenterRef.value?.openPdfFile();
};

const handleExportAction = () => {
  console.log("Usuário clicou em exportar ou usou o menu nativo!");
  // ex: exportToPPTX();
};

onMounted(async () => {
  const appWindow = getCurrentWindow();
  windowLabel.value = appWindow.label;
});
</script>

<template>
  <v-app class="d-flex flex-column fill-height bg-background overflow-hidden">
    <AppHeader 
      @import="handleImportAction" 
      @export="handleExportAction" 
      v-if="showToolbar"
    />
    <pdf-presenter ref="refPdfPresenter"></pdf-presenter>

    <v-main class="flex-grow-1 overflow-hidden">
      <router-view />
    </v-main>
  </v-app>
</template>

<style>
/* Estilos Globais para o seu Desktop App */
html {
  /* Impede que o usuário selecione texto em partes indesejadas do app (comum em apps desktop) */
  user-select: none;
  overflow: hidden; /* O scroll será controlado internamente pelos componentes */
}

:root {
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
}

/* Garante que o app ocupe 100% da janela do Tauri */
#app {
  height: 100vh;
  width: 100vw;
}

/* Personalização da barra de rolagem para ficar mais elegante no Mac */
::-webkit-scrollbar {
  width: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #bdbdbd;
  border-radius: 10px;
}
::-webkit-scrollbar-thumb:hover {
  background: #9e9e9e;
}
</style>