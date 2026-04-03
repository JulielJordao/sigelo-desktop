<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
// Importamos o Store e o Tipo
import { useMediaStore, type MediaFile } from '../../stores/mediaStore'; 

const mediaStore = useMediaStore();

const isOpen = ref(false);

// Controles de Visualização (Específicos deste componente)
const viewMode = ref<'list' | 'grid'>('grid');
const expandedId = ref<string | null>(null);

const searchQuery = ref('');
const activeFilter = ref('all');
const sortBy = ref('name');
const sortDesc = ref(false);

const previewDialog = ref(false);
const previewFile = ref<MediaFile | null>(null);

const emit = defineEmits<{
  (e: 'project', file: MediaFile): void;
  (e: 'setFixed', file: MediaFile): void;
}>();

// Agora a computada observa o mediaStore em vez de uma ref local
const filteredAndSortedFiles = computed(() => {
  let result = mediaStore.mediaFiles;

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(f => f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q));
  }

  if (activeFilter.value === 'images') result = result.filter(f => !f.isVideo);
  if (activeFilter.value === 'videos') result = result.filter(f => f.isVideo);
  if (activeFilter.value === 'favorites') result = result.filter(f => f.isFavorite);

  result = [...result].sort((a, b) => { // Importante: criar uma cópia com [...result] antes do sort
    let comparison = 0;
    if (sortBy.value === 'name') comparison = a.name.localeCompare(b.name);
    if (sortBy.value === 'date') comparison = b.modifiedAt - a.modifiedAt;
    if (sortBy.value === 'type') comparison = (a.isVideo === b.isVideo) ? 0 : a.isVideo ? -1 : 1;
    return sortDesc.value ? comparison * -1 : comparison;
  });

  return result;
});

// Ações agora chamam o store
const toggleFavorite = (file: MediaFile) => {
  mediaStore.toggleFavorite(file.id);
};

const openPreview = (file: MediaFile) => {
  previewFile.value = file;
  previewDialog.value = true;
};

const toggleExpand = (id: string) => {
  expandedId.value = expandedId.value === id ? null : id;
};

// Salva a duração no store para que outros componentes também saibam o tamanho do vídeo!
const onVideoLoaded = (event: Event, file: MediaFile) => {
  const target = event.target as HTMLVideoElement;
  if (target.duration && !isNaN(target.duration)) {
    mediaStore.updateDuration(file.id, target.duration);
  }
};

const formatDuration = (seconds?: number) => {
  if (!seconds) return '--:--';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

defineExpose({open : () => { isOpen.value = true}});

onMounted(() => {
  // Pede para o store carregar os dados. 
  // Se você já tiver carregado no editor de slides, ele puxará os dados instantaneamente
  if (mediaStore.mediaFiles.length === 0) {
    mediaStore.loadMedia();
  }
});
</script>

<template>
   <v-navigation-drawer v-model="isOpen" width="400">
    <div class="d-flex flex-column fill-height bg-grey-lighten-4">
      
      <div class="bg-white elevation-1 z-10" style="position: sticky; top: 0; z-index: 10;">
        <v-toolbar density="compact" color="transparent" elevation="0">
          <v-toolbar-title class="text-subtitle-1 font-weight-bold">
            <v-icon start color="primary">mdi-multimedia</v-icon> Gerenciador
          </v-toolbar-title>
          <v-spacer></v-spacer>
          
          <v-btn-toggle v-model="viewMode" color="primary" mandatory density="compact" class="mr-2 border" variant="text">
            <v-btn value="grid" size="small" icon="mdi-view-grid-outline"></v-btn>
            <v-btn value="list" size="small" icon="mdi-view-list-outline"></v-btn>
          </v-btn-toggle>

          <v-btn icon="mdi-refresh" size="small" variant="text" @click="mediaStore.loadMedia" :loading="mediaStore.isLoading"></v-btn>
          <v-btn icon="mdi-close" size="small" variant="text" @click="isOpen = false"></v-btn>
        </v-toolbar>

        <div class="px-3 pb-3">
          <v-text-field v-model="searchQuery" density="compact" variant="solo-filled" flat hide-details placeholder="Buscar mídia..." prepend-inner-icon="mdi-magnify" class="mb-2"></v-text-field>
          <div class="d-flex align-center gap-2">
            <v-btn-toggle v-model="activeFilter" color="primary" mandatory density="compact" variant="outlined" class="flex-grow-1">
              <v-btn value="all" size="small">Tudo</v-btn>
              <v-btn value="images" size="small" icon="mdi-image"></v-btn>
              <v-btn value="videos" size="small" icon="mdi-video"></v-btn>
              <v-btn value="favorites" size="small" icon="mdi-heart"></v-btn>
            </v-btn-toggle>
            <v-menu>
              <template v-slot:activator="{ props }">
                <v-btn v-bind="props" icon="mdi-sort-variant" density="comfortable" variant="tonal"></v-btn>
              </template>
              <v-list density="compact">
                <v-list-item title="Nome" @click="sortBy = 'name'" :active="sortBy === 'name'"></v-list-item>
                <v-list-item title="Mais Recentes" @click="sortBy = 'date'" :active="sortBy === 'date'"></v-list-item>
                <v-list-item title="Tipo" @click="sortBy = 'type'" :active="sortBy === 'type'"></v-list-item>
              </v-list>
            </v-menu>
          </div>
        </div>
      </div>
      
      <div class="flex-grow-1 overflow-y-auto bg-transparent px-2 pb-4">
        
        <div v-if="viewMode === 'list'" class="pt-2">
          <v-slide-y-transition group>
            <v-card v-for="file in filteredAndSortedFiles" :key="file.id" class="mb-3 border-sm rounded-lg" elevation="0" hover>
              <div class="d-flex pa-2">
                <div class="preview-container mr-3 rounded-lg overflow-hidden cursor-pointer position-relative flex-shrink-0" @click="openPreview(file)">
                  <video v-if="file.isVideo" :src="`${file.url}#t=0.5`" class="w-100 h-100 object-cover" muted preload="metadata" @loadedmetadata="onVideoLoaded($event, file)"></video>
                  <v-img v-else :src="file.url" cover class="w-100 h-100"></v-img>
                  <div v-if="file.isVideo" class="duration-badge bg-black text-white text-caption px-1 rounded">{{ formatDuration(file.duration) }}</div>
                  <div v-if="file.isVideo" class="play-overlay"><v-icon color="white" size="large">mdi-play-circle-outline</v-icon></div>
                </div>
                
                <div class="flex-grow-1 overflow-hidden d-flex flex-column">
                  <div class="d-flex justify-space-between align-start">
                    <span class="text-subtitle-2 font-weight-bold text-truncate d-block flex-grow-1" :title="file.name">{{ file.name }}</span>
                    <v-btn size="x-small" variant="text" :icon="file.isFavorite ? 'mdi-heart' : 'mdi-heart-outline'" :color="file.isFavorite ? 'error' : 'grey'" @click="toggleFavorite(file)" density="compact" class="flex-shrink-0 ml-1"></v-btn>
                  </div>
                  <div class="d-flex align-center mt-1">
                    <v-chip size="x-small" color="primary" variant="flat" class="mr-1">{{ file.category }}</v-chip>
                    <v-icon size="x-small" :icon="file.isVideo ? 'mdi-video' : 'mdi-image'" class="mr-1 text-grey"></v-icon>
                  </div>
                  <v-spacer></v-spacer>
                  <div class="d-flex gap-2 mt-3">
                    <v-btn size="small" color="primary" variant="tonal" prepend-icon="mdi-projector" class="flex-grow-1" @click.stop="emit('project', file)">Projetar</v-btn>
                    <v-btn size="small" color="secondary" variant="outlined" icon="mdi-pin" @click.stop="emit('setFixed', file)"></v-btn>
                  </div>
                </div>
              </div>
            </v-card>
          </v-slide-y-transition>
        </div>

        <div v-else class="media-grid pt-2">
          <v-slide-y-transition group>
            <v-card 
              v-for="file in filteredAndSortedFiles" 
              :key="`grid-${file.id}`"
              :class="['border-sm rounded-lg overflow-hidden transition-all', expandedId === file.id ? 'grid-item-expanded' : 'cursor-pointer']"
              elevation="0" 
              hover
              @click="expandedId !== file.id && toggleExpand(file.id)"
            >
              <div v-if="expandedId === file.id" class="d-flex pa-2 position-relative bg-blue-grey-lighten-5">
                <v-btn icon="mdi-chevron-up" size="x-small" variant="text" class="position-absolute top-0 right-0 ma-1 z-10" @click.stop="toggleExpand(file.id)"></v-btn>
                
                <div class="preview-container mr-3 rounded-lg overflow-hidden cursor-pointer position-relative flex-shrink-0" @click.stop="openPreview(file)">
                  <video v-if="file.isVideo" :src="`${file.url}#t=0.5`" class="w-100 h-100 object-cover" muted preload="metadata" @loadedmetadata="onVideoLoaded($event, file)"></video>
                  <v-img v-else :src="file.url" cover class="w-100 h-100"></v-img>
                  <div v-if="file.isVideo" class="duration-badge bg-black text-white text-caption px-1 rounded">{{ formatDuration(file.duration) }}</div>
                  <div v-if="file.isVideo" class="play-overlay"><v-icon color="white" size="large">mdi-play-circle-outline</v-icon></div>
                </div>
                
                <div class="flex-grow-1 overflow-hidden d-flex flex-column pr-4">
                  <span class="text-subtitle-2 font-weight-bold text-truncate d-block" :title="file.name">{{ file.name }}</span>
                  <div class="d-flex gap-2 mt-auto">
                    <v-btn size="small" color="primary" variant="tonal" prepend-icon="mdi-projector" class="flex-grow-1 px-0" @click.stop="emit('project', file)">Projetar</v-btn>
                    <v-btn size="small" color="secondary" variant="outlined" icon="mdi-pin" @click.stop="emit('setFixed', file)"></v-btn>
                  </div>
                </div>
              </div>

              <div v-else class="d-flex flex-column h-100">
                <div class="square-preview position-relative bg-grey-lighten-3">
                  <video v-if="file.isVideo" :src="`${file.url}#t=0.5`" class="w-100 h-100 object-cover" muted preload="metadata"></video>
                  <v-img v-else :src="file.url" cover class="w-100 h-100"></v-img>
                  
                  <v-icon v-if="file.isVideo" color="white" size="small" class="position-absolute bottom-0 left-0 ma-1 text-shadow">mdi-video</v-icon>
                  <v-icon v-if="file.isFavorite" color="error" size="small" class="position-absolute top-0 right-0 ma-1">mdi-heart</v-icon>
                </div>
                <div class="pa-2 bg-white text-center">
                  <div class="text-caption font-weight-medium text-truncate" :title="file.name">{{ file.name }}</div>
                </div>
              </div>
            </v-card>
          </v-slide-y-transition>
        </div>

        <div v-if="!mediaStore.isLoading && filteredAndSortedFiles.length === 0" class="pa-6 text-center">
          <v-icon size="large" color="grey-lighten-1" class="mb-2">mdi-folder-search-outline</v-icon>
          <p class="text-caption text-medium-emphasis">Nenhum arquivo encontrado.</p>
        </div>
      </div>
    </div>
  </v-navigation-drawer>

  <v-dialog v-model="previewDialog" max-width="800">
    <v-card class="bg-black">
      <v-toolbar color="transparent" theme="dark" density="compact">
        <v-toolbar-title class="text-subtitle-1">{{ previewFile?.name }}</v-toolbar-title>
        <v-spacer></v-spacer>
        <v-btn icon="mdi-close" @click="previewDialog = false"></v-btn>
      </v-toolbar>
      <div class="pa-2 d-flex justify-center align-center" style="min-height: 400px;">
        <video v-if="previewFile?.isVideo" :src="previewFile.url" controls autoplay class="w-100 rounded" style="max-height: 60vh;"></video>
        <v-img v-else-if="previewFile" :src="previewFile.url" contain class="w-100 rounded" style="max-height: 60vh;"></v-img>
      </div>
      <v-card-actions class="pa-4 bg-grey-darken-4 justify-end">
        <v-btn color="grey" variant="text" @click="previewDialog = false">Fechar</v-btn>
        <v-btn color="secondary" prepend-icon="mdi-pin" @click="emit('setFixed', previewFile!); previewDialog = false">Fundo</v-btn>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-projector" @click="emit('project', previewFile!); previewDialog = false">Projetar Agora</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.gap-2 { gap: 8px; }
.object-cover { object-fit: cover; }
.text-shadow { text-shadow: 0px 1px 3px rgba(0,0,0,0.8); }

/* LISTA / EXPANDIDO */
.preview-container {
    width: 120px;
    height: 90px;
    background-color: #000;
}
.duration-badge {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(0,0,0,0.7) !important;
    font-size: 0.65rem !important;
    z-index: 2;
}
.play-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0,0,0,0.4);
    border-radius: 50%;
    padding: 2px;
    z-index: 1;
}

/* NOVA GRADE (GRID) */
.media-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
}
.grid-item-expanded {
    grid-column: 1 / -1; /* Ocupa as duas colunas */
    cursor: default;
}
.square-preview {
    aspect-ratio: 1; /* Garante que seja um quadrado perfeito */
    width: 100%;
}
.transition-all {
    transition: all 0.3s ease;
}
</style>