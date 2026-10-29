<script setup lang="ts">
// Limpeza seletiva do cache.
// 1) Mostra cada categoria com o tamanho atual (calculado no Rust)
// 2) O usuário marca o que quer limpar
// 3) Caixa de confirmação com o resumo do que vai sair
// 4) Limpa e avisa as stores para a tela não mostrar o que sumiu
import { ref, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useSongCacheStore } from '../../stores/songCacheStore';
import { useFontStore } from '../../stores/useFontStore';
import { useYoutubeStore } from '../../stores/useYoutubeStore';
import { useMediaStore } from '../../stores/mediaStore';

type CategoryId = 'temp' | 'orphans' | 'audio' | 'youtube' | 'songs' | 'fonts' | 'components';

interface CategoryMeta {
  id: CategoryId;
  title: string;
  description: string;
  icon: string;
  /** Marcada por padrão (só o que é lixo de verdade) */
  defaultOn: boolean;
  /** Consequência que o usuário precisa saber antes de limpar */
  warning?: string;
}

interface CacheCategory { id: CategoryId; bytes: number; files: number }
interface ClearReport { freedBytes: number; removedFiles: number; errors: string[]; componentsReinstalling: boolean }

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'cleared'): void;
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const songCacheStore = useSongCacheStore();
const fontStore = useFontStore();
const youtubeStore = useYoutubeStore();
const mediaStore = useMediaStore();

const CATEGORIES: CategoryMeta[] = [
  {
    id: 'temp',
    title: 'Arquivos temporários',
    description: 'Sobras de downloads do YouTube e de extrações de áudio que foram interrompidos.',
    icon: 'mdi-file-clock-outline',
    defaultOn: true,
  },
  {
    id: 'orphans',
    title: 'Restos de vídeos apagados',
    description: 'Áudios, miniaturas e informações de vídeos que não existem mais.',
    icon: 'mdi-file-hidden',
    defaultOn: true,
  },
  {
    id: 'audio',
    title: 'Áudios extraídos dos vídeos',
    description: 'São recriados automaticamente em segundo plano. Use se algum vídeo estiver sem som ou com o áudio errado.',
    icon: 'mdi-music-note-outline',
    defaultOn: false,
  },
  {
    id: 'youtube',
    title: 'Vídeos baixados do YouTube',
    description: 'Os vídeos, miniaturas e áudios salvos pelo importador do YouTube.',
    icon: 'mdi-youtube',
    defaultOn: false,
    warning: 'Os vídeos saem da biblioteca e precisam ser baixados de novo.',
  },
  {
    id: 'songs',
    title: 'Letras salvas para uso offline',
    description: 'Cópia local das músicas sincronizadas da sua conta.',
    icon: 'mdi-music-box-multiple-outline',
    defaultOn: false,
    warning: 'Sem internet, as músicas não aparecem até sincronizar de novo.',
  },
  {
    id: 'fonts',
    title: 'Fontes importadas',
    description: 'Fontes .ttf e .otf que você adicionou ao Sigelo.',
    icon: 'mdi-format-font',
    defaultOn: false,
    warning: 'Precisam ser importadas de novo. Textos que usam essas fontes voltam para a fonte padrão.',
  },
  {
    id: 'components',
    title: 'Componentes de vídeo e YouTube',
    description: 'FFmpeg, FFprobe, yt-dlp e Deno.',
    icon: 'mdi-puzzle-outline',
    defaultOn: false,
    warning: 'O FFmpeg é baixado de novo logo em seguida; os vídeos não tocam até terminar. O yt-dlp volta no próximo import do YouTube.',
  },
];

const stats = ref<Record<CategoryId, CacheCategory | undefined>>({} as any);
const selected = ref<CategoryId[]>([]);
const isLoading = ref(false);
const isClearing = ref(false);
const isConfirmOpen = ref(false);
const loadError = ref('');
const result = ref<{ type: 'success' | 'warning' | 'error'; text: string; details: string[] } | null>(null);

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const bytesOf = (id: CategoryId) => stats.value[id]?.bytes ?? 0;
const isEmpty = (id: CategoryId) => bytesOf(id) === 0;

const selectedMetas = computed(() => CATEGORIES.filter((c) => selected.value.includes(c.id)));
const selectedBytes = computed(() => selectedMetas.value.reduce((sum, c) => sum + bytesOf(c.id), 0));
const totalBytes = computed(() => CATEGORIES.reduce((sum, c) => sum + bytesOf(c.id), 0));
const selectedWarnings = computed(() => selectedMetas.value.filter((c) => c.warning));

const loadStats = async () => {
  isLoading.value = true;
  loadError.value = '';
  try {
    const list = await invoke<CacheCategory[]>('get_cache_breakdown');
    const map = {} as Record<CategoryId, CacheCategory | undefined>;
    for (const item of list) map[item.id] = item;
    stats.value = map;
    // Desmarca o que ficou vazio
    selected.value = selected.value.filter((id) => !isEmpty(id));
  } catch (error) {
    console.error('Erro ao calcular o cache:', error);
    loadError.value = 'Não foi possível calcular o espaço usado.';
  } finally {
    isLoading.value = false;
  }
};

// Ao abrir: recalcula e marca só as categorias seguras que têm algo
watch(isOpen, async (open) => {
  if (!open) return;
  result.value = null;
  await loadStats();
  selected.value = CATEGORIES.filter((c) => c.defaultOn && !isEmpty(c.id)).map((c) => c.id);
});

const toggle = (id: CategoryId) => {
  if (isEmpty(id) || isClearing.value) return;
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id];
};

const askConfirmation = () => {
  if (!selected.value.length) return;
  isConfirmOpen.value = true;
};

const runClear = async () => {
  isConfirmOpen.value = false;
  isClearing.value = true;
  result.value = null;

  const ids = [...selected.value];
  const songsBytes = ids.includes('songs') ? bytesOf('songs') : 0;
  const errors: string[] = [];
  let freed = 0;
  let reinstalling = false;

  try {
    // Arquivos em disco (tudo menos as letras)
    const diskIds = ids.filter((id) => id !== 'songs');
    if (diskIds.length) {
      const report = await invoke<ClearReport>('clear_cache_categories', { ids: diskIds });
      freed += report.freedBytes;
      errors.push(...report.errors);
      reinstalling = report.componentsReinstalling;
    }

    // Letras: limpas pela própria store (o arquivo fica aberto pelo plugin-store)
    if (ids.includes('songs')) {
      try {
        await songCacheStore.clearCache();
        freed += songsBytes;
      } catch (e) {
        errors.push('Letras offline: ' + String(e));
      }
    }

    // Atualiza o que está na memória para refletir o que saiu do disco
    if (ids.includes('fonts')) await fontStore.loadCustomFonts();
    if (ids.includes('youtube')) {
      await youtubeStore.fetchCache();
      await mediaStore.loadMedia();
    }
    if (ids.includes('components')) youtubeStore.engine.isReady = false;

    const text = `${formatBytes(freed)} liberados.`;
    const details: string[] = [];
    if (reinstalling) details.push('O FFmpeg está sendo baixado de novo em segundo plano.');
    if (errors.length) details.push(...errors.map((e) => `Não removido: ${e}`));

    result.value = { type: errors.length ? 'warning' : 'success', text, details };
    emit('cleared');
  } catch (error) {
    console.error('Erro ao limpar o cache:', error);
    result.value = { type: 'error', text: 'Não foi possível limpar o cache.', details: [String(error)] };
  } finally {
    isClearing.value = false;
    await loadStats();
  }
};
</script>

<template>
  <v-dialog v-model="isOpen" max-width="620" scrollable :persistent="isClearing">
    <v-card rounded="xl">
      <v-card-title class="d-flex align-center pa-4 border-b">
        <v-icon color="error" class="mr-2">mdi-delete-sweep</v-icon>
        <span class="text-subtitle-1 font-weight-bold">Limpar cache</span>
        <v-spacer></v-spacer>
        <span class="text-caption text-medium-emphasis mr-2" v-if="!isLoading">
          Total: {{ formatBytes(totalBytes) }}
        </span>
        <v-btn icon="mdi-close" variant="text" size="small" :disabled="isClearing" @click="isOpen = false"></v-btn>
      </v-card-title>

      <v-card-text class="pa-4">
        <p class="text-body-2 text-medium-emphasis mb-4">
          Escolha o que apagar. Suas mídias importadas, programações e configurações não aparecem aqui e nunca são apagadas.
        </p>

        <v-alert v-if="loadError" type="error" variant="tonal" density="compact" class="mb-3">{{ loadError }}</v-alert>

        <v-alert v-if="result" :type="result.type" variant="tonal" density="compact" class="mb-3">
          <div class="font-weight-bold">{{ result.text }}</div>
          <div v-for="(d, i) in result.details" :key="i" class="text-caption">{{ d }}</div>
        </v-alert>

        <v-list density="comfortable" class="pa-0 bg-transparent" :disabled="isClearing">
          <v-list-item v-for="cat in CATEGORIES" :key="cat.id" class="rounded-lg mb-1 px-2"
            :class="{ 'opacity-50': isEmpty(cat.id) && !isLoading }" @click="toggle(cat.id)">
            <template #prepend>
              <v-checkbox-btn :model-value="selected.includes(cat.id)" :disabled="isEmpty(cat.id) || isLoading"
                color="error" class="mr-1" @click.stop="toggle(cat.id)"></v-checkbox-btn>
              <v-icon :icon="cat.icon" class="mr-2" color="medium-emphasis"></v-icon>
            </template>

            <v-list-item-title class="font-weight-medium text-body-2">{{ cat.title }}</v-list-item-title>
            <div class="text-caption text-medium-emphasis cache-desc">{{ cat.description }}</div>
            <div v-if="cat.warning && selected.includes(cat.id)" class="text-caption text-warning mt-1 d-flex">
              <v-icon size="14" class="mr-1 mt-px">mdi-alert-outline</v-icon>
              <span>{{ cat.warning }}</span>
            </div>

            <template #append>
              <v-progress-circular v-if="isLoading" indeterminate size="16" width="2"></v-progress-circular>
              <span v-else class="text-caption font-weight-bold text-no-wrap ml-3">
                {{ isEmpty(cat.id) ? 'Vazio' : formatBytes(bytesOf(cat.id)) }}
              </span>
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>

      <v-card-actions class="pa-4 border-t">
        <span class="text-caption text-medium-emphasis">
          Selecionado: <b>{{ formatBytes(selectedBytes) }}</b>
        </span>
        <v-spacer></v-spacer>
        <v-btn variant="text" :disabled="isClearing" @click="isOpen = false">Fechar</v-btn>
        <v-btn color="error" variant="flat" prepend-icon="mdi-delete-sweep" :loading="isClearing"
          :disabled="!selected.length || isLoading" @click="askConfirmation">
          Limpar selecionados
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Confirmação -->
    <v-dialog v-model="isConfirmOpen" max-width="460">
      <v-card rounded="xl">
        <v-card-title class="d-flex align-center pa-4">
          <v-icon color="warning" class="mr-2">mdi-alert</v-icon>
          <span class="text-subtitle-1 font-weight-bold">Deseja realmente limpar?</span>
        </v-card-title>
        <v-card-text class="pt-0">
          <p class="text-body-2 mb-2">Estes itens serão apagados ({{ formatBytes(selectedBytes) }}):</p>
          <ul class="text-body-2 pl-5 mb-3">
            <li v-for="cat in selectedMetas" :key="cat.id">
              {{ cat.title }} <span class="text-medium-emphasis">— {{ formatBytes(bytesOf(cat.id)) }}</span>
            </li>
          </ul>
          <v-alert v-if="selectedWarnings.length" type="warning" variant="tonal" density="compact">
            <div v-for="cat in selectedWarnings" :key="cat.id" class="text-caption mb-1">
              <b>{{ cat.title }}:</b> {{ cat.warning }}
            </div>
          </v-alert>
          <p class="text-caption text-medium-emphasis mt-3 mb-0">Esta ação não pode ser desfeita.</p>
        </v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="isConfirmOpen = false">Cancelar</v-btn>
          <v-btn color="error" variant="flat" @click="runClear">Sim, limpar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<style scoped>
.cache-desc {
  white-space: normal;
  line-height: 1.35;
}

.mt-px {
  margin-top: 1px;
}
</style>
