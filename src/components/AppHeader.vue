<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { type } from '@tauri-apps/plugin-os';
import { listen, emit as tauriEmit } from '@tauri-apps/api/event';
import { useMediaStore, MediaFile } from '../stores/mediaStore';
import { useMenuStore } from '../stores/menuStore';
import { useYoutubeStore } from '../stores/useYoutubeStore';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';

const menuStore = useMenuStore();
const mediaStore = useMediaStore();
const youtubeStore = useYoutubeStore();

const osType = type();
const isMac = osType === 'macos';
const appWindow = getCurrentWindow();

const isFixedActive = ref(true);

watch(() => mediaStore.fixedMedia, (newVal) => {
  if (newVal) isFixedActive.value = true;
});

const toggleFixedMedia = async () => {
  isFixedActive.value = !isFixedActive.value;
  if (isFixedActive.value) {
    await tauriEmit('clear-projection')
  } else {
    await tauriEmit('clear-projection', true);
  }
};

const removeFixedMedia = async () => {
  mediaStore.fixedMedia = null;
  isFixedActive.value = true;
  await tauriEmit('set-fixed-media', null);
  await tauriEmit('clear-projection');
};

const formatDuration = (seconds: number | undefined) => {
  if (!seconds) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

/*
const projectYoutubeVideo = async (video: MediaFile) => {
  console.log(video)
  // Converte o caminho físico do disco para um caminho que a tag <video> do Vue consiga ler
  const webPath = convertFileSrc(video.path);
  console.log(video)

  // Você pode enviar para o seu mediaStore como Fundo Fixo ou para o PresentationStore
  mediaStore.setFixedMedia(video);

  // O seu watch do 'mediaStore.fixedMedia' no AppHeader já vai cuidar de projetar!
}; */

const openCacheFolder = async () => {
  try {
    await invoke('open_youtube_cache_folder');
  } catch (error) {
    console.error("Erro ao abrir pasta do cache:", error);
  }
};

// ATUALIZADO: Agora os emits enviam o "tipo" de ação
const emit = defineEmits<{
  (e: 'import', type: 'pdf' | 'youtube'): void;
  (e: 'export', type: 'pptx' | 'pdf'): void;
}>();

const minimize = () => appWindow.minimize();
const toggleMaximize = () => appWindow.toggleMaximize();
const close = () => appWindow.close();

// Listeners nativos do menu do OS
let unlistenImport: () => void;
let unlistenExport: () => void;

onMounted(async () => {
  await youtubeStore.fetchCache();
  // Por padrão, o atalho do sistema pode acionar o PDF
  unlistenImport = await listen('menu-import', () => { emit('import', 'pdf'); });
  unlistenExport = await listen('menu-export', () => { emit('export', 'pptx'); });
});

onUnmounted(() => {
  if (unlistenImport) unlistenImport();
  if (unlistenExport) unlistenExport();
});
</script>

<template>
  <v-app-bar height="48" elevation="0" color="surface-light" class="app-header px-4 border-b"
    v-if="menuStore.menuOpened !== 'PdfPresenter'">
    <div data-tauri-drag-region class="drag-layer"></div>
    <div v-if="isMac" style="width: 70px;" data-tauri-drag-region class="z-10"></div>
    <v-spacer data-tauri-drag-region class="z-10"></v-spacer>

    <div class="z-10 d-flex align-center" :class="isMac ? '' : 'mr-4'">
      <v-btn-group v-if="true" color="error" variant="tonal" density="comfortable"
        class="rounded-pill overflow-hidden mr-3">
        <v-menu location="bottom end" transition="slide-y-transition" :close-on-content-click="false">
          <template v-slot:activator="{ props: menuProps }">
            <v-tooltip text="Vídeos em Cache" location="bottom">
              <template v-slot:activator="{ props: tooltipProps }">
                <v-btn v-bind="{ ...menuProps, ...tooltipProps }" prepend-icon="mdi-youtube">
                  {{ youtubeStore.cachedVideos.length }}
                </v-btn>
              </template>
            </v-tooltip>
          </template>

          <v-card min-width="320" max-width="400" class="elevation-4 border rounded-lg mt-2">
            <div
              class="bg-surface-light px-4 py-1 border-b d-flex align-center justify-space-between text-subtitle-2 font-weight-bold">
              <div class="d-flex align-center">
                <v-icon size="small" color="error" class="mr-2">mdi-youtube</v-icon>
                <span>Arquivos do YouTube</span>
              </div>

              <v-tooltip text="Abrir pasta no computador" location="top">
                <template v-slot:activator="{ props }">
                  <v-btn v-bind="props" icon="mdi-folder-open-outline" variant="text" size="small"
                    color="medium-emphasis" @click="openCacheFolder"></v-btn>
                </template>
              </v-tooltip>
            </div>

            <v-list density="compact" lines="two" class="pa-0" max-height="400" style="overflow-y: auto;">
              <v-list-item v-for="video in youtubeStore.cachedVideos" :key="video.name" class="border-b pa-3">
                <template v-slot:prepend>
                  <v-img :src="video.thumbnailUrl" width="80" height="45"
                    class="rounded mr-3 bg-grey-darken-4 elevation-1" cover>
                    <v-icon v-if="!video.thumbnailUrl" color="grey-lighten-1"
                      class="w-100 h-100 d-flex align-center justify-center">
                      mdi-youtube
                    </v-icon>
                  </v-img>
                </template>

                <v-list-item-title class="font-weight-bold text-subtitle-2 text-truncate" :title="video.name">
                  {{ video.name }}
                </v-list-item-title>

                <v-list-item-subtitle class="text-caption text-medium-emphasis mt-1">
                  <v-icon size="x-small" class="mr-1">mdi-clock-outline</v-icon>
                  {{ formatDuration(video.duration) }}
                  <span class="mx-1">•</span>
                  <v-icon size="x-small" class="mr-1">mdi-harddisk</v-icon>
                  {{ video.size_mb }} MB
                </v-list-item-subtitle>

                <!--
                <template v-slot:append>
                  <div class="d-flex align-center gap-1">
                    <v-tooltip text="Projetar como Fundo" location="top">
                      <template v-slot:activator="{ props }">
                        <v-btn v-bind="props" icon="mdi-play-box-outline" variant="text" color="primary" size="small"
                          @click="projectYoutubeVideo(video)"></v-btn>
                      </template>
                    </v-tooltip>

                    <v-tooltip text="Excluir do Cache" location="top">
                      <template v-slot:activator="{ props }">
                        <v-btn v-bind="props" icon="mdi-trash-can-outline" variant="text" color="error" size="small"
                          @click="youtubeStore.deleteVideo(video.name)"></v-btn>
                      </template>
                    </v-tooltip>
                  </div>
                </template> -->
              </v-list-item>
            </v-list>
          </v-card>
        </v-menu>
      </v-btn-group>
      <v-btn-group v-if="mediaStore.fixedMedia" :color="isFixedActive ? 'success' : 'grey-darken-2'"
        class="overflow-hidden rounded mr-3" density="comfortable" variant="flat">
        <v-menu location="bottom end" :close-on-content-click="false" transition="slide-y-transition">

          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" :icon="isFixedActive ? 'mdi-pin' : 'mdi-pin-off'"
              title="Gerenciar Fundo Fixo"></v-btn>
          </template>

          <v-card min-width="240" max-width="280" class="mt-2 rounded-lg elevation-8 border bg-surface">
            <div :class="isFixedActive ? 'bg-success' : 'bg-surface-variant'"
              class="px-3 py-1 text-caption font-weight-bold d-flex align-center transition-all">
              <v-icon start size="small">mdi-monitor-dashboard</v-icon>
              {{ isFixedActive ? 'FUNDO FIXO ATIVO' : 'FUNDO FIXO PAUSADO' }}
            </div>

            <div class="pa-3">
              <div class="rounded overflow-hidden bg-black position-relative elevation-2 mb-2"
                style="aspect-ratio: 16/9;">
                <video v-if="mediaStore.fixedMedia.isVideo" :src="`${mediaStore.fixedMedia.url}#t=0.5`"
                  class="w-100 h-100 object-cover" muted></video>
                <v-img v-else :src="mediaStore.fixedMedia.url" cover class="w-100 h-100"></v-img>

                <div v-if="!isFixedActive"
                  class="position-absolute top-0 left-0 w-100 h-100 d-flex align-center justify-center"
                  style="background: rgba(0,0,0,0.6)">
                  <v-icon color="white" size="large">mdi-eye-off</v-icon>
                </div>
              </div>

              <div class="text-caption text-truncate mb-3 text-center font-weight-medium"
                :title="mediaStore.fixedMedia.name">
                {{ mediaStore.fixedMedia.name }}
              </div>

              <v-divider class="mb-3"></v-divider>

              <div class="d-flex gap-2">
                <v-btn :color="isFixedActive ? 'warning' : 'success'" variant="tonal" size="small" class="flex-grow-1"
                  :prepend-icon="isFixedActive ? 'mdi-eye-off' : 'mdi-eye'" @click="toggleFixedMedia">
                  {{ isFixedActive ? 'Ocultar' : 'Exibir' }}
                </v-btn>

                <v-btn color="error" variant="tonal" size="small" icon="mdi-delete" @click="removeFixedMedia"
                  title="Remover"></v-btn>
              </div>
            </div>
          </v-card>
        </v-menu>
      </v-btn-group>

      <v-btn-group color="primary" variant="outlined" density="comfortable" divided
        class="rounded-pill overflow-hidden bg-surface-light">

        <v-menu location="bottom end" transition="slide-y-transition">
          <template v-slot:activator="{ props: menuProps }">
            <v-tooltip text="Importar..." location="bottom">
              <template v-slot:activator="{ props: tooltipProps }">
                <v-btn v-bind="{ ...menuProps, ...tooltipProps }" icon="mdi-import"></v-btn>
              </template>
            </v-tooltip>
          </template>
          <v-list density="compact" min-width="180" class="elevation-3 border">
            <v-list-item prepend-icon="mdi-file-pdf-box" title="Arquivo PDF"
              @click="emit('import', 'pdf')"></v-list-item>
            <v-list-item prepend-icon="mdi-youtube" title="Vídeo do YouTube"
              @click="emit('import', 'youtube')"></v-list-item>
          </v-list>
        </v-menu>

        <v-menu location="bottom end" transition="slide-y-transition">
          <template v-slot:activator="{ props: menuProps }">
            <v-tooltip text="Exportar..." location="bottom">
              <template v-slot:activator="{ props: tooltipProps }">
                <v-btn v-bind="{ ...menuProps, ...tooltipProps }" icon="mdi-export"></v-btn>
              </template>
            </v-tooltip>
          </template>
          <v-list density="compact" min-width="180" class="elevation-3 border">
            <v-list-item prepend-icon="mdi-presentation" title="PowerPoint (PPTX)"
              @click="emit('export', 'pptx')"></v-list-item>
            <v-list-item prepend-icon="mdi-file-pdf-box" title="Arquivo PDF"
              @click="emit('export', 'pdf')"></v-list-item>
          </v-list>
        </v-menu>

      </v-btn-group>
    </div>

    <div v-if="!isMac" class="window-controls z-10 d-flex align-center">
      <v-btn icon="mdi-window-minimize" variant="text" class="window-btn" @click="minimize"></v-btn>
      <v-btn icon="mdi-window-maximize" variant="text" class="window-btn" @click="toggleMaximize"></v-btn>
      <v-btn icon="mdi-close" variant="text" class="window-btn btn-close" @click="close"></v-btn>
    </div>
  </v-app-bar>
</template>

<style scoped>
.app-header {
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08) !important;

  /* MÁGICA 2: Mata qualquer comportamento de seleção de texto nativo */
  user-select: none !important;
  -webkit-user-select: none !important;
  cursor: default !important;
  /* Trava o cursor como setinha */
  z-index: 50;
}

/* Oculta completamente a camada extra do layout visual, mas captura cliques */
.drag-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  /* Fica atrás de tudo no header */
  cursor: default !important;
}

.z-10 {
  z-index: 10;
  position: relative;
  /* Necessário para que o z-index funcione e fique sobre a drag-layer */
}

/* Container flexível para os controles nativos */
.window-controls {
  gap: 4px;
  margin-right: -4px;
}

/* Força as dimensões do botão para garantir o alinhamento perfeito */
.window-btn {
  border-radius: 0 !important;
  width: 32px !important;
  height: 32px !important;
  color: inherit;
  /* Garante que botões não deixem arrastar a tela acidentalmente */
  -webkit-app-region: no-drag;
}

.window-btn:hover {
  background-color: rgb(var(--v-theme-error)) !important;
  color: white !important;
}

.btn-close:hover {
  background-color: #e81123 !important;
  color: white !important;
}
</style>