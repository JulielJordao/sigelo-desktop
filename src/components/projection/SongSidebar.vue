<script setup lang="ts">
import { ref, computed, watch, nextTick} from 'vue';
import { useMusicPresentationStore } from '../../stores/presentationStore';
import { useSongCacheStore } from '../../stores/songCacheStore';

const props = defineProps<{
  songs: Array<{ _id: string, fullName: string }>;
  selectedId: string | null;
}>();

const musicStore = useMusicPresentationStore()
const songCacheStore = useSongCacheStore()

/*
const emit = defineEmits<{
  (e: 'select', id: string): void
}>();*/

// --- Lógica de Busca ---
const isSearchActive = ref(false);
const searchQuery = ref('');

const currentGroupId = ref('')
const hasToScrool = ref(false)

const scrollToElement = async (id: string)  => {
  await nextTick();
      
  const element = document.getElementById(`song-item-${id}`);
  
  if (element) {
    element.scrollIntoView({ 
      behavior: 'smooth',
      block: 'center'    
    });
  }

  hasToScrool.value = false
}

watch(() => songCacheStore.selectedSong, async (newValue) => {
  
  if(currentGroupId.value != newValue.songGroupId) {

      await nextTick();
      
      const element = document.getElementById(`song-item-${newValue.songId}`);
      
      if (element) {
        element.scrollIntoView({ 
          behavior: 'smooth',
          block: 'center'    
        });
      }
  } else {
    hasToScrool.value = true
  } 
},
  { deep: true }) 

watch(() => musicStore.filteredSongs, () => {
  if(hasToScrool) {
    scrollToElement(musicStore.selectedSongId)
  }
},
  { deep: true })

const filteredSongs = computed(() => {
  if (!searchQuery.value) return props.songs;
  
  const lowerCaseQuery = searchQuery.value.toLowerCase();
  return props.songs.filter(song => 
    song.fullName.toLowerCase().includes(lowerCaseQuery)
  );
});

const toggleSearch = () => {
  isSearchActive.value = !isSearchActive.value;
  if (!isSearchActive.value) {
    searchQuery.value = ''; // Limpa a busca ao fechar
  }
};
</script>

<template>
  <div class="d-flex flex-column h-100 overflow-hidden bg-surface-light">
    
    <v-toolbar 
      density="compact" 
      color="surface" 
      elevation="0" 
      class="border-b flex-grow-0 flex-shrink-0"
    >
      <v-toolbar-title v-if="!isSearchActive" class="text-subtitle-2 font-weight-bold">
        Músicas ({{ filteredSongs.length }})
      </v-toolbar-title>
      
      <v-text-field
        v-else
        v-model="searchQuery"
        density="compact"
        variant="solo-filled"
        flat
        hide-details
        placeholder="Buscar música..."
        prepend-inner-icon="mdi-magnify"
        autofocus
        class="mx-2"
      ></v-text-field>

      <v-spacer v-if="!isSearchActive"></v-spacer>

      <v-btn icon density="comfortable" @click="toggleSearch">
        <v-icon>{{ isSearchActive ? 'mdi-close' : 'mdi-magnify' }}</v-icon>
      </v-btn>
    </v-toolbar>
    
    <div class="flex-grow-1 overflow-y-auto" style="min-height: 0;">
      
      <v-list density="compact" class="pa-2" nav>
        <v-list-item
          v-for="song in filteredSongs" 
          :id="'song-item-' + song._id"
          :key="song._id" 
          :value="song._id"
          :active="selectedId === song._id" 
          color="primary" 
          rounded="lg" 
          class="mb-1 border"
          @click="musicStore.selectSong(song._id)"
        >
          <v-list-item-title class="text-body-2 font-weight-medium">
            {{ song.fullName }}
          </v-list-item-title>
        </v-list-item>
        
        <div v-if="filteredSongs.length === 0" class="text-center pa-4 text-caption text-grey">
          {{ searchQuery ? 'Nenhuma música encontrada.' : 'Nenhuma música neste grupo.' }}
        </div>
      </v-list>
    </div>

  </div>
</template>