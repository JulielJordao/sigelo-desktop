<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useSongCacheStore } from '../../stores/songCacheStore'
import type { SearchMode, SongSearchMatch } from '../../stores/songCacheStore'
import { useMenuStore } from '../../stores/menuStore'

const menuStore = useMenuStore()
const songStore = useSongCacheStore()

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  // Quando true, apenas emite 'select' e NÃO altera a música selecionada global.
  emitOnly: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'select'])

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const searchQuery = ref('')
const mode = ref<SearchMode>('name')

// --- Debounce: busca por letra varre todo o cache, não vale rodar a cada tecla
const debouncedQuery = ref('')
const isSearching = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

watch([searchQuery, mode], ([q]) => {
  if (timer) clearTimeout(timer)
  const value = (q as string) ?? ''

  if (!value.trim()) {
    debouncedQuery.value = ''
    isSearching.value = false
    return
  }

  isSearching.value = true
  timer = setTimeout(() => {
    debouncedQuery.value = value
    isSearching.value = false
  }, mode.value === 'lyric' ? 220 : 80)
})

onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

const searchResults = computed(() => {
  if (!debouncedQuery.value.trim()) return []
  return songStore.getSearchResult(debouncedQuery.value, mode.value)
})

const totalSongs = computed(() =>
  searchResults.value.reduce((acc, g) => acc + g.songs.length, 0)
)

const resultCountText = computed(() => {
  const s = totalSongs.value
  const g = searchResults.value.length
  return `${s} música${s === 1 ? '' : 's'} em ${g} repertório${g === 1 ? '' : 's'}`
})

const enableEnterKey = computed(() => {
  const search = searchResults.value
  return search.length === 1 && search[0].songs.length === 1
})

const selectSong = (match: SongSearchMatch) => {
  // Tira o snippet: ele é só de exibição, não pode vazar para o estado do app
  const { snippet, ...song } = match

  emit('select', song)
  if (!props.emitOnly) songStore.setSelectedSong(song)

  searchQuery.value = ''
  debouncedQuery.value = ''
  isOpen.value = false
}

const applySong = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (enableEnterKey.value) selectSong(searchResults.value[0].songs[0])
  }
}

watch(isOpen, () => {
  menuStore.setShiftShortcutLocked(isOpen.value)
  if (!isOpen.value) {
    searchQuery.value = ''
    debouncedQuery.value = ''
  }
})
</script>

<template>
  <v-dialog v-model="isOpen" max-width="640" transition="dialog-bottom-transition">
    <v-card rounded="lg">
      <v-toolbar color="transparent" density="compact" class="bg-surface-light px-2 pt-1" border="none">
        <v-icon color="primary" class="ml-3 mr-2 opacity-80">mdi-magnify</v-icon>
        <v-toolbar-title class="text-subtitle-1 font-weight-bold opacity-80">
          Busca Rápida
        </v-toolbar-title>
        <v-spacer />
        <v-chip size="x-small" variant="text" class="mr-2 text-medium-emphasis">ESC</v-chip>
        <v-btn icon="mdi-close" variant="text" size="small" color="medium-emphasis" @click="isOpen = false" />
      </v-toolbar>

      <v-card-text class="pa-4">
        <!-- Toggle Nome / Letra -->
        <v-btn-toggle v-model="mode" mandatory density="comfortable" variant="outlined" divided class="mb-3 w-100">
          <v-btn value="name" class="flex-grow-1" prepend-icon="mdi-music-note">Nome</v-btn>
          <v-btn value="lyric" class="flex-grow-1" prepend-icon="mdi-text">Letra</v-btn>
        </v-btn-toggle>

        <v-text-field v-model="searchQuery"
          :label="mode === 'name' ? 'Digite o nome da música...' : 'Digite um trecho da letra...'" variant="outlined"
          density="comfortable" hide-details clearable autofocus spellcheck="false" @keydown="applySong" class="mb-3">
          <template v-slot:append-inner>
            <v-fade-transition>
              <v-chip v-if="enableEnterKey" size="x-small" color="grey" variant="tonal">Enter</v-chip>
            </v-fade-transition>
          </template>
        </v-text-field>

        <div v-if="searchResults.length > 0" class="text-caption text-medium-emphasis mb-1 px-1">
          {{ resultCountText }}
        </div>

        <v-list v-if="searchResults.length > 0" lines="one" class="border rounded-lg"
          style="max-height: 52vh; overflow-y: auto;">
          <template v-for="group in searchResults" :key="group.id">
            <v-list-subheader class="font-weight-bold bg-surface-light d-flex align-center ga-2"
              :class="group.isLocal ? 'text-secondary' : 'text-primary'">
              {{ group.label }}
              <v-chip v-if="group.isLocal" size="x-small" variant="tonal" color="secondary">local</v-chip>
              <v-spacer />
              <span class="text-caption text-medium-emphasis">{{ group.songs.length }}</span>
            </v-list-subheader>

            <v-list-item v-for="song in group.songs" :key="song.id" class="cursor-pointer transition-swing" hover
              @click="selectSong(song)">
              <template v-slot:prepend>
                <v-icon :icon="group.isLocal ? 'mdi-music-note-plus' : 'mdi-music-note-outline'" size="small"
                  color="grey" />
              </template>

              <v-list-item-title class="text-body-2">{{ song.fullName }}</v-list-item-title>

              <v-list-item-subtitle v-if="song.snippet" class="text-caption">
                {{ song.snippet.before
                }}<strong class="text-primary">{{ song.snippet.match }}</strong>{{ song.snippet.after }}
              </v-list-item-subtitle>
            </v-list-item>

            <v-divider />
          </template>
        </v-list>

        <div v-else-if="isSearching" class="d-flex justify-center py-8">
          <v-progress-circular indeterminate color="primary" size="28" />
        </div>

        <div v-else-if="searchQuery"
          class="d-flex flex-column align-center justify-center py-8 text-medium-emphasis text-center">
          <v-icon icon="mdi-file-search-outline" size="large" class="mb-2" />
          <span>Nenhum resultado para "<b>{{ searchQuery }}</b>"</span>
          <span class="text-caption text-disabled mt-1">
            {{ mode === 'lyric'
              ? 'A busca por letra só encontra letras já baixadas. Abra o repertório para sincronizar.'
              : 'Tente outro nome ou troque para busca por letra.' }}
          </span>
        </div>

        <div v-else class="d-flex flex-column align-center justify-center py-8 text-disabled">
          <v-icon icon="mdi-keyboard-outline" size="large" class="mb-2" />
          <span>Comece a digitar para buscar...</span>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>