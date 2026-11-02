<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useLocalGroupStore } from '../../stores/localGroupStore';
import type { SongCache } from '../../stores/songCacheStore';
import { parseOpenLyrics } from '../../utils/openLyricsParser';
import { useMenuStore } from '../../stores/menuStore';

const localGroupStore = useLocalGroupStore();
const menuStore = useMenuStore();

// Se você já tiver o multiselect_options compartilhado no app desktop,
// troque estas constantes por: import { multiselect_options } from '../../utils/validateForm'
const tones = [
  'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bbm', 'Bm',
];
const songTags = ["Adoração",
    "Advento",
    "Aliança",
    "Alegria",
    "Amor",
    "Aniversário",
    "Arrependimento",
    "Ascenção",
    "Avivamento",
    "Batismo",
    "Benção",
    "Bíblia",
    "Cantos Litúrgicos",
    "Comunhão",
    "Confiança",
    "Confissão",
    "Consolo",
    "Criação",
    "Crianças",
    "Datas Especiais",
    "Dependência de Deus",
    "Epifania",
    "Esperança",
    "Esperar em Deus",
    "Evangelho",
    "Família",
    "Fé e Justificação",
    "Graça",
    "Gratidão",
    "Igreja",
    "Jesus, o Redentor",
    "Jovens",
    "Juízo Final e Vida Eterna",
    "Lar Cristão",
    "Louvor",
    "Luz",
    "Manhã",
    "Matrimônio",
    "Meios da Graça",
    "Ministério – Ordenação e Instalação",
    "Missão",
    "Morte",
    "Morte e Sepultamento",
    "Natal",
    "Noite",
    "Obediência",
    "Oferta",
    "Oração",
    "Páscoa",
    "Paixão e Morte",
    "Palavra de Deus",
    "Passagem de ano",
    "Pátria",
    "Pentecostes",
    "Perdão",
    "Povo de Deus",
    "Proteção",
    "Proteção – Viagem",
    "Quebrantamento",
    "Quaresma",
    "Reconsagração",
    "Reforma",
    "Redenção",
    "Refeição",
    "Sabedoria",
    "Salmo",
    "Salvação",
    "Santa Ceia",
    "Santidade",
    "Santificação",
    "Servir",
    "Temor do Senhor",
    "Templo",
    "Trabalho",
    "Trindade",
    "Vida Cristã",
    "Vida Eterna",
    "Volta de Jesus"];

const emit = defineEmits<{ (e: 'saved', song: SongCache, mode: 'create' | 'edit'): void }>();

const dialog = ref(false);
const isValid = ref(false);
const form = ref<any>(null);
const saving = ref(false);
const showPreview = ref(false);

const groupId = ref('');
const editMode = ref(false);
const editingId = ref('');

const formData = ref({
  fullName: '',
  tone: '',
  writerBy: '',
  versionBy: '',
  melodyBy: '',
  youtubeLink: '',
  tags: [] as string[],
  lyric: '',
  coverUrl: '',
});

const rules = {
  required: (v: string) => !!v || 'Este campo é obrigatório.',
  minLength: (min: number) => (v: string) =>
    !v || v.length >= min || `Deve ter no mínimo ${min} caracteres.`,
  youtubeLink: (v: string) => {
    const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
    return !v || pattern.test(v) || 'Link do YouTube inválido.';
  },
};

const resetForm = () => {
  formData.value = {
    fullName: '', tone: '', writerBy: '', versionBy: '',
    melodyBy: '', youtubeLink: '', tags: [], lyric: '', coverUrl: '',
  };
  showPreview.value = false;
  itunesResults.value = [];
  itunesTerm.value = '';
  lyricSearchMeta.value = {};
  lyricMsg.value = '';
  pendingLyric.value = null;
};

// --- Importar de arquivo OpenLyrics (.xml) para preencher o formulário ---
const importing = ref(false);
const importError = ref('');

const importFromOpenLyrics = async () => {
  importError.value = '';
  importing.value = true;
  try {
    const files = await invoke<{ name: string; xml: string }[]>('pick_openlyrics_files');
    if (!files.length) return; // cancelou

    // Preenche a partir do primeiro arquivo selecionado.
    const parsed = parseOpenLyrics(files[0].xml, files[0].name, songTags);
    if (!parsed) {
      importError.value = 'Não foi possível ler este arquivo OpenLyrics.';
      return;
    }

    formData.value = {
      fullName: parsed.fullName,
      tone: formData.value.tone, // tom não vem do OpenLyrics; preserva o atual
      writerBy: parsed.writerBy ?? '',
      versionBy: parsed.versionBy ?? '',
      melodyBy: parsed.melodyBy ?? '',
      youtubeLink: formData.value.youtubeLink,
      tags: parsed.tags,
      lyric: parsed.lyric,
      coverUrl: formData.value.coverUrl, // preserva a capa já escolhida
    };
    showPreview.value = false;
  } catch (e) {
    console.error('Falha ao importar OpenLyrics', e);
    importError.value = 'Falha ao abrir o arquivo.';
  } finally {
    importing.value = false;
  }
};

// --- Busca online (iTunes Search API) ---
interface ItunesTrack {
  track_name: string;
  artist_name: string;
  collection_name?: string | null;
  artwork_url?: string | null;
  track_view_url?: string | null;
  release_year?: string | null;
  primary_genre?: string | null;
  duration_sec?: number | null;
}

const itunesTerm = ref('');
const lyricSearchMeta = ref<{ album?: string; duration?: number }>({});
const itunesResults = ref<ItunesTrack[]>([]);
const itunesLoading = ref(false);
const itunesError = ref('');
let itunesDebounce: ReturnType<typeof setTimeout> | null = null;

const onItunesInput = () => {
  if (itunesDebounce) clearTimeout(itunesDebounce);
  const term = itunesTerm.value.trim();
  if (term.length < 2) {
    itunesResults.value = [];
    return;
  }
  itunesDebounce = setTimeout(runItunesSearch, 450);
};

const runItunesSearch = async () => {
  const term = itunesTerm.value.trim();
  if (term.length < 2) return;
  itunesError.value = '';
  itunesLoading.value = true;
  try {
    itunesResults.value = await invoke<ItunesTrack[]>('search_itunes', { term });
    if (!itunesResults.value.length) itunesError.value = 'Nenhum resultado encontrado.';
  } catch (e) {
    console.error('Falha na busca iTunes', e);
    itunesError.value = 'Falha ao buscar. Verifique a conexão.';
  } finally {
    itunesLoading.value = false;
  }
};

/** Ao escolher um resultado: preenche nome/artista/capa sem apagar a letra. */
const applyItunesTrack = (t: ItunesTrack) => {
  formData.value.fullName = t.track_name;
  if (!formData.value.writerBy && t.artist_name) {
    formData.value.writerBy = t.artist_name;
  }
  if (t.artwork_url) formData.value.coverUrl = t.artwork_url;
  lyricSearchMeta.value = {
    album: t.collection_name ?? undefined,
    duration: t.duration_sec ?? undefined,
  };
  itunesResults.value = [];
  itunesTerm.value = '';
};

// --- Busca de letra online (LRCLIB → Vagalume, via Rust) ---
const lyricSearching = ref(false);
const lyricMsg = ref('');
const pendingLyric = ref<string | null>(null);

const stripLrc = (s?: string | null): string => {
  if (!s) return '';
  return s
    .replace(/\[\d{1,2}:\d{2}(?:\.\d{1,2})?\]/g, '') // remove [mm:ss.xx]
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
};

const searchLyricsOnline = async () => {
  const track = formData.value.fullName.trim();
  if (track.length < 2) {
    lyricMsg.value = 'Informe o nome da música antes de buscar a letra.';
    return;
  }
  lyricMsg.value = '';
  pendingLyric.value = null;
  lyricSearching.value = true;
  try {
    const res = await invoke<{
      lyrics?: string | null;
      synced?: string | null;
      source?: string | null;
      status: string;
    }>('fetch_lyrics', {
      trackName: track,
      artistName: formData.value.writerBy?.trim() || '',
      albumName: lyricSearchMeta.value.album ?? null,
      duration: lyricSearchMeta.value.duration ?? null,
    });

    if (res.status === 'instrumental') {
      lyricMsg.value = 'Faixa instrumental — sem letra.';
      return;
    }
    const text = (res.lyrics && res.lyrics.trim()) || stripLrc(res.synced);
    if (!text) {
      lyricMsg.value = 'Letra não encontrada online.';
      return;
    }

    const fonte = res.source === 'vagalume' ? 'Vagalume' : 'LRCLIB';
    if (!formData.value.lyric.trim()) {
      formData.value.lyric = text;
      showPreview.value = false;
      lyricMsg.value = `Letra importada de ${fonte}.`;
    } else {
      pendingLyric.value = text;
      lyricMsg.value = `Letra encontrada em ${fonte}. Substituir a letra atual?`;
    }
  } catch (e) {
    console.error('Falha ao buscar letra', e);
    lyricMsg.value = 'Falha ao buscar a letra. Verifique a conexão.';
  } finally {
    lyricSearching.value = false;
  }
};

const applyPendingLyric = () => {
  if (pendingLyric.value != null) {
    formData.value.lyric = pendingLyric.value;
    pendingLyric.value = null;
    showPreview.value = false;
    lyricMsg.value = 'Letra substituída.';
  }
};

const clearCover = () => { formData.value.coverUrl = ''; };

const openDialog = (gid: string, song?: SongCache) => {
  groupId.value = gid;
  resetForm();

  if (song) {
    editMode.value = true;
    editingId.value = song.id;
    formData.value = {
      fullName: song.fullName ?? '',
      tone: song.tone ?? '',
      writerBy: song.writerBy ?? '',
      versionBy: song.versionBy ?? '',
      melodyBy: song.melodyBy ?? '',
      youtubeLink: song.youtubeLink ?? '',
      tags: [...(song.tags ?? [])],
      lyric: song.lyric ?? '',
      coverUrl: song.coverUrl ?? '',
    };
  } else {
    editMode.value = false;
    editingId.value = '';
  }
  dialog.value = true;
};

const cancelForm = () => { dialog.value = false; };

const submitForm = async () => {
  const { valid } = await form.value.validate();
  if (!valid || saving.value) return;

  saving.value = true;
  try {
    const payload = {
      fullName: formData.value.fullName.trim(),
      tone: formData.value.tone || undefined,
      writerBy: formData.value.writerBy || undefined,
      versionBy: formData.value.versionBy || undefined,
      melodyBy: formData.value.melodyBy || undefined,
      youtubeLink: formData.value.youtubeLink || undefined,
      tags: formData.value.tags.length ? formData.value.tags : undefined,
      lyric: formData.value.lyric,
      coverUrl: formData.value.coverUrl || undefined,
    };

    const saved = editMode.value
      ? await localGroupStore.updateSong(groupId.value, editingId.value, payload)
      : await localGroupStore.addSong(groupId.value, payload);

    emit('saved', (saved ?? { ...payload, id: editingId.value }) as SongCache,
         editMode.value ? 'edit' : 'create');
    dialog.value = false;
  } finally {
    saving.value = false;
  }
};

// --- Refrão: mesma lógica do ModalAddFiles da web ---
const getTextarea = (): HTMLTextAreaElement | null => {
  const wrapper = document.getElementById('local-lyric-textarea');
  if (!wrapper) return null;
  return (wrapper.querySelector('textarea') ?? wrapper) as HTMLTextAreaElement;
};

const applyToSelectedLines = (transform: (line: string) => string) => {
  const textarea = getTextarea();
  if (!textarea) return;

  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const current = formData.value.lyric || '';
  if (!current) return;

  let lineStart = current.lastIndexOf('\n', start - 1);
  lineStart = lineStart === -1 ? 0 : lineStart + 1;

  let lineEnd = current.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = current.length;

  const result = current.substring(lineStart, lineEnd)
    .split('\n').map(transform).join('\n');

  formData.value.lyric =
    current.substring(0, lineStart) + result + current.substring(lineEnd);

  nextTick(() => {
    textarea.focus();
    textarea.setSelectionRange(lineStart, lineStart + result.length);
  });
};

const indentChorus = () => applyToSelectedLines(line => '     ' + line);
const unindentChorus = () => applyToSelectedLines(line => line.replace(/^ {1,5}/, ''));

// --- Pré-visualização: blocos separados por linha em branco ---
const previewBlocks = computed(() => {
  return (formData.value.lyric || '')
    .split(/\n\s*\n/)
    .map(b => b.replace(/\n+$/, ''))
    .filter(b => b.trim() !== '')
    .map(text => ({
      text,
      isChorus: text.split('\n').every(l => l.trim() === '' || l.startsWith('     ')),
    }));
});

watch(dialog, () => {
  menuStore.setShiftShortcutLocked(dialog.value)
})

defineExpose({ openDialog });
</script>

<template>
  <v-dialog v-model="dialog" max-width="760" persistent scrollable
    transition="dialog-bottom-transition">
    <v-card class="rounded-lg overflow-hidden">

      <!-- Header no mesmo padrão da web -->
      <div class="d-flex align-center justify-space-between px-5 py-0 bg-indigo-darken-1 text-white">
        <div class="d-flex align-center ga-3">
          <v-icon size="24">mdi-music-note-plus</v-icon>
          <h2 class="text-subtitle-1 font-weight-bold">
            {{ editMode ? 'Editar Música' : 'Cadastrar Música' }}
          </h2>
        </div>
        <div class="d-flex align-center ga-1">
          <v-btn variant="text" density="comfortable" color="white"
            prepend-icon="mdi-file-import-outline" :loading="importing"
            @click="importFromOpenLyrics">
            Importar letra
            <v-tooltip activator="parent" location="bottom">
              Preencher a partir de um arquivo OpenLyrics (.xml)
            </v-tooltip>
          </v-btn>
          <v-btn icon="mdi-close" variant="text" density="comfortable"
            color="white" @click="cancelForm" />
        </div>
      </div>

      <v-card-text class="pa-5" style="max-height: 72vh;">
        <v-alert v-if="importError" type="warning" variant="tonal"
          density="compact" class="mb-4" closable
          @click:close="importError = ''">
          {{ importError }}
        </v-alert>

        <!-- Busca online (iTunes) -->
        <div class="mb-4 pa-3 rounded-lg border bg-surface-light">
          <v-text-field v-model="itunesTerm" @update:model-value="onItunesInput"
            @keydown.enter.prevent="runItunesSearch"
            label="Buscar música online" placeholder="Título ou artista…"
            variant="outlined" density="comfortable" hide-details clearable
            prepend-inner-icon="mdi-magnify" :loading="itunesLoading" />

          <div v-if="itunesError" class="text-caption text-medium-emphasis mt-2">
            {{ itunesError }}
          </div>

          <v-list v-if="itunesResults.length" density="compact" class="mt-2 pa-0"
            style="max-height: 230px; overflow-y: auto; background: transparent;">
            <v-list-item v-for="(t, i) in itunesResults" :key="i"
              class="rounded mb-1" @click="applyItunesTrack(t)">
              <template #prepend>
                <v-avatar rounded="lg" size="44">
                  <v-img v-if="t.artwork_url" :src="t.artwork_url" cover />
                  <v-icon v-else>mdi-music</v-icon>
                </v-avatar>
              </template>
              <v-list-item-title class="text-body-2 font-weight-medium">
                {{ t.track_name }}
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                {{ t.artist_name }}<span v-if="t.collection_name"> · {{ t.collection_name }}</span><span v-if="t.release_year"> · {{ t.release_year }}</span>
              </v-list-item-subtitle>
              <template #append>
                <v-icon size="18" color="indigo-darken-1">mdi-arrow-down-left</v-icon>
              </template>
            </v-list-item>
          </v-list>

          <!-- Capa selecionada -->
          <div v-if="formData.coverUrl" class="d-flex align-center ga-3 mt-3">
            <v-avatar rounded="lg" size="56">
              <v-img :src="formData.coverUrl" cover />
            </v-avatar>
            <span class="text-caption text-medium-emphasis">Capa selecionada</span>
            <v-spacer />
            <v-btn size="small" variant="text" color="error"
              prepend-icon="mdi-close" @click="clearCover">Remover</v-btn>
          </div>
        </div>

        <v-form ref="form" v-model="isValid">
          <v-row dense>
            <v-col cols="12">
              <v-text-field v-model="formData.fullName"
                :rules="[rules.required, rules.minLength(3)]"
                label="Nome da Música *" variant="outlined" density="comfortable"
                prepend-inner-icon="mdi-music-note" />
            </v-col>

            <v-col cols="12" md="4">
              <v-select v-model="formData.tone" :items="tones" label="Tom Principal"
                variant="outlined" density="comfortable" clearable
                prepend-inner-icon="mdi-music-clef-treble" hide-details="auto" />
            </v-col>

            <v-col cols="12" md="8">
              <v-text-field v-model="formData.youtubeLink" :rules="[rules.youtubeLink]"
                label="Link do YouTube" variant="outlined" density="comfortable"
                prepend-inner-icon="mdi-youtube" hide-details="auto" />
            </v-col>

            <v-col cols="12" md="4">
              <v-text-field v-model="formData.writerBy" label="Escrito Por"
                variant="outlined" density="comfortable" hide-details="auto" />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="formData.versionBy" label="Versão Por"
                variant="outlined" density="comfortable" hide-details="auto" />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="formData.melodyBy" label="Melodia Por"
                variant="outlined" density="comfortable" hide-details="auto" />
            </v-col>

            <v-col cols="12">
              <v-autocomplete v-model="formData.tags" :items="songTags" label="Tags"
                multiple chips closable-chips clearable variant="outlined"
                density="comfortable" hide-details="auto" />
            </v-col>
          </v-row>

          <!-- Status da busca de letra online -->
          <v-alert v-if="lyricMsg" :type="pendingLyric ? 'info' : 'success'"
            variant="tonal" density="compact" class="mt-5" closable
            @click:close="lyricMsg = ''; pendingLyric = null">
            <div class="d-flex align-center justify-space-between ga-3 flex-wrap">
              <span>{{ lyricMsg }}</span>
              <v-btn v-if="pendingLyric" size="small" color="info" variant="flat"
                @click="applyPendingLyric">Substituir</v-btn>
            </div>
          </v-alert>

          <!-- Bloco da letra, espelhando o ModalAddFiles -->
          <div class="mt-5 pa-4 rounded-lg border bg-surface-light">
            <div class="d-flex justify-space-between align-center mb-3 flex-wrap ga-2">
              <span class="text-body-2 font-weight-bold text-medium-emphasis">
                Letra da Música
              </span>
              <div class="d-flex ga-2 flex-wrap justify-end">
                <v-btn size="small" variant="tonal" color="indigo-darken-1"
                  prepend-icon="mdi-cloud-search-outline" :loading="lyricSearching"
                  @click="searchLyricsOnline">
                  Buscar letra
                  <v-tooltip activator="parent" location="top">
                    Buscar a letra online (LRCLIB / Vagalume)
                  </v-tooltip>
                </v-btn>
                <v-btn size="small" variant="tonal" prepend-icon="mdi-format-indent-decrease"
                  @click="unindentChorus">
                  Desmarcar
                  <v-tooltip activator="parent" location="top">Remover os 5 espaços</v-tooltip>
                </v-btn>
                <v-btn size="small" variant="flat" color="indigo-darken-1"
                  prepend-icon="mdi-format-indent-increase" @click="indentChorus">
                  Marcar Refrão
                  <v-tooltip activator="parent" location="top">Adicionar 5 espaços</v-tooltip>
                </v-btn>
                <v-btn size="small" variant="flat" color="indigo"
                  :prepend-icon="showPreview ? 'mdi-pencil-outline' : 'mdi-eye-outline'"
                  :disabled="!formData.lyric" @click="showPreview = !showPreview">
                  {{ showPreview ? 'Editar' : 'Pré-visualizar' }}
                </v-btn>
              </div>
            </div>

            <v-textarea v-if="!showPreview" id="local-lyric-textarea"
              v-model="formData.lyric" rows="14" auto-grow variant="outlined"
              placeholder="Escreva ou cole a letra aqui..."
              class="font-mono text-body-2" hide-details spellcheck="false" />

            <div v-else class="d-flex flex-column ga-2">
              <div v-for="(block, i) in previewBlocks" :key="i"
                class="pa-3 rounded border bg-surface"
                :class="block.isChorus ? 'border-indigo' : ''">
                <div class="text-caption text-medium-emphasis mb-1">
                  {{ block.isChorus ? 'Refrão' : 'Verso ' + (i + 1) }}
                </div>
                <pre class="text-body-2 ma-0" style="white-space: pre-wrap; font-family: inherit;">{{ block.text }}</pre>
              </div>
              <div v-if="previewBlocks.length === 0"
                class="text-center pa-4 text-caption text-grey">
                Nada para pré-visualizar.
              </div>
            </div>
          </div>
        </v-form>
      </v-card-text>

      <v-divider />

      <div class="d-flex justify-end ga-2 px-5 py-3 bg-surface-light">
        <v-btn variant="text" class="font-weight-bold" @click="cancelForm">Cancelar</v-btn>
        <v-btn color="primary" variant="flat" class="font-weight-bold px-6"
          :loading="saving" @click="submitForm">
          Salvar <v-icon end>mdi-content-save-check</v-icon>
        </v-btn>
      </div>

    </v-card>
  </v-dialog>
</template>