<script setup lang="ts">
// Banco de fundos (Pixabay): busca, escolhe, baixa para media/slides e
// devolve o arquivo já carregado na biblioteca para virar fundo.
import { ref, computed, watch } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import {
  searchStock,
  downloadStock,
  type StockItem,
  type StockType,
} from '../../services/stockBackgrounds';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'selected', file: MediaFile): void;
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const mediaStore = useMediaStore();

// Temas prontos para culto (mais seguros que só a busca livre)
const TOPICS = [
  'céu', 'nuvens', 'pôr do sol', 'natureza', 'montanhas', 'água',
  'luzes', 'bokeh', 'abstrato', 'textura', 'cruz', 'flores', 'estrelas',
];

const type = ref<StockType>('image');
const query = ref('');
const activeQuery = ref('céu');
const items = ref<StockItem[]>([]);
const page = ref(1);
const hasMore = ref(false);
const isLoading = ref(false);
const errorMsg = ref('');
const downloadingId = ref<string | null>(null);
const progress = ref(0);

const runSearch = async (reset = true) => {
  if (isLoading.value) return;
  isLoading.value = true;
  errorMsg.value = '';
  try {
    const nextPage = reset ? 1 : page.value + 1;
    const res = await searchStock(activeQuery.value, type.value, nextPage);
    items.value = reset ? res.items : [...items.value, ...res.items];
    page.value = res.page;
    hasMore.value = res.hasMore;
  } catch (e: any) {
    errorMsg.value = e?.message || 'Não foi possível buscar fundos agora.';
    if (reset) items.value = [];
  } finally {
    isLoading.value = false;
  }
};

const searchTopic = (topic: string) => {
  query.value = '';
  activeQuery.value = topic;
  runSearch(true);
};

const submitSearch = () => {
  const q = query.value.trim();
  if (!q) return;
  activeQuery.value = q;
  runSearch(true);
};

watch(type, () => runSearch(true));

watch(isOpen, (open) => {
  if (open && items.value.length === 0) runSearch(true);
});

const formatDuration = (s?: number) => {
  if (!s) return '';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
};

const formatMB = (bytes?: number) => (bytes ? `${(bytes / 1024 / 1024).toFixed(0)} MB` : '');

const choose = async (item: StockItem) => {
  if (downloadingId.value) return;
  downloadingId.value = item.id;
  progress.value = 0;
  errorMsg.value = '';
  try {
    const path = await downloadStock(item, (pct) => (progress.value = pct));

    // Recarrega a biblioteca e pega o arquivo recém-baixado
    // (compara sem diferenciar barra/maiúsculas: no Windows o Rust usa "\")
    await mediaStore.loadMedia();
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    const file = mediaStore.themeFiles.find((f) => norm(f.path) === norm(path));
    if (!file) throw new Error('O arquivo foi baixado, mas não apareceu na biblioteca.');

    emit('selected', file);
    isOpen.value = false;
  } catch (e: any) {
    errorMsg.value = typeof e === 'string' ? e : e?.message || 'Falha ao baixar o fundo.';
  } finally {
    downloadingId.value = null;
  }
};

const openExternal = (url: string) => {
  if (url) openUrl(url).catch(() => { });
};
</script>

<template>
  <v-dialog v-model="isOpen" max-width="980" scrollable :persistent="!!downloadingId">
    <v-card rounded="xl" class="stock-card">
      <v-card-title class="d-flex align-center pa-4 border-b">
        <v-icon color="primary" class="mr-2">mdi-image-search</v-icon>
        <span class="text-subtitle-1 font-weight-bold">Banco de fundos</span>
        <v-spacer></v-spacer>
        <v-btn-toggle v-model="type" mandatory density="compact" color="primary" variant="outlined" divided
          class="mr-2" :disabled="!!downloadingId">
          <v-btn value="image" prepend-icon="mdi-image" class="text-none">Imagens</v-btn>
          <v-btn value="video" prepend-icon="mdi-video" class="text-none">Vídeos</v-btn>
        </v-btn-toggle>
        <v-btn icon="mdi-close" variant="text" size="small" :disabled="!!downloadingId"
          @click="isOpen = false"></v-btn>
      </v-card-title>

      <div class="px-4 pt-3">
        <v-text-field v-model="query" placeholder="Buscar (ex.: céu estrelado, montanhas, luzes)" variant="outlined"
          density="compact" prepend-inner-icon="mdi-magnify" hide-details clearable :disabled="!!downloadingId"
          @keyup.enter="submitSearch">
          <template #append-inner>
            <v-btn size="small" variant="tonal" color="primary" :disabled="!query?.trim()"
              @click="submitSearch">Buscar</v-btn>
          </template>
        </v-text-field>

        <div class="d-flex flex-wrap ga-1 mt-2">
          <v-chip v-for="t in TOPICS" :key="t" size="small" :disabled="!!downloadingId"
            :color="activeQuery === t ? 'primary' : undefined" :variant="activeQuery === t ? 'flat' : 'tonal'"
            @click="searchTopic(t)">{{ t }}</v-chip>
        </div>
      </div>

      <v-card-text class="pa-4" style="min-height: 360px;">
        <v-alert v-if="errorMsg" type="warning" variant="tonal" density="compact" class="mb-3">{{ errorMsg }}</v-alert>

        <div v-if="isLoading && items.length === 0" class="d-flex justify-center align-center py-16">
          <v-progress-circular indeterminate color="primary"></v-progress-circular>
        </div>

        <div v-else-if="!isLoading && items.length === 0 && !errorMsg"
          class="text-center text-medium-emphasis py-16">
          Nada encontrado para "{{ activeQuery }}". Tente outro termo.
        </div>

        <div v-else class="stock-grid">
          <v-card v-for="item in items" :key="item.id" class="stock-item" rounded="lg"
            :disabled="!!downloadingId && downloadingId !== item.id" @click="choose(item)">
            <v-img :src="item.thumb" :aspect-ratio="16 / 9" cover class="bg-grey-darken-4">
              <template #placeholder>
                <div class="d-flex align-center justify-center fill-height">
                  <v-progress-circular indeterminate size="20" width="2"></v-progress-circular>
                </div>
              </template>

              <div v-if="item.type === 'video'" class="stock-badge">
                <v-icon size="14" class="mr-1">mdi-play</v-icon>{{ formatDuration(item.duration) }}
              </div>

              <div v-if="downloadingId === item.id" class="stock-overlay">
                <v-progress-circular :model-value="progress" :indeterminate="progress === 0" size="44" width="4"
                  color="white">{{ progress > 0 ? progress + '%' : '' }}</v-progress-circular>
                <span class="text-caption mt-2">Baixando…</span>
              </div>
            </v-img>

            <div class="d-flex align-center px-2 py-1 text-caption text-medium-emphasis">
              <span class="text-truncate">por {{ item.author || 'Pixabay' }}</span>
              <v-spacer></v-spacer>
              <span class="text-no-wrap ml-1">
                {{ item.downloadWidth }}px<template v-if="item.sizeBytes"> · {{ formatMB(item.sizeBytes) }}</template>
              </span>
            </div>
          </v-card>
        </div>

        <div v-if="hasMore && items.length" class="d-flex justify-center mt-4">
          <v-btn variant="tonal" :loading="isLoading" :disabled="!!downloadingId" @click="runSearch(false)">
            Carregar mais
          </v-btn>
        </div>
      </v-card-text>

      <v-card-actions class="px-4 py-2 border-t text-caption text-medium-emphasis">
        <span>
          Imagens e vídeos do
          <a href="#" class="text-primary font-weight-bold" @click.prevent="openExternal('https://pixabay.com/')">Pixabay</a>.
          Clique em um item para baixar e usar como fundo.
        </span>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.stock-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.stock-item {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.stock-item:hover {
  transform: translateY(-2px);
}

.stock-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 11px;
  color: #fff;
  background: rgba(0, 0, 0, 0.65);
}

.stock-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
}
</style>
