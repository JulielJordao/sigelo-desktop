<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useMusicPresentationStore } from '../../stores/presentationStore';
import { useSongCacheStore } from '../../stores/songCacheStore';
import { useLocalGroupStore } from '../../stores/localGroupStore';
import type { SongCache } from '../../stores/songCacheStore';
import ModalLocalSong from '../songs/ModalLocalSong.vue';

const props = defineProps<{
  songs: Array<SongCache>;
  selectedId: string | null;
}>();

const musicStore = useMusicPresentationStore();
const songCacheStore = useSongCacheStore();
const localGroupStore = useLocalGroupStore();

// Só repertório local permite adicionar/editar/excluir músicas
const isLocal = computed(() => musicStore.isCurrentGroupLocal);

// --- Busca ---
const isSearchActive = ref(false);
const searchQuery = ref('');

const filteredSongs = computed(() => {
  if (!searchQuery.value) return props.songs;
  const q = searchQuery.value.toLowerCase();
  return props.songs.filter(song => song.fullName.toLowerCase().includes(q));
});

const toggleSearch = () => {
  isSearchActive.value = !isSearchActive.value;
  if (!isSearchActive.value) searchQuery.value = '';
};

// --- Scroll automático ---
const currentGroupId = ref('');
const hasToScrool = ref(false);

const scrollToElement = async (id: string) => {
  await nextTick();
  const element = document.getElementById(`song-item-${id}`);
  if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  hasToScrool.value = false;
};

watch(
  () => songCacheStore.selectedSong,
  async (newValue) => {
    if (currentGroupId.value !== newValue.songGroupId) {
      currentGroupId.value = newValue.songGroupId;
      await scrollToElement(newValue.id);
    } else {
      hasToScrool.value = true;
    }
  },
  { deep: true }
);

watch(
  () => musicStore.filteredSongs,
  () => {
    if (hasToScrool.value) scrollToElement(musicStore.selectedSongId);
  },
  { deep: true }
);

// --- Dialog de música (criar/editar) ---
const songModalRef = ref<InstanceType<typeof ModalLocalSong> | null>(null);

const openNewSong = () => songModalRef.value?.openDialog(musicStore.selectedGroupId)

const openEditSong = () => {
  const song = songCtx.value.song;
  if (!song) return;
  songCtx.value.open = false;
  songModalRef.value?.openDialog(musicStore.selectedGroupId, song);
};

const onSongSaved = (song: SongCache, mode: 'create' | 'edit') => {
  // Se editou a música que está no telão, atualiza a letra exibida na hora
  if (mode === 'edit' && musicStore.selectedSongId === song.id) {
    musicStore.rawLyric = song.lyric ?? '';
  }
};

// --- Menu de contexto da música ---
const songCtx = ref<{ open: boolean; x: number; y: number; song: SongCache | null }>({
  open: false, x: 0, y: 0, song: null,
});

const onSongContext = (e: MouseEvent, song: SongCache) => {
  if (!isLocal.value) return;
  songCtx.value = { open: true, x: e.clientX, y: e.clientY, song };
};

const confirmDeleteSong = ref({ open: false, id: '', name: '' });

const askDeleteSong = () => {
  const song = songCtx.value.song;
  if (!song) return;
  confirmDeleteSong.value = { open: true, id: song.id, name: song.fullName };
  songCtx.value.open = false;
};

const doDeleteSong = async () => {
  await localGroupStore.removeSong(musicStore.selectedGroupId, confirmDeleteSong.value.id);
  if (musicStore.selectedSongId === confirmDeleteSong.value.id) {
    musicStore.selectedSongId = '';
    musicStore.rawLyric = '';
  }
  confirmDeleteSong.value.open = false;
};
</script>

<template>
  <div class="d-flex flex-column h-100 overflow-hidden bg-surface-light">
    <v-toolbar density="compact" color="surface" elevation="0" class="border-b flex-grow-0 flex-shrink-0">
      <v-toolbar-title v-if="!isSearchActive" class="text-subtitle-2 font-weight-bold">
        Músicas ({{ filteredSongs.length }})
      </v-toolbar-title>

      <v-text-field v-else v-model="searchQuery" density="compact" variant="solo-filled" flat hide-details
        placeholder="Buscar música..." prepend-inner-icon="mdi-magnify" autofocus class="mx-2"></v-text-field>

      <v-spacer v-if="!isSearchActive"></v-spacer>

      <!-- Só aparece em repertório local -->
      <v-btn v-if="isLocal && !isSearchActive" icon density="comfortable" @click="openNewSong">
        <v-icon>mdi-plus</v-icon>
        <v-tooltip activator="parent" location="bottom">Adicionar música</v-tooltip>
      </v-btn>

      <v-btn icon density="comfortable" @click="toggleSearch">
        <v-icon>{{ isSearchActive ? 'mdi-close' : 'mdi-magnify' }}</v-icon>
      </v-btn>
    </v-toolbar>

    <div class="flex-grow-1 overflow-y-auto" style="min-height: 0;">
      <v-list density="compact" class="pa-2" nav>
        <v-list-item v-for="song in filteredSongs" :id="'song-item-' + song.id" :key="song.id" :value="song.id"
          :active="selectedId === song.id" color="primary" rounded="lg" class="mb-1 border"
          @click="musicStore.selectSong(song)" @contextmenu.prevent="onSongContext($event, song)">
          <v-list-item-title class="text-body-2 font-weight-medium">
            {{ song.fullName }}
          </v-list-item-title>
        </v-list-item>

        <div v-if="filteredSongs.length === 0" class="text-center pa-4 text-caption text-grey">
          {{ searchQuery
            ? 'Nenhuma música encontrada.'
            : (isLocal ? 'Adicione músicas com o botão +.' : 'Nenhuma música neste grupo.') }}
        </div>
      </v-list>
    </div>

    <!-- Menu do botão direito (só em repertório local) -->
    <v-menu v-model="songCtx.open" :target="[songCtx.x, songCtx.y]" location="bottom start">
      <v-list density="compact">
        <v-list-item prepend-icon="mdi-pencil" @click="openEditSong">
          <v-list-item-title>Editar música</v-list-item-title>
        </v-list-item>
        <v-list-item prepend-icon="mdi-delete" base-color="error" @click="askDeleteSong">
          <v-list-item-title>Excluir música</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>

    <!-- Criar / editar música -->
    <ModalLocalSong ref="songModalRef" @saved="onSongSaved" />

    <!-- Confirmar exclusão -->
    <v-dialog v-model="confirmDeleteSong.open" max-width="420">
      <v-card>
        <v-card-title class="text-subtitle-1">Excluir música</v-card-title>
        <v-card-text class="text-body-2">
          Excluir <strong>{{ confirmDeleteSong.name }}</strong> deste repertório?
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmDeleteSong.open = false">Cancelar</v-btn>
          <v-btn color="error" variant="flat" @click="doDeleteSong">Excluir</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>