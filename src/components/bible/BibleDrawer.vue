<script setup lang="ts">
import { computed, watch, ref, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import FontSelector from '../utils/FontSelector.vue';
import { useBibleStore } from '../../stores/useBibleStore';
import { useStatusPresentationStore } from '../../stores/statusPresentationStore';
import { useMenuStore } from "../../stores/menuStore";
import { useMediaStore, type MediaFile } from "../../stores/mediaStore";
import SmartVideo from '../SmartVideo.vue';

const emit = defineEmits(['project', 'close']);

// Stores
const bibleStore = useBibleStore();
const mediaStore = useMediaStore();
const menuStore = useMenuStore();
const statusPresStore = useStatusPresentationStore();

// Extraindo reatividade da Store
const {
  step, selectedBook, selectedChapter, verseStart, verseEnd, fetchedData, searchQuery,
  currentSlideIndex, projectionSettings, filteredBooks, availableVerses, bibleSlides, maxBibleFontSize
} = storeToRefs(bibleStore);

// Estado Local de UI
const isOpen = ref(false);
const currentTab = ref('texto');
const isCustomColor = ref(true);
const fileInput = ref({ click: () => { } });

// Computando mídias locais disponíveis
const bibleMedia = computed(() => {
  return mediaStore.themeFiles.filter(it => {
    if (mediaStore.tagsByFiles[it.id]) return mediaStore.tagsByFiles[it.id].includes('Bíblia');
    else return false;
  })
});

// ABRIR O DRAWER (Inteligente)
const open = async (reference?: { abbr: string, chapter: number, verses?: string }) => {
  isOpen.value = isOpen.value ? false : true; 
  if (reference) {
    await bibleStore.loadReference(reference);
  }
};

const close = () => {
  if (step.value === 'projecting') bibleStore.stopProjection();
  isOpen.value = false;
};

// Navegação UI -> Actions Pinia
const selectBook = (book: any) => { selectedBook.value = book; searchQuery.value = ''; step.value = 'chapter'; };
const selectChapter = (chapterIndex: number) => { selectedChapter.value = chapterIndex; verseStart.value = 1; verseEnd.value = bibleStore.totalVersesInChapter; step.value = 'verse'; };
const confirmVerses = () => bibleStore.fetchBibleText(selectedBook.value.abbr, false);
const selectWholeChapter = () => bibleStore.fetchBibleText(selectedBook.value.abbr, true);

const onSearchEnter = () => {
  if (filteredBooks.value.length === 1) selectBook(filteredBooks.value[0]);
  menuStore.setShiftShortcutLocked(false);
};

// Lidar com Mídias UI
const handleFileUpload = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) {
    projectionSettings.value.bgType = 'upload';
    projectionSettings.value.bgMedia = URL.createObjectURL(file);
    projectionSettings.value.bgIsVideo = file.type.startsWith('video/');
  }
};

const selectLocalMedia = (mediaFile: MediaFile) => {
  console.log("mediaFile", mediaFile)
  projectionSettings.value.bgMedia = mediaFile.url;
  projectionSettings.value.bgIsVideo = mediaFile.isVideo;
  projectionSettings.value.bgType = 'saved';
  isCustomColor.value = false;
};

// Controles de Teclado
const handleKeydown = (e: KeyboardEvent) => {
  if (step.value !== 'projecting' && statusPresStore.status.isPresentation !== 'Biblia') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault(); 
    bibleStore.nextSlide();
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    bibleStore.prevSlide();
  }
  if (e.key === 'Escape') {
    bibleStore.stopProjection();
  }
};

watch(isOpen, (newVal) => {
  window.removeEventListener('keydown', handleKeydown);
  
  // 2. Só adiciona novamente se a gaveta estiver aberta
  if (newVal) {
    window.addEventListener('keydown', handleKeydown);
  }
});

defineExpose({ open, close });

const handleBlur = () => menuStore.setShiftShortcutLocked(false);
const handleFocus = () => menuStore.setShiftShortcutLocked(true);

onMounted(() => {
  bibleStore.loadSettings();
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <v-navigation-drawer v-model="isOpen" location="right" temporary width="450" elevation="6">

    <div class="d-flex flex-column h-100 overflow-hidden" v-if="isOpen">

      <v-toolbar :color="step === 'projecting' ? 'error' : 'primary'" density="compact"
        class="text-white border-b flex-shrink-0">
        <v-icon class="ml-4">mdi-book-cross</v-icon>
        <v-toolbar-title class="text-subtitle-1 font-weight-bold ml-2">
          {{ step === 'projecting' ? 'Projetando Bíblia' : 'Bíblia Sagrada' }}
        </v-toolbar-title>
        <v-spacer></v-spacer>
        <v-btn icon="mdi-close" variant="text" size="small" @click="close"></v-btn>
      </v-toolbar>

      <div class="flex-grow-1 overflow-hidden">

        <div v-if="step === 'book'" class="d-flex flex-column h-100 pa-4">
          <div class="max-h-10">
            <v-text-field v-model="searchQuery" @keyup.enter="onSearchEnter" prepend-inner-icon="mdi-magnify"
              label="Buscar livro (ex: Gn, Mateus)..." variant="outlined" density="compact" color="primary" hide-details
              class="mb-4" autofocus @focus="handleFocus" @blur="handleBlur"></v-text-field>
          </div>
          <v-list density="compact" class="pa-0 overflow-y-auto flex-grow-1">
            <v-list-item v-for="book in filteredBooks" :key="book.abbr" :title="book.name"
              append-icon="mdi-chevron-right" @click="selectBook(book)" class="border-b"></v-list-item>
          </v-list>
        </div>

        <div v-else-if="step === 'chapter'" class="d-flex flex-column h-100 pa-4">
          <div class="d-flex align-center mb-4 flex-shrink-0">
            <v-btn icon="mdi-arrow-left" variant="text" size="small" @click="step = 'book'"></v-btn>
            <span class="text-h6 ml-2">{{ selectedBook.name }}</span>
          </div>
          <div class="overflow-y-auto flex-grow-1 overflow-x-hidden pr-2">
            <v-row density="comfortable">
              <v-col cols="3" v-for="cap in selectedBook.chapters.length" :key="cap">
                <v-btn block variant="tonal" color="primary" @click="selectChapter(cap)">{{ cap }}</v-btn>
              </v-col>
            </v-row>
          </div>
        </div>

        <div v-else-if="step === 'verse'" class="d-flex flex-column h-100 pa-4">
          <div class="d-flex align-center mb-4 flex-shrink-0">
            <v-btn icon="mdi-arrow-left" variant="text" size="small" @click="step = 'chapter'"></v-btn>
            <span class="text-h6 ml-2">{{ selectedBook.name }} {{ selectedChapter }}</span>
          </div>

          <v-card variant="outlined" class="pa-4 mb-2 rounded-lg flex-shrink-0">
            <v-row density="comfortable">
              <v-col cols="6"><v-autocomplete v-model="verseStart" :items="availableVerses" label="De (Início)"
                  variant="outlined" density="compact" hide-details></v-autocomplete></v-col>
              <v-col cols="6"><v-autocomplete v-model="verseEnd" :items="availableVerses" label="Até (Fim)"
                  variant="outlined" density="compact" hide-details></v-autocomplete></v-col>
            </v-row>
            <v-btn block color="primary" variant="flat" class="mt-5" @click="confirmVerses">Buscar Versículos</v-btn>
            <v-divider class="my-4"></v-divider>
            <v-btn block color="secondary" variant="tonal" @click="selectWholeChapter">Capítulo Completo</v-btn>
          </v-card>
        </div>

        <div v-else-if="step === 'loading'" class="flex-grow-1 d-flex flex-column align-center justify-center h-100">
          <v-progress-circular indeterminate color="primary"></v-progress-circular>
        </div>

        <div
          v-else-if="(step === 'view' || step === 'projecting' && statusPresStore.status.isPresentation !== 'Biblia') && fetchedData"
          class="d-flex flex-column h-100">
          <div class="flex-shrink-0 px-4 pt-4">
            <div class="d-flex align-center justify-space-between mb-2">
              <div class="d-flex align-center">
                <v-btn icon="mdi-arrow-left" variant="text" size="small" class="mr-1" @click="step = 'verse'"></v-btn>
                <span class="text-h6 font-weight-bold text-primary">{{ fetchedData.book }} {{ fetchedData.chapter
                  }}</span>
              </div>
              <v-tooltip text="Nova Busca" location="bottom">
                <template v-slot:activator="{ props }">
                  <v-btn v-bind="props" icon="mdi-magnify" variant="text" size="small"
                    @click="bibleStore.resetSelection"></v-btn>
                </template>
              </v-tooltip>
            </div>
            <v-tabs v-model="currentTab" color="primary" density="compact" class="border-b">
              <v-tab value="texto">Versículos</v-tab>
              <v-tab value="config">Aparência</v-tab>
            </v-tabs>
          </div>

          <div class="flex-grow-1 overflow-hidden">
            <v-window v-model="currentTab" class="h-100">
              <v-window-item value="texto" class="h-100 overflow-y-auto px-4 py-4">
                <p v-for="(verse, index) in fetchedData.verses" :key="index"
                  class="mb-3 text-body-2 line-height-relaxed"
                  :style="{ fontFamily: projectionSettings.fontFamily || 'inherit' }">
                  <sup class="font-weight-bold text-primary mr-1">{{ index + verseStart }}</sup>{{ verse }}
                </p>
              </v-window-item>

              <v-window-item value="config" class="h-100 overflow-y-auto px-4 py-4">

                <p class="text-caption font-weight-bold mb-1">Versículos por Slide</p>
                <v-slider v-model="projectionSettings.versesPerSlide" min="1" max="5" step="1" thumb-label
                  color="primary" hide-details></v-slider>

                <p class="text-caption font-weight-bold mb-1 mt-4">Tamanho da Fonte</p>
                <v-slider v-model="projectionSettings.fontSize" min="2" :max="maxBibleFontSize" step="0.1" thumb-label
                  color="primary" hide-details></v-slider>

                <font-selector v-model="projectionSettings.fontFamily"></font-selector>

                <div class="d-flex align-center justify-space-between mt-4 mb-2">
                  <v-btn-toggle v-model="projectionSettings.align" color="primary" variant="outlined" density="compact"
                    divided>
                    <v-tooltip text="Esquerda" location="top"><template v-slot:activator="{ props }"><v-btn
                          v-bind="props"
                          value="left"><v-icon>mdi-format-align-left</v-icon></v-btn></template></v-tooltip>
                    <v-tooltip text="Centralizado" location="top"><template v-slot:activator="{ props }"><v-btn
                          v-bind="props"
                          value="center"><v-icon>mdi-format-align-center</v-icon></v-btn></template></v-tooltip>
                    <v-tooltip text="Direita" location="top"><template v-slot:activator="{ props }"><v-btn
                          v-bind="props"
                          value="right"><v-icon>mdi-format-align-right</v-icon></v-btn></template></v-tooltip>
                    <v-tooltip text="Justificado" location="top"><template v-slot:activator="{ props }"><v-btn
                          v-bind="props"
                          value="justify"><v-icon>mdi-format-align-justify</v-icon></v-btn></template></v-tooltip>
                  </v-btn-toggle>

                  <v-tooltip text="Negrito" location="top">
                    <template v-slot:activator="{ props }">
                      <v-btn v-bind="props" :color="projectionSettings.bold ? 'primary' : 'surface-variant'"
                        :variant="projectionSettings.bold ? 'flat' : 'outlined'"
                        @click="projectionSettings.bold = !projectionSettings.bold" icon="mdi-format-bold"
                        size="small"></v-btn>
                    </template>
                  </v-tooltip>
                </div>

                <div class="d-flex flex-column gap-2 mt-4 mb-2">
                  <v-checkbox v-model="projectionSettings.showReference" label="Exibir Referência no Rodapé"
                    color="primary" density="compact" hide-details></v-checkbox>

                  <v-checkbox v-model="projectionSettings.textBackdrop" label="Fundo escurecido atrás do texto"
                    color="primary" density="compact" hide-details>
                    <template v-slot:label>
                      <span class="text-body-2">Ativar painel escuro no texto <span
                          class="text-caption opacity-70">(Melhora leitura sobre vídeos)</span></span>
                    </template>
                  </v-checkbox>
                </div>

                <v-divider class="my-4"></v-divider>

                <p class="text-caption font-weight-bold mb-2 mt-2">Fundo Personalizado</p>
                <div class="background-selector-wrapper w-100">
                  <v-alert color="primary" variant="tonal" density="compact" class="mb-4 text-caption rounded-lg"
                    icon="mdi-image-filter-center-focus">
                    Exibindo apenas mídias marcadas com a categoria <strong>Bíblia</strong>.
                  </v-alert>

                  <div class="d-flex flex-wrap align-center gap-3 pb-2">
                    <div class="d-flex gap-2 pr-3 group-divider">
                      <v-tooltip text="Fundo Preto Sólido" location="bottom">
                        <template v-slot:activator="{ props }">
                          <v-card v-bind="props" width="60" height="40" color="#121212"
                            class="cursor-pointer d-flex align-center justify-center selector-card"
                            :class="{ 'is-selected': projectionSettings.bgType === 'color' && projectionSettings.bgColor === '#000000' }"
                            @click="projectionSettings.bgType = 'color'; projectionSettings.bgColor = '#000000'; projectionSettings.bgMedia = ''">
                            <v-icon color="white" size="small">mdi-monitor-off</v-icon>
                          </v-card>
                        </template>
                      </v-tooltip>

                      <v-tooltip text="Cor Personalizada" location="bottom">
                        <template v-slot:activator="{ props }">
                          <v-card v-bind="props" width="60" height="40"
                            :color="isCustomColor ? projectionSettings.bgColor : 'surface-variant'"
                            class="cursor-pointer position-relative d-flex align-center justify-center selector-card"
                            :class="{ 'is-selected': isCustomColor }">
                            <v-icon :color="isCustomColor ? 'white' : 'primary'">mdi-palette</v-icon>
                            <input type="color" v-model="projectionSettings.bgColor"
                              @input="projectionSettings.bgType = 'color'; projectionSettings.bgMedia = ''"
                              class="position-absolute top-0 left-0 w-100 h-100 cursor-pointer" style="opacity: 0;">
                          </v-card>
                        </template>
                      </v-tooltip>
                    </div>

                    <div class="pr-3 group-divider">
                      <v-tooltip text="Carregar do Computador" location="bottom">
                        <template v-slot:activator="{ props }">
                          <v-card v-bind="props" width="60" height="40" color="transparent"
                            class="cursor-pointer d-flex align-center justify-center dashed-border selector-card"
                            :class="{ 'is-selected': projectionSettings.bgType === 'upload' }"
                            @click="fileInput.click()">
                            <v-icon size="small"
                              :color="projectionSettings.bgType === 'upload' ? 'primary' : 'medium-emphasis'">mdi-cloud-upload</v-icon>
                            <input type="file" ref="fileInput" class="d-none" accept="image/*,video/*"
                              @change="handleFileUpload">
                          </v-card>
                        </template>
                      </v-tooltip>
                    </div>

                    <v-tooltip v-for="file in bibleMedia" :key="file.id" :text="file.name" location="bottom">
                      <template v-slot:activator="{ props }">
                        <v-card v-bind="props" width="60" height="40"
                          class="cursor-pointer position-relative overflow-hidden selector-card"
                          :class="{ 'is-selected': projectionSettings.bgType === 'saved' && projectionSettings.bgMedia === file.url }"
                          @click="selectLocalMedia(file)">
                          <smart-video v-if="file.isVideo" crossorigin="anonymous" playsinline :src="file.url"
                            class="w-100 h-100 object-cover" muted preload="metadata" preview-only></smart-video>
                          <v-img v-else :src="file.url" cover height="100%"></v-img>
                          <div v-if="file.isVideo"
                            class="position-absolute top-0 left-0 w-100 h-100 d-flex align-center justify-center overlay-dim">
                            <v-icon color="white" size="small">mdi-play-circle-outline</v-icon>
                          </div>
                          <v-fade-transition>
                            <div v-if="projectionSettings.bgType === 'saved' && projectionSettings.bgMedia === file.url"
                              class="position-absolute top-0 right-0 ma-1 bg-primary rounded-circle d-flex align-center justify-center"
                              style="width: 16px; height: 16px; z-index: 10;">
                              <v-icon color="white" size="10">mdi-check</v-icon>
                            </div>
                          </v-fade-transition>
                        </v-card>
                      </template>
                    </v-tooltip>
                  </div>
                </div>
              </v-window-item>
            </v-window>
          </div>

          <div class="flex-shrink-0 pa-4 border-t bg-surface-light">
            <v-btn block color="success" size="large" prepend-icon="mdi-projector" @click="bibleStore.startProjection">
              Iniciar Projeção
            </v-btn>
          </div>
        </div>

        <div v-else-if="step === 'projecting' && statusPresStore.status.isPresentation === 'Biblia'"
          class="d-flex flex-column h-100 pa-4">
          <v-card color="surface-variant" variant="outlined"
            class="pa-3 mb-4 text-center border-primary border-opacity-100 flex-shrink-0"
            style="border-width: 2px !important;">
            <div class="text-caption text-primary font-weight-bold text-uppercase mb-1">Slide {{ currentSlideIndex + 1
              }} de {{
                bibleSlides.length }}</div>
            <div class="text-subtitle-1 font-weight-medium text-truncate">{{ bibleSlides[currentSlideIndex]?.reference
              }}</div>
          </v-card>

          <v-card
            class="flex-grow-1 overflow-y-auto pa-4 bg-grey-lighten-4 mb-4 d-flex align-center justify-center text-center">
            <span v-html="bibleSlides[currentSlideIndex]?.htmlContent"></span>
          </v-card>

          <div class="flex-shrink-0 mb-4">
            <v-row density="comfortable">
              <v-col cols="6">
                <v-btn block height="60" variant="tonal" color="primary" @click="bibleStore.prevSlide"
                  :disabled="currentSlideIndex === 0">
                  <v-icon size="large" class="mr-2">mdi-chevron-left</v-icon> Anterior
                </v-btn>
              </v-col>
              <v-col cols="6">
                <v-btn block height="60" color="primary" @click="bibleStore.nextSlide"
                  :disabled="currentSlideIndex === bibleSlides.length - 1">
                  Próximo <v-icon size="large" class="ml-2">mdi-chevron-right</v-icon>
                </v-btn>
              </v-col>
            </v-row>
          </div>

          <div class="pt-3 border-t flex-shrink-0 bg-surface-light text-center">
            <v-btn block color="error" variant="flat" prepend-icon="mdi-stop" @click="bibleStore.stopProjection">
              Parar Apresentação
            </v-btn>
            <span class="text-caption text-primary-variant mt-2 d-inline-block">(Use ← e → para navegar, Esc para
              sair)</span>
          </div>
        </div>

      </div>
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
/* Todo seu CSS exato continua aqui, não precisei alterar. */
.line-height-relaxed {
  line-height: 1.6;
}

.h-100 {
  height: 100% !important;
}

.overflow-hidden {
  overflow: hidden !important;
}

.gap-2 {
  gap: 8px;
}

.gap-3 {
  gap: 12px;
}

.group-divider {
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  height: 32px;
  display: flex;
  align-items: center;
}

.selector-card {
  border: 2px solid transparent;
  background-color: rgb(var(--v-theme-surface-variant));
  transition: all 0.2s ease-in-out;
  flex-shrink: 0;
}

.is-selected {
  border-color: rgb(var(--v-theme-primary)) !important;
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.dashed-border {
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.2) !important;
}

.overlay-dim {
  background: rgba(0, 0, 0, 0.4);
}
</style>