<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import * as pdfjsLib from 'pdfjs-dist';
import { useConfigStore } from '../../stores/useConfigStore';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { useMenuStore } from '../../stores/menuStore';
import { useStatusPresentationStore } from '../../stores/statusPresentationStore';

import { type } from '@tauri-apps/plugin-os';

const isMac = type() === 'macos'

const menuStore = useMenuStore();

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const configStore = useConfigStore();
const statusPresStore = useStatusPresentationStore();

interface PdfPage {
  pageNumber: number;
  dataUrl: string;
  edgeColor: string;
}

const isOpen = ref(false);
const isLoading = ref(false);
const fileName = ref('');

const pages = ref<PdfPage[]>([]);
const currentPage = ref<number>(1);
const isProjecting = computed(()=> { return statusPresStore.status.isPresentation && statusPresStore.status.isPresentation === 'Pdf'});

const displayMode = ref<'normal' | 'stretch' | 'complete' | 'document'>('normal');
const zoomLevel = ref<number>(100);

const activePage = computed(() => pages.value.find(p => p.pageNumber === currentPage.value));
const sidebarItems = ref<HTMLElement[]>([]);

const scrollToActive = async () => {
  await nextTick();
  const activeElement = sidebarItems.value[currentPage.value - 1];
  if (activeElement) {
    activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

const openPdfFile = async () => {
  try {
    const selectedPath = await open({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (!selectedPath || typeof selectedPath !== 'string') return;

    isLoading.value = true;
    menuStore.toggleMenu('PdfPresenter');
    isOpen.value = true;
    pages.value = [];
    fileName.value = selectedPath.split(/[\\/]/).pop() || 'Arquivo.pdf';

    const fileData = await readFile(selectedPath);
    const loadingTask = pdfjsLib.getDocument({ data: fileData });
    const pdf = await loadingTask.promise;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport: viewport,
        canvas: canvas
      }).promise;

      const pixelData = ctx.getImageData(1, Math.floor(canvas.height / 2), 1, 1).data;
      const edgeColor = `rgb(${pixelData[0]}, ${pixelData[1]}, ${pixelData[2]})`;

      pages.value.push({
        pageNumber: i,
        dataUrl: canvas.toDataURL('image/jpeg', 0.8),
        edgeColor
      });
    }

    currentPage.value = 1;
    displayMode.value = 'normal';
    zoomLevel.value = 100;
  } catch (error) {
    console.error("Erro ao ler o PDF:", error);
    alert("Falha ao abrir o PDF.");
    menuStore.toggleMenu(menuStore.oldMenuOpened);
    isOpen.value = false;
  } finally {
    
    isLoading.value = false;
  }
};

defineExpose({ openPdfFile });

const projectCurrentPage = async () => {
  if (!activePage.value) return;


  const p = activePage.value;
  let wrapperBgColor = '#000000';
  let imgStyle = '';
  let wrapperStyle = `width: 100vw; height: 100vh; overflow: hidden; display: flex; justify-content: center; align-items: center; margin: 0; padding: 0;`;

  if (displayMode.value === 'normal') {
    imgStyle = 'width: 100%; height: 100%; object-fit: contain;';
  }
  else if (displayMode.value === 'stretch') {
    imgStyle = 'width: 100%; height: 100%; object-fit: fill;';
  }
  else if (displayMode.value === 'complete') {
    wrapperBgColor = p.edgeColor;
    imgStyle = 'width: 100%; height: 100%; object-fit: contain;';
  }
  else if (displayMode.value === 'document') {
    wrapperBgColor = '#121212';
    // FIX 1: Desliga o flexbox na projeção para o Zoom não travar a rolagem
    wrapperStyle = `width: 100vw; height: 100vh; overflow: auto; text-align: center; margin: 0; padding: 24px; box-sizing: border-box; scroll-behavior: auto;`;
    imgStyle = `width: ${zoomLevel.value}%; height: auto; object-fit: contain; margin: 0 auto; display: block; box-shadow: 0 10px 30px rgba(0,0,0,0.5); transition: width 0.3s ease;`;
  }

  const htmlPayload = `
    <div id="pdf-wrapper" style="${wrapperStyle} background-color: ${wrapperBgColor};">
      <img src="${p.dataUrl}" style="${imgStyle}" />
    </div>
  `;

  try {
    await statusPresStore.setNewPresentation('Pdf', configStore.settings.selectedMonitor)

    await invoke('update_projection', { html: htmlPayload, targetMonitor: configStore.settings.selectedMonitor });
    
  } catch (error) {
    console.error("Erro ao projetar PDF:", error);
  }
};

const stopProjection = async () => {
  await statusPresStore.clean()
};

// NOVO: Captura a rolagem e envia para a janela de projeção
const handleScroll = async (e: Event) => {
  console.log(isProjecting.value)
  if (displayMode.value !== 'document' || !isProjecting.value) return;

  const target = e.target as HTMLElement;
  // Transforma em porcentagem (0 a 1) para funcionar independente do tamanho das telas
  const scrollY = target.scrollTop / Math.max(1, target.scrollHeight - target.clientHeight);
  const scrollX = target.scrollLeft / Math.max(1, target.scrollWidth - target.clientWidth);

  // Emite o evento global para o Tauri
  await emit('sync-pdf-scroll', { y: scrollY, x: scrollX });
};

const handleKeydown = (e: KeyboardEvent) => {
  if (!isOpen.value) return;

  // Não está funcionando
  if (e.key === 'Escape') {
    if(isProjecting) { stopProjection()} else {isOpen.value = true}
  }
  
  if (e.key === 'ArrowRight') {
    if (currentPage.value < pages.value.length) currentPage.value++;
  } else if (e.key === 'ArrowLeft') {
    if (currentPage.value > 1) currentPage.value--;
  }
  else if (displayMode.value !== 'document') {
    if (e.key === 'ArrowDown' && currentPage.value < pages.value.length) currentPage.value++;
    if (e.key === 'ArrowUp' && currentPage.value > 1) currentPage.value--;
  }
};

window.addEventListener('keydown', handleKeydown);

watch(currentPage, () => {
  scrollToActive();
  if (isProjecting.value) projectCurrentPage();
});
watch([displayMode, zoomLevel], () => {
  if (isProjecting.value) projectCurrentPage();
});

watch(isOpen, () => {
  if(menuStore.menuOpened === 'PdfPresenter') {
      console.log("watch")
      menuStore.toggleMenu(menuStore.oldMenuOpened)
      if(isProjecting) stopProjection();
  }
})
</script>

<template>
  <v-dialog v-model="isOpen" fullscreen transition="dialog-bottom-transition">
    <v-card class="bg-background d-flex flex-column rounded-0">

      <v-toolbar density="compact" color="surface" elevation="1" class="border-b px-2">

        <div v-if="isMac" style="width: 75px;" class="flex-shrink-0"></div>

        <div class="d-flex align-center overflow-hidden flex-shrink-1 mr-4">
          <v-icon color="error" class="mr-2">mdi-file-pdf-box</v-icon>
          <span class="font-weight-bold text-subtitle-2 text-truncate" style="max-width: 300px;" :title="fileName">
            {{ fileName }}
          </span>
        </div>

        <v-spacer></v-spacer>

        <div class="d-flex align-center gap-3">

          <v-slide-x-transition>
            <div v-if="displayMode === 'document'"
              class="d-flex align-center bg-grey-lighten-4 rounded-pill px-2 mr-2 border" style="height: 34px;">
              <v-btn icon="mdi-minus" variant="text" size="x-small" density="comfortable"
                @click="zoomLevel = Math.max(50, zoomLevel - 25)"></v-btn>
              <span class="text-caption font-weight-bold mx-1" style="min-width: 40px; text-align: center;">{{ zoomLevel
                }}%</span>
              <v-btn icon="mdi-plus" variant="text" size="x-small" density="comfortable"
                @click="zoomLevel = Math.min(300, zoomLevel + 25)"></v-btn>
            </div>
          </v-slide-x-transition>

          <v-btn-toggle v-model="displayMode" mandatory density="compact" color="primary" variant="outlined"
            class="rounded-pill bg-white" style="height: 34px;">
            <v-tooltip text="Normal (Mantém proporção)" location="bottom">
              <template v-slot:activator="{ props }"><v-btn v-bind="props" value="normal"
                  icon="mdi-aspect-ratio"></v-btn></template>
            </v-tooltip>
            <v-tooltip text="Estender (Preenche e distorce)" location="bottom">
              <template v-slot:activator="{ props }"><v-btn v-bind="props" value="stretch"
                  icon="mdi-stretch-to-page-outline"></v-btn></template>
            </v-tooltip>
            <v-tooltip text="Completar (Cor da Borda Lateral)" location="bottom">
              <template v-slot:activator="{ props }"><v-btn v-bind="props" value="complete"
                  icon="mdi-format-color-fill"></v-btn></template>
            </v-tooltip>
            <v-tooltip text="Documento Vertical (A4 e Rolagem)" location="bottom">
              <template v-slot:activator="{ props }"><v-btn v-bind="props" value="document"
                  icon="mdi-text-box-search-outline"></v-btn></template>
            </v-tooltip>
          </v-btn-toggle>

          <v-divider vertical class="mx-2 my-2"></v-divider>

          <v-btn v-if="!isProjecting" color="primary" variant="flat" prepend-icon="mdi-projector"
            class="rounded-pill px-4 text-none font-weight-bold" @click="projectCurrentPage">
            Projetar PDF
          </v-btn>
          <v-btn v-else color="error" variant="flat" prepend-icon="mdi-stop"
            class="rounded-pill px-4 text-none font-weight-bold" @click="stopProjection">
            Parar Projeção
          </v-btn>

          <v-divider vertical class="mx-2 my-2"></v-divider>

          <v-btn color="bg-surface-light" variant="text" prepend-icon="mdi-arrow-left" class="rounded-pill text-none"
            @click="isOpen = false">
            Voltar
          </v-btn>
        </div>
      </v-toolbar>

      <div v-if="isLoading" class="flex-grow-1 d-flex flex-column align-center justify-center">
        <v-progress-circular indeterminate color="primary" size="64" class="mb-4"></v-progress-circular>
        <p>Processando páginas do PDF...</p>
      </div>

      <v-row v-else class="flex-grow-1 ma-0 overflow-hidden">

        <v-col cols="2" class="pa-0 border-e overflow-y-auto bg-surface h-100">
          <v-list density="compact" nav class="bg-transparent">
            <v-list-item v-for="(page, index) in pages" :key="page.pageNumber"
              :ref="(el) => { if (el) sidebarItems[index] = (el as any).$el || el }"
              :active="currentPage === page.pageNumber" color="primary"
              class="mb-2 pa-2 rounded-lg text-center cursor-pointer" @click="currentPage = page.pageNumber">
              <v-img :src="page.dataUrl" class="bg-white border rounded elevation-1 mb-1"
                style="aspect-ratio: 16/9; object-fit: contain;"></v-img>
              <span class="text-caption font-weight-bold">Página {{ page.pageNumber }}</span>
            </v-list-item>
          </v-list>
        </v-col>

        <v-col cols="10" class="pa-6 bg-grey-darken-4 position-relative h-100"
          :class="displayMode === 'document' ? 'overflow-auto text-center' : 'd-flex align-center justify-center'">
          <div class="pdf-scroll-viewport h-100 w-100" :class="{ 'allow-scroll': displayMode === 'document' }"
            @scroll="handleScroll">
            <div v-if="activePage" class="preview-container elevation-6 transition-all"
              :class="displayMode === 'document' ? 'my-4' : ''" :style="{
                backgroundColor: displayMode === 'complete' ? activePage.edgeColor : (displayMode === 'document' ? '#121212' : '#000000'),
                width: displayMode === 'document' ? `${zoomLevel}%` : '100%',
                maxWidth: displayMode === 'document' ? 'none' : '1200px',
                height: displayMode === 'document' ? 'auto' : '100%',
                aspectRatio: displayMode === 'document' ? 'auto' : '16/9',
                margin: displayMode === 'document' ? '0 auto' : '0',
                display: displayMode === 'document' ? 'inline-block' : 'flex'
              }">
              <img :src="activePage.dataUrl" class="w-100 h-100 transition-all" :style="{
                objectFit: displayMode === 'stretch' ? 'fill' : 'contain',
                display: 'block'
              }" />
            </div>

            <div class="mb-6 d-flex align-center bg-surface px-4 py-2 rounded-pill elevation-4"
              style="position: fixed; bottom: 0; left: 58%; transform: translateX(-50%); z-index: 20;">
              <v-btn icon="mdi-chevron-left" variant="text" size="small" :disabled="currentPage === 1"
                @click="currentPage--"></v-btn>
              <span class="mx-4 font-weight-bold">{{ currentPage }} / {{ pages.length }}</span>
              <v-btn icon="mdi-chevron-right" variant="text" size="small" :disabled="currentPage === pages.length"
                @click="currentPage++"></v-btn>
            </div>
          </div>
        </v-col>
      </v-row>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.pdf-scroll-viewport {
  /* Por padrão, centraliza o conteúdo (Modo Normal) */
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.pdf-scroll-viewport.allow-scroll {
  /* No modo documento, permite o scroll e alinha ao topo */
  display: block;
  /* Sai do flexbox para permitir que o conteúdo transborde */
  overflow-y: auto;
  overflow-x: auto;
  text-align: center;
  /* Centraliza a imagem horizontalmente */
}

.preview-container {
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.3s ease-in-out;
  display: inline-block;
  /* Importante para o modo documento */
  vertical-align: top;
}

.pdf-image {
  width: 100%;
  height: 100%;
  display: block;
}

.transition-all {
  transition: all 0.3s ease-in-out;
}
</style>