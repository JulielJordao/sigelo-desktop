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
  <v-app class="bg-background" style="max-height: 100vh; overflow: hidden;">
    
    <AppHeader 
      @import="handleImportAction" 
      @export="handleExportAction" 
      v-if="showToolbar"
    />
    
    <pdf-presenter ref="refPdfPresenter"></pdf-presenter>

    <v-main style="max-height: 100vh; overflow: hidden;">
      
      <div class="h-100 overflow-y-auto">
        <router-view />
      </div>

    </v-main>
    
  </v-app>
</template>

<style>
/* Estilos Globais para o seu Desktop App */
html, body {
  margin: 0;
  padding: 0;
  user-select: none;
  /* Trava totalmente o scroll da janela nativa */
  overflow: hidden !important; 
  height: 100%;
}

#app {
  height: 100vh;
  width: 100vw;
  /* Blinda o container principal contra vazamentos de layout */
  overflow: hidden; 
}

:root {
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
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