<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSongCacheStore } from '../../stores/songCacheStore' // Ajuste o caminho conforme seu projeto
import { useMenuStore } from "../../stores/menuStore"

const menuStore = useMenuStore()

// Props e Emits para controlar a abertura/fechamento e retornar a música escolhida
const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  },
  // Quando true, apenas emite 'select' e NÃO altera a música selecionada global.
  // Usado, por exemplo, para adicionar músicas a uma programação.
  emitOnly: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'select'])

const songStore = useSongCacheStore()
const searchQuery = ref('')

// Computed para ligar a prop modelValue ao v-model do v-dialog
const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const enableEnterKey = computed(() => {
  const search = searchResults.value
  if (search.length === 1) {
    return search[0].songs.length === 1
  }
  return false
})

// A mágica acontece aqui: reage em tempo real à digitação
const searchResults = computed(() => {
  if (!searchQuery.value) return []
  // Se o campo estiver vazio, não mostra nada
  if (!searchQuery.value.toLowerCase() || searchQuery.value.trim().toLowerCase() === '') {
    return []
  }
  return songStore.getSearchResult(searchQuery.value)
})

// Função para quando o usuário clicar em uma música da lista
const selectSong = (song: any) => {
  // Sempre avisa quem escuta o evento (ex.: a programação)
  emit('select', song)

  // Comportamento original (definir música global) só quando NÃO for emitOnly
  if (!props.emitOnly) {
    songStore.setSelectedSong(song)
  }

  // Limpa a busca e fecha a modal
  searchQuery.value = ''
  isOpen.value = false
}

const applySong = (e: KeyboardEvent) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (enableEnterKey.value) {
      selectSong(searchResults.value[0].songs[0])
    }
  }
}

watch(isOpen, () => {
  menuStore.setShiftShortcutLocked(isOpen.value)
})
</script>

<template>
  <v-dialog v-model="isOpen" max-width="600" transition="dialog-bottom-transition">
    <v-card rounded="lg">
      <v-toolbar color="transparent" density="compact" class="bg-surface-light px-2 pt-1" border="none">
        <v-icon color="primary" class="ml-3 mr-2 opacity-80">mdi-magnify</v-icon>
        <v-toolbar-title class="text-subtitle-1 font-weight-bold opacity-80">
          Buscar Rápida
        </v-toolbar-title>
        <v-spacer></v-spacer>
        <v-chip size="x-small" variant="text" class="mr-2 text-medium-emphasis">ESC</v-chip>
        <v-btn icon="mdi-close" variant="text" size="small" color="medium-emphasis" @click="isOpen = false"></v-btn>
      </v-toolbar>

      <v-card-text class="pa-4">
        <v-text-field v-model="searchQuery" label="Digite o nome da música..." variant="outlined" density="comfortable"
          hide-details clearable @keydown="applySong" autofocus class="mb-4">
          <template v-slot:append-inner v-if="enableEnterKey">
            <v-fade-transition>
              <v-chip size="x-small" color="grey" variant="tonal">Enter</v-chip>
            </v-fade-transition>
          </template>
        </v-text-field>

        <v-list v-if="searchResults.length > 0" lines="one" class="border rounded-lg">
          <template v-for="group in searchResults" :key="group.id">

            <v-list-subheader class="font-weight-bold text-primary bg-surface-light">
              {{ group.label }}
            </v-list-subheader>

            <v-list-item v-for="song in group.songs" :key="song.id" :title="song.fullName"
              class="cursor-pointer transition-swing" hover @click="selectSong(song)">
              <template v-slot:prepend>
                <v-icon icon="mdi-music-note-outline" size="small" color="grey"></v-icon>
              </template>
            </v-list-item>

            <v-divider></v-divider>
          </template>
        </v-list>

        <div v-else-if="searchQuery" class="d-flex flex-column align-center justify-center py-8 text-medium-emphasis">
          <v-icon icon="mdi-file-search-outline" size="large" class="mb-2"></v-icon>
          <span>Nenhuma música encontrada para "<b>{{ searchQuery }}</b>"</span>
        </div>

        <div v-else class="d-flex flex-column align-center justify-center py-8 text-disabled">
          <v-icon icon="mdi-keyboard-outline" size="large" class="mb-2"></v-icon>
          <span>Comece a digitar para buscar...</span>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>