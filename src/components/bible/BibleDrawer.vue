<script setup lang="ts">
import { computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core'; 
import { useConfigStore } from '../../stores/useConfigStore'; // Ajuste o caminho se necessário
import bibleData from "../../data/bible.json"
import { calculateMaxFontSize, getMaxCharsFromSlides, getMaxLinesFromSlides } from '../../utils/projection';

const configStore = useConfigStore();
const emit = defineEmits(['project', 'close']);

const isOpen = ref(false);
const step = ref<'book' | 'chapter' | 'verse' | 'loading' | 'view' | 'projecting'>('book');

// Seleções do usuário
const selectedBook = ref<any>(null);
const selectedChapter = ref<number>(1);
const verseStart = ref<number>(1);
const verseEnd = ref<number>(1);
const fetchedData = ref<{ book: string, chapter: string, verses: string[] } | null>(null);

// --- CONFIGURAÇÕES DE PROJEÇÃO DA BÍBLIA ---
const projectionSettings = ref({
  versesPerSlide: 2,
  fontSize: 5.0, // em cqi
  fontFamily: 'Inter',
  align: 'left' as 'left' | 'center' | 'right' | 'justify',
  bgType: 'color', 
  bgColor: '#000000',
  bgMedia: '',
  bgIsVideo: false,
  bgFit: 'cover',
  showReference: true // Mostra ex: "João 3:16" no rodapé do slide
});

const currentSlideIndex = ref(0);
const fileInput = ref({click: () => {}});

// Busca de Livros
const searchQuery = ref('');

const filteredBooks = computed(() => {
  if (!searchQuery.value) return bibleData;
  const normalize = (str: string) => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const query = normalize(searchQuery.value);
  return bibleData.filter(book => normalize(book.name).includes(query) || normalize(book.abbr).includes(query));
});

const onSearchEnter = () => { if (filteredBooks.value.length === 1) selectBook(filteredBooks.value[0]); };

const totalVersesInChapter = computed(() => {
  if (!selectedBook.value) return 1;
  return selectedBook.value.chapters[selectedChapter.value - 1];
});

const availableVerses = computed(() => Array.from({ length: totalVersesInChapter.value }, (_, i) => i + 1));

watch(verseStart, (newVal) => { if (verseEnd.value < newVal) verseEnd.value = newVal; });
watch(verseEnd, (newVal) => { if (verseStart.value > newVal) verseStart.value = newVal; });

// --- LÓGICA DE DIVISÃO DE SLIDES ---
const bibleSlides = computed(() => {
  if (!fetchedData.value) return [];
  
  const slides = [];
  const verses = fetchedData.value.verses;
  const start = verseStart.value;
  const perSlide = projectionSettings.value.versesPerSlide;

  for (let i = 0; i < verses.length; i += perSlide) {
    const chunk = verses.slice(i, i + perSlide);
    const endVerse = start + i + chunk.length - 1;
    
    // Monta o texto do slide com as tags <sup> para os números dos versículos
    const slideHtml = chunk.map((v, idx) => 
      `<span style="color: rgba(255,255,255,0.6); font-size: 0.6em; vertical-align: super; margin-right: 4px;">${start + i + idx}</span>${v}`
    ).join('<br><br>');

    slides.push({
      reference: `${fetchedData.value.book} ${fetchedData.value.chapter}:${start + i}${chunk.length > 1 ? '-' + endVerse : ''}`,
      htmlContent: slideHtml
    });
  }
  return slides;
});

// ABRIR O DRAWER
const open = async (reference?: { abbr: string, chapter: number, verses?: string }) => {
  isOpen.value = true;
  if (reference) {
    step.value = 'loading';
    await fetchBibleText(reference.abbr, reference.chapter, reference.verses || '1');
  } else {
    resetSelection();
  }
};

const close = () => { 
  if(step.value === 'projecting') stopProjection();
  isOpen.value = false; 
};

// NAVEGAÇÃO BÁSICA
const selectBook = (book: any) => { selectedBook.value = book; searchQuery.value = ''; step.value = 'chapter'; };
const selectChapter = (chapterIndex: number) => { selectedChapter.value = chapterIndex; verseStart.value = 1; verseEnd.value = totalVersesInChapter.value; step.value = 'verse'; };
const confirmVerses = () => {
  let versesStr = verseStart.value === verseEnd.value ? `${verseStart.value}` : `${verseStart.value}-${verseEnd.value}`;
  fetchBibleText(selectedBook.value.abbr, selectedChapter.value, versesStr);
};
const selectWholeChapter = () => fetchBibleText(selectedBook.value.abbr, selectedChapter.value, `1-${totalVersesInChapter.value}`);
const resetSelection = () => { selectedBook.value = null; fetchedData.value = null; searchQuery.value = ''; step.value = 'book'; };

// BUSCA NA API
const fetchBibleText = async (abbr: string, chapter: number | string, verses: string) => {
  step.value = 'loading';
  try {
    const normalizedAbbr = abbr.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const url = `http://localhost:3000/api/bible/${normalizedAbbr}/${chapter}/${verses}`;
    const response = await fetch(url);
    const data = await response.json();
    fetchedData.value = data;
    step.value = 'view';
  } catch (error) {
    console.error("Erro ao buscar texto bíblico:", error);
    step.value = 'verse'; 
  }
};

// --- MOTOR DE PROJEÇÃO ---
const handleFileUpload = (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
        projectionSettings.value.bgType = 'upload';
        projectionSettings.value.bgMedia = URL.createObjectURL(file);
        projectionSettings.value.bgIsVideo = file.type.startsWith('video/');
    }
};

const projectCurrentSlide = async () => {
  const currentSlide = bibleSlides.value[currentSlideIndex.value];
  if (!currentSlide) return;

  const conf = configStore.settings;
  const settings = projectionSettings.value;

  let bgHtml = '';
  if (settings.bgType === 'color') {
      bgHtml = `<div style="position: absolute; inset: 0; background-color: ${settings.bgColor}; z-index: -1;"></div>`;
  } else if (settings.bgIsVideo && settings.bgMedia) {
      bgHtml = `<video src="${settings.bgMedia}" autoplay loop muted style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: ${settings.bgFit}; z-index: -1;"></video>`;
  } else if (settings.bgMedia) {
      bgHtml = `<img src="${settings.bgMedia}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: ${settings.bgFit}; z-index: -1;" />`;
  }

  // Monta a referência bíblica no rodapé (opcional)
  const referenceHtml = settings.showReference 
    ? `<div style="position: absolute; bottom: 5%; right: 5%; font-family: '${settings.fontFamily}', sans-serif; font-size: ${settings.fontSize * 0.4}cqi; color: rgba(255,255,255,0.8); font-weight: bold;">${currentSlide.reference}</div>`
    : '';

  const htmlPayload = `
      <div id="projection-root" class="theme-${conf.activeTheme.toLowerCase()}" style="
          width: 100vw; height: 100vh; position: relative; overflow: hidden;
          background-color: ${conf.chromaKey !== 'none' ? conf.chromaKey : 'transparent'};
          opacity: ${conf.bgOpacity / 100};
          transition: opacity 0.3s ${conf.transitionType === 'fade' ? 'ease-in-out' : 'none'};
          box-sizing: border-box;
          padding: ${conf.marginTop}px ${conf.marginRight}px ${conf.marginBottom}px ${conf.marginLeft}px;
      ">
          ${bgHtml}
          <div style="position: relative; width: 100%; height: 100%; container-type: inline-size;">
              <div style="
                  position: absolute; left: 5%; top: 5%; width: 90%; height: 90%;
                  display: flex; align-items: center; justify-content: center;
              ">
                  <div style="
                      font-family: '${settings.fontFamily}', sans-serif;
                      font-size: ${settings.fontSize}cqi; 
                      color: #FFFFFF;
                      text-align: ${settings.align};
                      width: 100%; max-height: 100%; overflow: hidden;
                  ">${currentSlide.htmlContent}</div>
              </div>
              ${referenceHtml}
          </div>
      </div>
  `;

  try {
      await invoke('update_projection', { html: htmlPayload, targetMonitor: conf.selectedMonitor || null });
  } catch (error) { 
      console.error("Erro ao projetar a bíblia:", error);
  }
};

const startProjection = () => {
  currentSlideIndex.value = 0;
  step.value = 'projecting';
  projectCurrentSlide();
};

const stopProjection = async () => {
  step.value = 'view';
  try { await invoke('stop_projection'); } 
  catch (error) { console.error("Erro ao parar a projeção:", error); }
};

const nextSlide = () => { if (currentSlideIndex.value < bibleSlides.value.length - 1) { currentSlideIndex.value++; projectCurrentSlide(); }};
const prevSlide = () => { if (currentSlideIndex.value > 0) { currentSlideIndex.value--; projectCurrentSlide(); }};

// Teclas de atalho exclusivas para quando a bíblia está projetando
const handleKeydown = (e: KeyboardEvent) => {
  if (step.value !== 'projecting') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextSlide();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prevSlide();
  if (e.key === 'Escape') stopProjection();
};

watch(isOpen, (newVal) => {
  if (newVal) window.addEventListener('keydown', handleKeydown);
  else window.removeEventListener('keydown', handleKeydown);
});

const maxCharsInBible = computed(() => getMaxCharsFromSlides(bibleSlides.value));
const maxLinesInBible = computed(() => getMaxLinesFromSlides(bibleSlides.value));

const maxBibleFontSize = computed(() => {
    return calculateMaxFontSize({
        maxChars: maxCharsInBible.value, // Caracteres totais do slide
        maxLines: maxLinesInBible.value,
        aspectRatio: configStore.settings.aspectRatio,
        safeMargin: 1.20, // Valor padrão
        absoluteMax: 15
    }); 
});

watch(maxBibleFontSize, (newMax) => {
    if (projectionSettings.value.fontSize > newMax) {
        projectionSettings.value.fontSize = newMax;
        if (step.value === 'projecting') projectCurrentSlide();
    }
}); 

defineExpose({ open, close });
</script>

<template>
  <v-navigation-drawer v-model="isOpen" location="right" temporary width="450" elevation="6"> 
    <v-toolbar :color="step === 'projecting' ? 'error' : 'primary'" density="compact" class="text-white border-b">
      <v-icon class="ml-4">mdi-book-cross</v-icon>
      <v-toolbar-title class="text-subtitle-1 font-weight-bold ml-2">
        {{ step === 'projecting' ? 'Projetando Bíblia' : 'Bíblia Sagrada' }}
      </v-toolbar-title>
      <v-spacer></v-spacer>
      <v-btn icon="mdi-close" variant="text" size="small" @click="close"></v-btn>
    </v-toolbar>
    
    <v-container class="pa-4 d-flex flex-column h-100 overflow-hidden">
      
      <div v-if="step === 'book'" class="d-flex flex-column h-100">
        <v-text-field v-model="searchQuery" @keyup.enter="onSearchEnter" prepend-inner-icon="mdi-magnify" label="Buscar livro (ex: Gn, Mateus)..." variant="outlined" density="compact" color="primary" hide-details class="mb-4 flex-shrink-0" autofocus></v-text-field>
        <v-list density="compact" class="pa-0 overflow-y-auto flex-grow-1">
          <v-list-item v-for="book in filteredBooks" :key="book.abbr" :title="book.name" append-icon="mdi-chevron-right" @click="selectBook(book)" class="border-b"></v-list-item>
        </v-list>
      </div>

      <div v-else-if="step === 'chapter'" class="d-flex flex-column h-100">
        <div class="d-flex align-center mb-4 flex-shrink-0">
          <v-btn icon="mdi-arrow-left" variant="text" size="small" @click="step = 'book'"></v-btn>
          <span class="text-h6 ml-2">{{ selectedBook.name }}</span>
        </div>
        <div class="overflow-y-auto flex-grow-1 overflow-x-hidden">
          <v-row dense>
            <v-col cols="3" v-for="cap in selectedBook.chapters.length" :key="cap">
              <v-btn block variant="tonal" color="primary" @click="selectChapter(cap)">{{ cap }}</v-btn>
            </v-col>
          </v-row>
        </div>
      </div>

      <div v-else-if="step === 'verse'" class="d-flex flex-column h-100">
        <div class="d-flex align-center mb-4 flex-shrink-0">
          <v-btn icon="mdi-arrow-left" variant="text" size="small" @click="step = 'chapter'"></v-btn>
          <span class="text-h6 ml-2">{{ selectedBook.name }} {{ selectedChapter }}</span>
        </div>
        
        <v-card variant="outlined" class="pa-4 mb-2 rounded-lg flex-shrink-0">
          <v-row dense>
            <v-col cols="6"><v-autocomplete v-model="verseStart" :items="availableVerses" label="De (Início)" variant="outlined" density="compact" hide-details></v-autocomplete></v-col>
            <v-col cols="6"><v-autocomplete v-model="verseEnd" :items="availableVerses" label="Até (Fim)" variant="outlined" density="compact" hide-details></v-autocomplete></v-col>
          </v-row>
          <v-btn block color="primary" variant="flat" class="mt-5" @click="confirmVerses">Buscar Versículos</v-btn>
        </v-card>
        <v-btn block color="secondary" variant="tonal" class="mt-4" @click="selectWholeChapter">Capítulo Completo</v-btn>
      </div>

      <div v-else-if="step === 'loading'" class="flex-grow-1 d-flex flex-column align-center justify-center">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
      </div>

      <div v-else-if="step === 'view' && fetchedData" class="d-flex flex-column h-100">
        <div class="d-flex align-center mb-2 flex-shrink-0 justify-space-between">
          <div class="d-flex align-center">
            <v-btn icon="mdi-arrow-left" variant="text" size="small" class="mr-1" @click="step = 'verse'"></v-btn>
            <span class="text-h6 font-weight-bold text-primary">{{ fetchedData.book }} {{ fetchedData.chapter }}</span>
          </div>
          <v-btn icon="mdi-magnify" variant="text" size="small" @click="resetSelection"></v-btn>
        </div>

        <v-tabs v-model="currentTab" color="primary" density="compact" class="border-b flex-shrink-0">
          <v-tab value="texto">Versículos</v-tab>
          <v-tab value="config">Aparência da Tela</v-tab>
        </v-tabs>

        <v-window v-model="currentTab" class="flex-grow-1 overflow-hidden mt-2">
          <v-window-item value="texto" class="h-100 overflow-y-auto pr-2 pb-2">
             <p v-for="(verse, index) in fetchedData.verses" :key="index" class="mb-3 text-body-2 line-height-relaxed">
              <sup class="font-weight-bold text-primary mr-1">{{ index + verseStart }}</sup>{{ verse }}
            </p>
          </v-window-item>

          <v-window-item value="config" class="h-100 overflow-y-auto pr-2">
            <p class="text-caption font-weight-bold mb-1 mt-2">Versículos por Slide</p>
            <v-slider v-model="projectionSettings.versesPerSlide" min="1" max="5" step="1" thumb-label color="primary" hide-details></v-slider>

            <p class="text-caption font-weight-bold mb-1 mt-4">Tamanho da Fonte</p>
            <v-slider v-model="projectionSettings.fontSize" min="2" :max="maxBibleFontSize" step="0.1" thumb-label color="primary" hide-details></v-slider>

            <div class="d-flex align-center mt-4 mb-2">
              <v-checkbox v-model="projectionSettings.showReference" label="Exibir Referência no Rodapé" color="primary" density="compact" hide-details></v-checkbox>
            </div>

            <p class="text-caption font-weight-bold mb-2 mt-2">Fundo Personalizado</p>
            <div class="d-flex gap-2">
                <v-card width="60" height="40" color="black" class="d-flex align-center justify-center cursor-pointer border" @click="projectionSettings.bgType = 'color'; projectionSettings.bgColor = '#000000'; projectionSettings.bgMedia = ''">
                    <v-icon color="white" size="small">mdi-format-color-fill</v-icon>
                </v-card>
                <v-card width="60" height="40" color="surface-variant" class="d-flex align-center justify-center cursor-pointer border" @click="fileInput.click()">
                    <v-icon size="small">mdi-image-plus</v-icon>
                    <input type="file" ref="fileInput" class="d-none" accept="image/*,video/*" @change="handleFileUpload">
                </v-card>
                <div v-if="projectionSettings.bgType === 'upload'" class="text-caption text-success d-flex align-center ml-2">
                  <v-icon size="small" class="mr-1">mdi-check-circle</v-icon> Mídia Carregada
                </div>
            </div>
          </v-window-item>
        </v-window>

        <div class="pt-3 border-t flex-shrink-0 bg-white">
          <v-btn block color="success" size="large" prepend-icon="mdi-projector" @click="startProjection">
            Iniciar Projeção
          </v-btn>
        </div>
      </div>

      <div v-else-if="step === 'projecting'" class="d-flex flex-column h-100">
        
        <v-card color="surface" variant="outlined" class="pa-3 mb-4 text-center border-primary border-opacity-100" style="border-width: 2px !important;">
          <div class="text-caption text-primary font-weight-bold text-uppercase mb-1">Slide {{ currentSlideIndex + 1 }} de {{ bibleSlides.length }}</div>
          <div class="text-subtitle-1 font-weight-medium text-truncate">{{ bibleSlides[currentSlideIndex]?.reference }}</div>
        </v-card>

        <v-card class="flex-grow-1 overflow-y-auto pa-4 bg-grey-lighten-4 mb-4 d-flex align-center justify-center text-center">
          <span v-html="bibleSlides[currentSlideIndex]?.htmlContent"></span>
        </v-card>

        <div class="flex-shrink-0 mb-4">
          <v-row dense>
            <v-col cols="6">
              <v-btn block height="60" variant="tonal" color="primary" @click="prevSlide" :disabled="currentSlideIndex === 0">
                <v-icon size="large" class="mr-2">mdi-chevron-left</v-icon> Anterior
              </v-btn>
            </v-col>
            <v-col cols="6">
              <v-btn block height="60" color="primary" @click="nextSlide" :disabled="currentSlideIndex === bibleSlides.length - 1">
                Próximo <v-icon size="large" class="ml-2">mdi-chevron-right</v-icon>
              </v-btn>
            </v-col>
          </v-row>
        </div>

        <div class="pt-3 border-t flex-shrink-0 bg-white text-center">
          <v-btn block color="error" variant="flat" prepend-icon="mdi-stop" @click="stopProjection">
            Parar Apresentação
          </v-btn>
          <span class="text-caption text-grey mt-2 d-inline-block">(Use ← e → para navegar, Esc para sair)</span>
        </div>
      </div>

    </v-container>
  </v-navigation-drawer>
</template>

<script lang="ts">
  // Adicionamos o currentTab para gerenciar as abas de Texto e Configuração
  import { ref } from 'vue';
  const currentTab = ref('texto');
</script>

<style scoped>
.line-height-relaxed { line-height: 1.6; }
.h-100 { height: 100% !important; }
.overflow-hidden { overflow: hidden !important; }
.gap-2 { gap: 8px; }
</style>