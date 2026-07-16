<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { type } from '@tauri-apps/plugin-os';
import { listen, emit as tauriEmit } from '@tauri-apps/api/event';
import { useMediaStore } from '../stores/mediaStore';
import { useMenuStore } from '../stores/menuStore';
import { useYoutubeStore } from '../stores/useYoutubeStore';
import { useConnectionStore } from '../stores/statusConnectionStore';
//import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import ModalAbout from "./ModalAbout.vue"
import StageMonitorMenu from '../premium-modules/stage-monitor/components/StageMonitorMenu.vue';
import TutorialView from './TutorialView.vue';

import { exit } from '@tauri-apps/plugin-process'

import { ask } from '@tauri-apps/plugin-dialog';
import NoticeManager from './header/NoticeManager.vue';
import TimerManager from './timer/TimerManager.vue';
import LiveMediaController from './media/LiveMediaController.vue';
import TransmissionMenu from '../premium-modules/transmission/TransmissionMenu.vue';

import UpdateButton from './UpdateButton.vue';

import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

const connectionStore = useConnectionStore()
const menuStore = useMenuStore();
const mediaStore = useMediaStore();
const youtubeStore = useYoutubeStore();

const ytMessage = {
  init: {
    color: 'alert',
    message: 'Iniciando o Download'
  },
  success: {
    color: 'success',
    message: 'O vídeo foi salvo com sucesso.'
  },
  error: {
    color: 'error',
    message: 'Falha ao baixar vídeo.'
  },
}

const showYtAlert = ref(false)
const typeYtStatus = ref<'init' | 'error' | 'success'>('init')

const osType = type();
const isMac = osType === 'macos';
const appWindow = getCurrentWindow();

const isFixedActive = ref(true);
const showAboutDialog = ref(false)
const showTutorialDialog = ref(false)

watch(() => mediaStore.fixedMedia, (newVal) => {
  if (newVal) isFixedActive.value = true;
});

const optionsIsVisible = computed(() => {
  return menuStore.menuOpened != 'Login'
})

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

async function sendYtSuccessNotification() {
  let checkPermission = await isPermissionGranted();

  if (!checkPermission) {
    const permission = await requestPermission();
    checkPermission = permission === 'granted';
  }

  if (checkPermission) {
    sendNotification({
      title: 'Download Concluído',
      body: 'Seus vídeos em cache foram processados com sucesso!',
    });
  }
}

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

const minimize = async () => {
  await appWindow.minimize();
};

const toggleMaximize = async () => {
  try {
    const isMaximized = await appWindow.isMaximized();

    if (isMaximized) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
  } catch (error) {
    console.error("Erro ao tentar maximizar a janela:", error);
  }
};
const close = async () => {
  const confirm = await ask('Tem certeza que deseja fechar o Sigelo?', {
    title: 'Sair do Sistema',
    kind: 'warning',
    okLabel: 'Sair',
    cancelLabel: 'Cancelar'
  });

  if (confirm) {
    await exit(0);
  }
};

// Listeners nativos do menu do OS
let unlistenImport: () => void;
let unlistenExport: () => void;

let unlistenYtStarted: () => void;
let unlistenYtProgress: () => void;
let unlistenYtFinished: () => void;
let unlistenYtError: () => void;

onMounted(async () => {
  await youtubeStore.fetchCache();
  // Registra os listeners do motor (indicador de download dos binários no header)
  await youtubeStore.initEngineListeners();
  // Por padrão, o atalho do sistema pode acionar o PDF
  unlistenImport = await listen('menu-import', () => { emit('import', 'pdf'); });
  unlistenExport = await listen('menu-export', () => { emit('export', 'pptx'); });
  unlistenYtStarted = await listen('youtube-download-started', () => {
    youtubeStore.actions.start()
    typeYtStatus.value = 'init'
    showYtAlert.value = true
  })

  unlistenYtProgress = await listen<number>('youtube-download-progress', (event) => {
    youtubeStore.actions.setProgress(event.payload)
  })

  unlistenYtFinished = await listen('youtube-download-finished', async () => {
    await youtubeStore.fetchCache();
    await mediaStore.loadMedia();
    youtubeStore.actions.finish()
    typeYtStatus.value = 'success'
    showYtAlert.value = true
    await sendYtSuccessNotification()
  })

  unlistenYtError = await listen('youtube-download-error', () => {

    youtubeStore.actions.finish()
    typeYtStatus.value = 'error'
    showYtAlert.value = true
  })
});

onUnmounted(() => {
  if (unlistenImport) unlistenImport();
  if (unlistenExport) unlistenExport();
  if (unlistenYtStarted) unlistenYtStarted();
  if (unlistenYtProgress) unlistenYtProgress();
  if (unlistenYtFinished) unlistenYtFinished();
  if (unlistenYtError) unlistenYtError();
});
</script>

<template>
  <v-app-bar height="48" elevation="0" color="surface-light" class="app-header px-4 border-b">
    <div data-tauri-drag-region class="drag-layer"></div>
    <div v-if="isMac" style="width: 70px;" data-tauri-drag-region class="z-10"></div>

    <v-tooltip text="Sobre o Sigelo" location="bottom">
      <template v-slot:activator="{ props }">
        <v-btn v-bind="props" icon="mdi-information-variant" size="small" variant="text" color="grey-darken-1"
          class="z-10 ml-2" @click="showAboutDialog = true"></v-btn>
      </template>
    </v-tooltip>
    
    
    <v-tooltip text="Rever Tutorial" location="bottom">
      <template v-slot:activator="{ props }">
        <v-btn 
          v-bind="props" 
          icon="mdi-information-outline" 
          size="small" 
          variant="text" 
          color="yellow-darken-2"
          class="z-10 ml-2" 
          @click="showTutorialDialog = true"
        ></v-btn>
      </template>
    </v-tooltip>
    
    <v-dialog v-model="showTutorialDialog" max-width="800" scrollable transition="dialog-bottom-transition">
      <v-card class="rounded-xl overflow-hidden elevation-12 border">

        <v-card-title class="d-flex align-center justify-space-between pa-4 bg-surface">
          <div class="d-flex align-center">
            <v-icon color="primary" size="small" class="mr-2">mdi-help-circle</v-icon>
            <span class="text-h6 font-weight-bold text-primary">Central de Ajuda</span>
          </div>

          <v-btn icon="mdi-close" variant="tonal" density="comfortable" color="grey-darken-1"
            @click="showTutorialDialog = false"></v-btn>
        </v-card-title>

        <v-divider no-icon></v-divider>

        <v-card-text class="pa-4 bg-background">
          <TutorialView :noIcon="true"/>
        </v-card-text>

      </v-card>
    </v-dialog>

    <UpdateButton class="z-10" />

    <v-spacer data-tauri-drag-region class="z-10"></v-spacer>

    <div class="z-10 d-flex align-center" :class="isMac ? '' : 'mr-4'">

      <v-tooltip location="bottom">
        <template v-slot:activator="{ props }">
          <div v-bind="props" class="d-flex align-center mr-4 transition-swing" style="cursor: default;">
            <v-icon
              :icon="connectionStore.hasInternet ? 'mdi-wifi' : (connectionStore.isNetworkConnected ? 'mdi-wifi-alert' : 'mdi-wifi-off')"
              :color="connectionStore.hasInternet ? 'success' : (connectionStore.isNetworkConnected ? 'warning' : 'error')"
              size="small"></v-icon>

            <v-expand-x-transition>
              <span v-if="!connectionStore.hasInternet"
                class="text-caption ml-2 font-weight-medium transition-swing text-no-wrap"
                :class="connectionStore.isNetworkConnected ? 'text-warning' : 'text-error'">
                {{ connectionStore.isNetworkConnected ? 'Sem Internet' : 'Offline' }}
              </span>
            </v-expand-x-transition>
          </div>
        </template>
        <span>
          {{ connectionStore.hasInternet ? 'Conectado à Internet' : (connectionStore.isNetworkConnected ?
            'Conectado à rede local(Sem Internet)' : 'Desconectado da rede') }}
        </span>
      </v-tooltip>
      <v-divider vertical class="mx-3 h-50 align-self-center opacity-50"></v-divider>
      <TransmissionMenu v-if="optionsIsVisible"></TransmissionMenu>
      <StageMonitorMenu v-if="optionsIsVisible"></StageMonitorMenu>
      <LiveMediaController :is-toolbar="true" v-if="optionsIsVisible"></LiveMediaController>
      <notice-manager v-if="optionsIsVisible"></notice-manager>
      <timer-manager v-if="optionsIsVisible"></timer-manager>

      <v-btn-group v-if="youtubeStore.cachedVideos.length > 0 || youtubeStore.engine.isUpdating" color="error"
        variant="tonal" density="comfortable" class="rounded-pill overflow-hidden mr-3">
        <v-menu location="bottom end" transition="slide-y-transition" :close-on-content-click="false">
          <template v-slot:activator="{ props: menuProps }">
            <v-tooltip
              :text="youtubeStore.engine.isUpdating ? 'Preparando componentes do YouTube...' : 'Vídeos em Cache'"
              location="bottom">
              <template v-slot:activator="{ props: tooltipProps }">

                <!-- Adicionamos a classe 'overflow-hidden' para garantir que a barra não vaze pelas bordas arredondadas -->
                <v-btn v-bind="{ ...menuProps, ...tooltipProps }" prepend-icon="mdi-youtube" class="overflow-hidden">
                  <!-- Motor baixando e ainda sem vídeos: mostra spinner no lugar da contagem -->
                  <v-progress-circular
                    v-if="youtubeStore.engine.isUpdating && youtubeStore.cachedVideos.length === 0" indeterminate
                    size="16" width="2" class="ml-1" />
                  <template v-else>
                    {{ youtubeStore.cachedVideos.length }}
                  </template>

                  <!-- Barra: indeterminada p/ o motor, determinada p/ o vídeo -->
                  <v-progress-linear v-if="youtubeStore.engine.isUpdating" indeterminate color="amber-darken-2"
                    height="3" absolute bottom />
                  <v-progress-linear v-else-if="youtubeStore.state.downloading"
                    :model-value="youtubeStore.state.progress" height="3" absolute bottom />
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

            <!-- Faixa de status do motor (download dos binários) -->
            <div v-if="youtubeStore.engine.isUpdating"
              class="px-4 py-2 border-b d-flex align-center text-caption bg-amber-lighten-5">
              <v-progress-circular indeterminate size="16" width="2" color="amber-darken-2"
                class="mr-2" />
              Preparando componentes... {{ youtubeStore.engine.progress }} de {{ youtubeStore.engine.total }}
            </div>
            <div v-else-if="youtubeStore.engine.error"
              class="px-4 py-2 border-b d-flex align-center justify-space-between text-caption bg-red-lighten-5 text-error">
              <span class="text-truncate mr-2">{{ youtubeStore.engine.error }}</span>
              <v-btn size="x-small" variant="flat" color="error" @click="youtubeStore.updateEngine()">Repetir</v-btn>
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
              </v-list-item>

              <!-- Vazio: só o motor baixando, ainda sem vídeos -->
              <v-list-item v-if="youtubeStore.cachedVideos.length === 0 && !youtubeStore.engine.isUpdating"
                class="pa-4 text-center text-caption text-medium-emphasis">
                Nenhum vídeo em cache ainda.
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

              <div class="d-flex gap-22">
                <v-btn :color="isFixedActive ? 'warning' : 'success'" variant="tonal" size="small"
                  class="flex-grow-1 mr-2 mt-1" :prepend-icon="isFixedActive ? 'mdi-eye-off' : 'mdi-eye'"
                  @click="toggleFixedMedia">
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
        class="rounded-pill overflow-hidden bg-surface-light" v-if="optionsIsVisible">

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
    <modal-about v-model="showAboutDialog"></modal-about>

    <div v-if="!isMac" class="window-controls z-10 d-flex align-center">
      <v-btn icon="mdi-minus" variant="text" size="small" class="window-btn" @click="minimize"></v-btn>
      <v-btn icon="mdi-crop-square" variant="text" size="small" class="window-btn" @click="toggleMaximize"></v-btn>
      <v-btn icon="mdi-close" variant="text" size="small" class="window-btn btn-close" @click="close"></v-btn>
    </div>
  </v-app-bar>
  <v-snackbar v-model="showYtAlert" :color="ytMessage[typeYtStatus].color" elevation="24" rounded="pill"
    :timeout="3000">
    <v-icon start icon="mdi-check-circle"></v-icon>
    {{ ytMessage[typeYtStatus].message }}

    <template v-slot:actions>
      <v-btn variant="text" @click="showYtAlert = false">Fechar</v-btn>
    </template>
  </v-snackbar>
</template>

<style scoped>
.app-header {
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08) !important;

  user-select: none !important;
  -webkit-user-select: none !important;
  cursor: default !important;
  z-index: 50;
}

.drag-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  cursor: default !important;
}

.z-10 {
  z-index: 10;
  position: relative;
}

.window-controls {
  gap: 4px;
  margin-right: -4px;
}

.window-btn {
  border-radius: 0 !important;
  width: 32px !important;
  height: 32px !important;
  color: inherit;
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