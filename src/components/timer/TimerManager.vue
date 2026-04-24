<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useTimerStore } from '../../stores/timerStore';
import { useMediaStore } from '../../stores/mediaStore';
import FontSelector from '../utils/FontSelector.vue';
import { invoke } from '@tauri-apps/api/core';
import SmartVideo from '../SmartVideo.vue';

const timerStore = useTimerStore();
const mediaStore = useMediaStore();

const menuOpen = ref(false);
const tab = ref('config');

// Controle de Pausa Rápido
const togglePauseTimer = async () => {
  timerStore.isPaused = !timerStore.isPaused;
  await invoke('sync_timer_playback', {
    action: timerStore.isPaused ? 'pause' : 'resume',
    timeRemaining: timerStore.timeRemaining
  });
};

// ==========================================
// ESTADO DO PAINEL DE MÍDIA (EXPANSÃO)
// ==========================================
const isSelectingMedia = ref(false); // Substitui o antigo isMediaModalOpen
const selectionTarget = ref<'background' | 'after-timer' | null>(null);

const mediaSearch = ref('');
const filterContext = ref<'All' | 'Media' | 'Theme' | 'YouTube'>('All');
const filterTag = ref<string | null>(null);

const contexts = [
  { title: 'Todas as Mídias', value: 'All' },
  { title: 'Fundo de Slides (Theme)', value: 'Theme' },
  { title: 'Vídeos/Imagens (Media)', value: 'Media' },
  { title: 'YouTube', value: 'YouTube' }
];

const filteredMediaList = computed(() => {
  let list = [...mediaStore.mediaFiles];
  console.log(list)

  if (filterContext.value === 'Theme') {
    list = list.filter(m => m.type === 'Theme');
  } else if (filterContext.value === 'Media') {
    list = list.filter(m => m.type === 'Media' && m.category !== 'YouTube');
  } else if (filterContext.value === 'YouTube') {
    list = list.filter(m => m.category === 'YouTube');
  }

  if (filterTag.value) {
    list = list.filter(m => {
      const tags = mediaStore.tagsByFiles[m.id];
      return tags && tags.includes(filterTag.value!);
    });
  }

  if (mediaSearch.value) {
    const q = mediaSearch.value.toLowerCase();
    list = list.filter(m => m.name.toLowerCase().includes(q));
  }

  return list;
});

const openMediaSelector = (target: 'background' | 'after-timer') => {
  selectionTarget.value = target;
  isSelectingMedia.value = true; // Expande o menu
};

const selectMedia = (file: any) => {
  if (selectionTarget.value === 'background') {
    timerStore.bgMediaUrl = file.url;
    timerStore.bgIsVideo = file.isVideo;
  } else if (selectionTarget.value === 'after-timer') {
    timerStore.mediaAfterUrl = file.url;
  }
  isSelectingMedia.value = false; // Retrai o menu de volta
};

const cancelMediaSelection = () => {
  isSelectingMedia.value = false;
};

const getSelectedMediaName = (url: string) => {
  if (!url) return '';
  const f = mediaStore.mediaFiles.find(m => m.url === url);
  return f ? f.name : 'Mídia Selecionada';
};

// ==========================================
// PREVIEW VISUAL
// ==========================================
const previewBgStyle = computed(() => {
  if (timerStore.bgType === 'gradient' && timerStore.gradientColors?.length === 2) {
    return {
      background: `linear-gradient(135deg, ${timerStore.gradientColors[0]}, ${timerStore.gradientColors[1]})`
    };
  }
  return {};
});

const previewTime = computed(() => {
  if (timerStore.timerMode === 'clock') {
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  const m = Math.floor(timerStore.durationSecs / 60).toString().padStart(2, '0');
  const s = (timerStore.durationSecs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
});

watch(() => timerStore.isFinished, (newValue) => {
  console.log("timer", newValue)
  if(newValue) {
      menuOpen.value = false
      timerStore.isFinished = false
  }
})

onMounted(() => {
  if (mediaStore.mediaFiles.length === 0) {
    mediaStore.loadMedia();
  }
})
</script>

<template>
  <div class="d-flex align-center">

    <v-expand-x-transition>
      <div v-if="timerStore.isActive"
        class="d-flex align-center bg-surface-variant rounded-pill pl-3 pr-1 py-1 mr-2 border shadow-sm"
        style="height: 36px;">

        <span class="text-caption font-weight-bold text-primary mr-3 cursor-pointer d-inline-block text-truncate"
          style="min-width: 40px; text-align: center;">
          {{ timerStore.formattedTime }}
        </span>

        <v-divider vertical class="mx-1" style="height: 16px;"></v-divider>

        <v-btn :icon="timerStore.isPaused ? 'mdi-play' : 'mdi-pause'" size="x-small" variant="text"
          color="medium-emphasis" @click="togglePauseTimer"></v-btn>

        <v-btn icon="mdi-stop" size="x-small" variant="text" color="error" @click="timerStore.stopTimer"></v-btn>
      </div>
    </v-expand-x-transition>

    <v-menu v-model="menuOpen" :close-on-content-click="false" location="bottom end" transition="slide-y-transition">
      <template v-slot:activator="{ props: menuProps }">
        <v-tooltip text="Timer Regressivo" location="bottom">
          <template v-slot:activator="{ props: tooltipProps }">
            <v-btn v-bind="{ ...menuProps, ...tooltipProps }" icon size="small" variant="text"
              :color="timerStore.isActive ? 'primary' : 'medium-emphasis'"
              :class="{ 'timer-pulse': timerStore.isActive && !timerStore.isPaused }">
              <v-icon>mdi-timer-outline</v-icon>
              <v-badge v-if="timerStore.isActive" dot color="primary" floating></v-badge>
            </v-btn>
          </template>
        </v-tooltip>
      </template>

      <v-card class="rounded-lg border elevation-4 mt-2 transition-width" :width="isSelectingMedia ? 850 : 420">

        <v-slide-x-reverse-transition mode="out-in">
          <div v-if="!isSelectingMedia" key="settings-view">
            <v-tabs v-model="tab" grow density="compact" color="primary">
              <v-tab value="config">Controles</v-tab>
              <v-tab value="style">Visual</v-tab>
            </v-tabs>
            <v-divider></v-divider>

            <v-window v-model="tab">
              <v-window-item value="config" class="pa-4">

                <div class="mb-4">
                  <p class="text-caption mb-1 font-weight-medium">Modo de Operação</p>
                  <v-btn-toggle v-model="timerStore.timerMode" mandatory divided variant="outlined" density="compact"
                    class="w-100 bg-surface">
                    <v-btn value="countdown" class="flex-grow-1 text-caption"><v-icon size="small"
                        class="mr-1">mdi-timer-sand</v-icon> Regressiva</v-btn>
                    <v-btn value="clock" class="flex-grow-1 text-caption"><v-icon size="small"
                        class="mr-1">mdi-clock-outline</v-icon> Hora Atual</v-btn>
                  </v-btn-toggle>
                </div>

                <v-expand-transition>
                  <div v-show="timerStore.timerMode === 'countdown'">
                    <v-text-field v-model.number="timerStore.durationSecs" label="Duração Inicial (Segundos)"
                      type="number" variant="outlined" density="compact" class="mb-3"></v-text-field>

                    <p class="text-caption font-weight-bold mb-2">Ação ao zerar o relógio:</p>

                    <v-card v-if="timerStore.mediaAfterUrl" variant="outlined"
                      class="pa-2 d-flex align-center mb-1 border-primary bg-surface-light">
                      <v-icon size="small" color="primary" class="mr-2">mdi-play-circle</v-icon>
                      <div class="text-truncate text-caption flex-grow-1 font-weight-medium"
                        :title="getSelectedMediaName(timerStore.mediaAfterUrl)">
                        {{ getSelectedMediaName(timerStore.mediaAfterUrl) }}
                      </div>
                      <v-btn icon="mdi-close" size="x-small" variant="text" color="error" title="Remover Mídia"
                        @click="timerStore.mediaAfterUrl = ''"></v-btn>
                    </v-card>

                    <v-btn v-else block size="small" variant="tonal" prepend-icon="mdi-video-plus"
                      @click="openMediaSelector('after-timer')">
                      Selecionar Mídia Automática
                    </v-btn>
                  </div>
                </v-expand-transition>
              </v-window-item>

              <v-window-item value="style" class="pa-4">
                <div class="timer-preview-container mb-4 elevation-2 rounded-lg border">
                  <div class="preview-bg" :style="previewBgStyle">
                    <v-img v-if="timerStore.bgType === 'media' && !timerStore.bgIsVideo && timerStore.bgMediaUrl"
                      :src="timerStore.bgMediaUrl" cover class="w-100 h-100"></v-img>
                    <smart-video v-if="timerStore.bgType === 'media' && timerStore.bgIsVideo && timerStore.bgMediaUrl"
                      :src="timerStore.bgMediaUrl" class="w-100 h-100 object-cover" muted loop autoplay
                      playsinline></smart-video>
                    <div v-if="timerStore.bgType === 'media'" class="preview-overlay"></div>
                  </div>
                  <div class="preview-text-layer" :class="`pos-${timerStore.position}`">
                    <span :style="{ fontFamily: `'${timerStore.fontFamily}', sans-serif` }">{{ previewTime }}</span>
                  </div>
                </div>

                <div class="mb-4">
                  <p class="text-caption mb-1 font-weight-medium">Fonte do Relógio</p>
                  <font-selector v-model="timerStore.fontFamily"></font-selector>
                </div>

                <div class="mb-4">
                  <p class="text-caption mb-1 font-weight-medium">Alinhamento na Tela</p>
                  <v-btn-toggle v-model="timerStore.position" mandatory divided variant="outlined" density="compact"
                    class="w-100 bg-surface">
                    <v-btn value="top" class="flex-grow-1 text-caption"><v-icon size="small"
                        class="mr-1">mdi-align-vertical-top</v-icon> Topo</v-btn>
                    <v-btn value="center" class="flex-grow-1 text-caption"><v-icon size="small"
                        class="mr-1">mdi-align-vertical-center</v-icon> Centro</v-btn>
                    <v-btn value="bottom" class="flex-grow-1 text-caption"><v-icon size="small"
                        class="mr-1">mdi-align-vertical-bottom</v-icon> Base</v-btn>
                  </v-btn-toggle>
                </div>

                <div>
                  <p class="text-caption mb-1 font-weight-medium">Fundo</p>
                  <v-btn-toggle v-model="timerStore.bgType" mandatory divided variant="outlined" density="compact"
                    class="w-100 mb-3 bg-surface">
                    <v-btn value="gradient" class="flex-grow-1 text-caption"><v-icon size="small"
                        class="mr-1">mdi-gradient-vertical</v-icon> Gradiente</v-btn>
                    <v-btn value="media" class="flex-grow-1 text-caption"><v-icon size="small"
                        class="mr-1">mdi-image-multiple</v-icon> Imagem/Vídeo</v-btn>
                  </v-btn-toggle>

                  <v-expand-transition>
                    <div v-if="timerStore.bgType === 'gradient'" class="d-flex gap-2">
                      <input type="color" v-model="timerStore.gradientColors[0]"
                        class="flex-grow-1 cursor-pointer border rounded" style="height: 36px; padding: 2px;">
                      <input type="color" v-model="timerStore.gradientColors[1]"
                        class="flex-grow-1 cursor-pointer border rounded" style="height: 36px; padding: 2px;">
                    </div>

                    <div v-else>
                      <v-card v-if="timerStore.bgMediaUrl" variant="outlined"
                        class="pa-2 d-flex align-center border-primary bg-surface-light">
                        <v-icon size="small" color="primary" class="mr-2">{{ timerStore.bgIsVideo ? 'mdi-video' :
                          'mdi-image'
                        }}</v-icon>
                        <div class="text-truncate text-caption flex-grow-1 font-weight-medium">
                          {{ getSelectedMediaName(timerStore.bgMediaUrl) }}
                        </div>
                        <v-btn icon="mdi-close" size="x-small" variant="text" color="error"
                          @click="timerStore.bgMediaUrl = ''"></v-btn>
                      </v-card>
                      <v-btn v-else block size="small" variant="tonal" prepend-icon="mdi-image-search"
                        @click="openMediaSelector('background')">
                        Escolher Imagem/Vídeo
                      </v-btn>
                    </div>
                  </v-expand-transition>
                </div>
              </v-window-item>
            </v-window>

            <v-divider></v-divider>
            <v-card-actions class="bg-surface-light px-4 py-2">
              <v-btn v-if="timerStore.isActive" color="error" variant="text" size="small"
                @click="timerStore.stopTimer">Parar
                Projeção</v-btn>
              <v-spacer></v-spacer>
              <v-btn color="primary" variant="flat" size="small" @click="timerStore.startTimer">
                {{ timerStore.isActive ? 'Reiniciar' : 'Projetar Timer' }}
              </v-btn>
            </v-card-actions>
          </div>

          <div v-else key="media-view" class="d-flex flex-column" style="height: 600px;">
            <v-toolbar color="surface-light" density="compact" class="border-b flex-shrink-0">
              <v-btn icon="mdi-arrow-left" variant="text" size="small" class="mr-2"
                @click="cancelMediaSelection"></v-btn>
              <v-toolbar-title class="text-subtitle-2 font-weight-bold">
                {{ selectionTarget === 'background' ? 'Selecionar Fundo do Timer' : 'Selecionar Mídia Automática' }}
              </v-toolbar-title>
            </v-toolbar>

            <div class="pa-3 bg-surface-variant border-b flex-shrink-0">
              <v-row density="comfortable" align="center">
                <v-col cols="12" md="4">
                  <v-text-field v-model="mediaSearch" density="compact" variant="solo" flat hide-details
                    placeholder="Buscar mídia..." prepend-inner-icon="mdi-magnify"
                    class="border rounded bg-surface"></v-text-field>
                </v-col>
                <v-col cols="12" md="4">
                  <v-select v-model="filterContext" :items="contexts" density="compact" variant="solo" flat hide-details
                    class="border rounded bg-surface" prepend-inner-icon="mdi-filter"></v-select>
                </v-col>
                <v-col cols="12" md="4">
                  <v-select v-model="filterTag" :items="mediaStore.allTags" density="compact" variant="solo" flat
                    hide-details clearable placeholder="Filtrar por Tag" class="border rounded bg-surface"
                    prepend-inner-icon="mdi-tag"></v-select>
                </v-col>
              </v-row>
            </div>

            <div class="pa-4 bg-surface flex-grow-1" style="overflow-y: auto;">
              <div v-if="filteredMediaList.length === 0"
                class="w-100 h-100 d-flex flex-column align-center justify-center opacity-60">
                <v-icon size="64" class="mb-4">mdi-file-hidden</v-icon>
                <span class="text-body-1">Nenhuma mídia encontrada.</span>
              </div>

              <v-row v-else density="comfortable">
                <v-col cols="6" sm="4" md="3" lg="3" v-for="file in filteredMediaList" :key="file.id">
                  <v-card @click="selectMedia(file)" hover
                    class="h-100 d-flex flex-column border overflow-hidden cursor-pointer">
                    <div class="bg-black position-relative" style="aspect-ratio: 16/9;">
                      <smart-video v-if="file.isVideo" :src="file.url" class="w-100 h-100"
                        style="object-fit: cover;" muted preview-only></smart-video>
                      <v-img v-else :src="file.url" cover class="w-100 h-100"></v-img>

                      <div v-if="file.category === 'YouTube'" class="position-absolute top-0 right-0 ma-1">
                        <v-icon color="red" size="small" class="bg-white rounded-circle">mdi-youtube</v-icon>
                      </div>
                      <div v-else-if="file.isVideo" class="position-absolute bottom-0 left-0 ma-1">
                        <v-icon color="white" size="small"
                          style="filter: drop-shadow(0 0 2px black);">mdi-video</v-icon>
                      </div>
                    </div>

                    <div class="pa-2 flex-grow-1 d-flex flex-column justify-center bg-surface-light">
                      <div class="text-caption font-weight-bold text-truncate" :title="file.name">
                        {{ file.name }}
                      </div>
                    </div>
                  </v-card>
                </v-col>
              </v-row>
            </div>
          </div>
        </v-slide-x-reverse-transition>

      </v-card>
    </v-menu>

  </div>
</template>

<style scoped>
.gap-2 {
  gap: 8px;
}

/* Animação suave para a largura do card do Menu */
.transition-width {
  transition: width 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

/* Animação do botão principal */
.timer-pulse {
  animation: pulse-primary 2.5s infinite;
}

@keyframes pulse-primary {
  0% {
    transform: scale(1);
    opacity: 1;
  }

  50% {
    transform: scale(1.1);
    opacity: 0.8;
    color: rgb(var(--v-theme-primary));
  }

  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Preview Visual */
.timer-preview-container {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background-color: #000;
  overflow: hidden;
}

.preview-bg {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.preview-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 2;
}

.preview-text-layer {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  justify-content: center;
  padding: 5%;
}

.preview-text-layer span {
  font-size: 3rem;
  font-weight: 800;
  color: white;
  text-shadow: 0 4px 15px rgba(0, 0, 0, 0.9);
  line-height: 1;
}

.pos-top {
  align-items: flex-start;
}

.pos-center {
  align-items: center;
}

.pos-bottom {
  align-items: flex-end;
}

.object-cover {
  object-fit: cover;
}
</style>