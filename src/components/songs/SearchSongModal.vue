<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSongCacheStore } from '../../stores/songCacheStore' // Ajuste o caminho conforme seu projeto

// Props e Emits para controlar a abertura/fechamento e retornar a música escolhida
const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  }
})

const emit = defineEmits(['update:modelValue'])

const songStore = useSongCacheStore()
const searchQuery = ref('')

// Computed para ligar a prop modelValue ao v-model do v-dialog
const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// A mágica acontece aqui: reage em tempo real à digitação
const searchResults = computed(() => {
  // Se o campo estiver vazio, não mostra nada
  if (!searchQuery.value.toLowerCase() || searchQuery.value.trim().toLowerCase() === '') {
    return []
  }
  return songStore.getSearchResult(searchQuery.value)
})

// Função para quando o usuário clicar em uma música da lista
const selectSong = (song: any) => { 
  songStore.setSelectedSong(song)
  
  // Limpa a busca e fecha a modal
  searchQuery.value = ''
  isOpen.value = false
}
</script>

<template>
  <v-dialog v-model="isOpen" max-width="600" transition="dialog-bottom-transition">
    <v-card rounded="lg">
      <v-card-title class="d-flex align-center bg-surface-light px-4 py-3 border-b">
        <v-icon icon="mdi-magnify" class="mr-2" color="primary"></v-icon>
        Buscar Música no Cache
        <v-spacer></v-spacer>
        <v-btn icon="mdi-close" variant="text" size="small" @click="isOpen = false"></v-btn>
      </v-card-title>

      <v-card-text class="pa-4">
        <v-text-field
          v-model="searchQuery"
          label="Digite o nome da música..."
          variant="outlined"
          density="comfortable"
          hide-details
          clearable
          autofocus
          class="mb-4"
        ></v-text-field>

        <v-list v-if="searchResults.length > 0" lines="one" class="border rounded-lg">
          <template v-for="group in searchResults" :key="group.id">
            
            <v-list-subheader class="font-weight-bold text-primary bg-surface-light">
              {{ group.label }}
            </v-list-subheader>

            <v-list-item
              v-for="song in group.songs"
              :key="song.id"
              :title="song.fullName"
              class="cursor-pointer transition-swing"
              hover
              @click="selectSong(song)"
            >
              <template v-slot:prepend>
                <v-icon icon="mdi-music-note-outline" size="small" color="grey"></v-icon>
              </template>
            </v-list-item>
            
            <v-divider></v-divider>
          </template>
        </v-list>

        <div 
          v-else-if="searchQuery" 
          class="d-flex flex-column align-center justify-center py-8 text-medium-emphasis"
        >
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