<script setup lang="ts">
import PdfPresenter from './components/projection/PdfPresenter.vue';
import AppHeader from './components/AppHeader.vue';
import YoutubeImportModal from './components/youtube/YoutubeImportModal.vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ref, onMounted, computed } from 'vue';
import { exportToPPTX } from './utils/pptxGen';
import { exportToPDF } from './utils/pdfGen';
import { useFontStore } from './stores/useFontStore';
import { useRoute } from 'vue-router';
import { useTheme } from 'vuetify';
import { useConfigStore } from './stores/useConfigStore';

const refPdfPresenter = ref<InstanceType<typeof PdfPresenter> | null>(null);
const windowLabel = ref('');
const route = useRoute();
const theme = useTheme();
const configStore = useConfigStore()

const fontStore = useFontStore()

const showToolbar = computed(() => {
  const isProjectionWindow = windowLabel.value === 'projection';
  const isProjectionRoute = route.path.includes('projection');

  const isStageWindow = windowLabel.value === 'stage';
  const isStageRoute = route.path.includes('stage-monitor');

  return (!isProjectionWindow && !isProjectionRoute) && (!isStageWindow && !isStageRoute);
});

const isYoutubeModalOpen = ref(false)

// Aqui você conecta com a sua função do PDF!
const handleImportAction = (type: string) => {
  if (type === 'youtube') {
    isYoutubeModalOpen.value = true;
  } else if (type === 'pdf') {
    refPdfPresenter.value?.openPdfFile()
  }

  console.log("Usuário clicou em importar ou usou o menu nativo!");
  // ex: pdfPresenterRef.value?.openPdfFile();
};

const handleExportAction = (type: String) => {
  if(type === "pptx"){
    exportToPPTX()
  } else if(type === 'pdf'){
    exportToPDF()
  }
  console.log("Usuário clicou em exportar ou usou o menu nativo!");
  // ex: exportToPPTX();
};

if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
}

onMounted(async () => {
  await configStore.loadSettings()
  theme.change(configStore.getTheme())
  const appWindow = getCurrentWindow();
  await fontStore.loadDefaultFonts();
  await fontStore.loadCustomFonts();
  windowLabel.value = appWindow.label;
});
</script>

<template>
  <v-app class="bg-background" style="max-height: 100vh; overflow: hidden;">

    <AppHeader @import="handleImportAction" @export="handleExportAction" v-if="showToolbar" />

    <pdf-presenter ref="refPdfPresenter"></pdf-presenter>
    <youtube-import-modal v-model="isYoutubeModalOpen"></youtube-import-modal>

    <v-main style="max-height: 100vh; overflow: hidden;">

      <div class="h-100 overflow-y-auto">
        <router-view />
      </div>

    </v-main>

  </v-app>
</template>

<style>

.v-application {
  background-color: rgb(var(--v-theme-background)) !important;
}

html,
body {
  margin: 0;
  padding: 0;
  user-select: none;
  /* Trava totalmente o scroll da janela nativa */
  overflow: hidden !important;
  width: 100%;
  overflow: hidden;
  height: 100%;
}

#app {
  height: 100vh;
  width: 100vw;
  transform: translateZ(0);
  background-color: rgb(var(--v-theme-background)) !important;
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