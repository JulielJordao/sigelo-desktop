<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch} from 'vue';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useMediaStore, type MediaFile, type MediaContext } from '../../stores/mediaStore';
import { useConfigStore } from '../../stores/useConfigStore';
import { useYoutubeStore } from '../../stores/useYoutubeStore';
import { useStatusPresentationStore } from '../../stores/statusPresentationStore';
import { useMenuStore } from "../../stores/menuStore"
import { message } from '@tauri-apps/plugin-dialog';
import MediaListItem from './MediaListItem.vue';

const menuStore = useMenuStore()
const configStore = useConfigStore();
const youtubeStore = useYoutubeStore()

const statusPresStore = useStatusPresentationStore();
const conf = configStore.settings;

const mediaStore = useMediaStore();

// --- CONTROLE SEGURO DE EVENTOS GLOBAIS DO TAURI ---
let isDestroyed = false;
let activeListeners: UnlistenFn[] = [];

// const isOpen = computed(() => menuStore.menuOpened === 'Media');
const currentContext = ref<MediaContext>('Media');
const isDragging = ref(false);

const viewMode = ref<'list' | 'grid'>('grid');
const expandedId = ref<string | null>(null);

const searchQuery = ref('');
const activeFilter = ref('all');
const sortBy = ref('name');
const sortDesc = ref(false);

const previewDialog = ref(false);
const previewFile = ref<MediaFile | null>(null);
const isProjecting = computed(()=> { return statusPresStore.status.isPresentation && statusPresStore.status.isPresentation === 'Media'});
const projectedFile = ref<MediaFile | null>(null);

const isPlaying = ref(true);
const isMuted = ref(false);
const isReloaded = ref(false);

// Estados para o Modal de Deletar
const deleteDialog = ref(false);
const fileToDelete = ref<MediaFile | null>(null);

// Quando receber o evento @projectFile da MediaSidebar:
const handleProjectFile = async (file: MediaFile) => {
  console.log("Projetando arquivo:", file);

  // CORREÇÃO 1: Força a janela a aparecer
  try {
    await statusPresStore.setNewPresentation('Media', conf.selectedMonitor)
  } catch (err) {
    console.error("Erro ao preparar janela de projeção:", err);
  }

  await emit('project-media', file);
  projectedFile.value = file;
  isPlaying.value = true;
};

// CORREÇÃO 3: Lógica dos botões de controle de mídia
const togglePlay = async () => {
  isReloaded.value = false;
  isPlaying.value = !isPlaying.value;
  // Dispara o comando para a janela de projeção
  await emit('media-control', { action: isPlaying.value ? 'play' : 'pause' });
};

const restartMedia = async () => {
  isReloaded.value = !isPlaying.value;

  await emit('media-control', { action: 'restart' });
};

const toggleVolume = async () => {
  isMuted.value = !isMuted.value;
  // Dispara o comando para a janela de projeção
  await emit('media-control', { action: isMuted.value ? 'mute' : 'unmute' });
};

// Quando receber o evento @setFixed da MediaSidebar:
const handleSetFixed = async (file: MediaFile) => {
  if (file.id === mediaStore.fixedMedia?.id) {
    await emit('set-fixed-media', null);
    statusPresStore.clean()
    mediaStore.setFixedMedia(null);
  } else {
    await emit('set-fixed-media', file);
    mediaStore.setFixedMedia(file);
  }
};

// Crie um botão "Limpar Tela" na sua interface e dispare isso para terminar a apresentação:
const clearPresentationScreen = async () => {
  statusPresStore.clean() // Isso vai acionar o Fundo Fixo na outra janela
  projectedFile.value = null
};

const filteredAndSortedFiles = computed(() => {
  let result = currentContext.value === 'Media'
    ? mediaStore.reproductionFiles
    : mediaStore.themeFiles;

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(f => f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q));
  }

  if (activeFilter.value === 'images') result = result.filter(f => !f.isVideo);
  if (activeFilter.value === 'videos') result = result.filter(f => f.isVideo);
  if (activeFilter.value === 'favorites') result = result.filter(f => f.isFavorite);

  result = [...result].sort((a, b) => {
    let comparison = 0;
    if (sortBy.value === 'name') comparison = a.name.localeCompare(b.name);
    if (sortBy.value === 'date') comparison = b.modifiedAt - a.modifiedAt;
    if (sortBy.value === 'type') comparison = (a.isVideo === b.isVideo) ? 0 : a.isVideo ? -1 : 1;
    return sortDesc.value ? comparison * -1 : comparison;
  });

  return result;
});

const toggleFavorite = (file: MediaFile) => { mediaStore.toggleFavorite(file.id); };

const openPreview = (file: MediaFile) => {
  previewFile.value = file;
  previewDialog.value = true;
};

const toggleExpand = (id: string) => {
  expandedId.value = expandedId.value === id ? null : id;
};

// Funções de Deletar
const confirmDeletePrompt = (file: MediaFile) => {
  fileToDelete.value = file;
  deleteDialog.value = true;
};

const executeDelete = async (completely: boolean) => {
  if (fileToDelete.value) {
    await mediaStore.deleteFile(fileToDelete.value.id, completely);
    youtubeStore.fetchCache()
  }
  deleteDialog.value = false;
  fileToDelete.value = null;
};

const onVideoLoaded = (event: Event, file: MediaFile) => {
  const target = event.target as HTMLVideoElement;
  if (target.duration && !isNaN(target.duration)) {
    mediaStore.updateDuration(file.id, target.duration);
  }
};

/*
const formatDuration = (seconds?: number) => {
  if (!seconds) return '--:--';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};
*/

onMounted(() => {
  isDestroyed = false;

  // 1. Escuta quando o arquivo entra na janela
  listen('tauri://drag-enter', () => {
    isDragging.value = true;
  }).then(unlisten => {
    // Se o componente morreu antes do listen terminar de carregar, mata o evento imediatamente
    if (isDestroyed) unlisten(); else activeListeners.push(unlisten);
  });

  // 2. Escuta quando o arquivo é solto
  listen('tauri://drag-drop', async (event: any) => {
    isDragging.value = false;
    const filePaths = event.payload.paths as string[];

    if (filePaths && filePaths.length > 0) {
      await mediaStore.addDroppedFiles(filePaths, currentContext.value);
    }
  }).then(unlisten => {
    if (isDestroyed) unlisten(); else activeListeners.push(unlisten);
  });

  // 3. Escuta quando cancela o arraste
  listen('tauri://drag-leave', () => {
    isDragging.value = false;
  }).then(unlisten => {
    if (isDestroyed) unlisten(); else activeListeners.push(unlisten);
  });

  if (mediaStore.mediaFiles.length === 0) {
    mediaStore.loadMedia();
  }
});

const editingId = ref<string | null>(null);
const editName = ref<string>('');
const showSaveAlert = ref(false)
const newNameFile = ref("")

// Inicia a edição ao dar duplo clique
const startEdit = (file: MediaFile) => {
  editingId.value = file.id;
  // Remove a extensão do arquivo para facilitar a edição pelo usuário
  const lastDotIndex = file.name.lastIndexOf('.');
  editName.value = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name;
};

// Cancela a edição
const cancelEdit = () => {
  editingId.value = null;
  editName.value = '';
};

// Salva o novo nome
const saveEdit = async (file: MediaFile) => {
  const trimmedName = editName.value.trim();
  if (!trimmedName || trimmedName === file.name.split('.')[0]) {
    
    cancelEdit();
    return;
  }

  const result = await mediaStore.renameMedia(file, trimmedName);

  if (result.success) {
    cancelEdit();
    newNameFile.value = trimmedName;
    showSaveAlert.value = true
  } else {
    await message(
      result.error + "",
      { title: 'Conflito de Nomes', kind: 'error' }
    );
  }
};

onUnmounted(() => {
  isDestroyed = true; // Levanta a bandeira que o componente morreu

  // Limpa todos os eventos que foram registrados com sucesso
  activeListeners.forEach(unlisten => unlisten());
  activeListeners = []; // Zera a lista
});

watch(previewDialog, () => {
  menuStore.setShiftShortcutLocked(previewDialog.value)
})

watch(deleteDialog, () => {
  menuStore.setShiftShortcutLocked(deleteDialog.value)
})

watch(editName, (value) => {
  const isEditing = (value && value != "") ? true : false
  menuStore.setShiftShortcutLocked(isEditing)
})

</script>

<template>
  <div class="d-flex flex-column fill-height">
    <div class="fill-height bg-background position-relative">

      <div v-show="isDragging" @click="isDragging = false"
        class="position-absolute top-0 left-0 w-100 h-100 d-flex flex-column align-center justify-center text-white cursor-pointer"
        style="background-color: rgba(var(--v-theme-primary), 0.95); z-index: 9999;">
        <div class="d-flex flex-column align-center">
          <v-icon size="80" class="mb-4">mdi-cloud-upload-outline</v-icon>
          <h2 class="text-h5 font-weight-bold text-center">Solte os arquivos aqui</h2>
          <p class="text-body-1">Eles serão salvos em "{{ currentContext === 'Media' ? 'Reprodução' : 'Temas' }}"</p>
        </div>
      </div>

      <div class="bg-surface elevation-1 z-10" style="position: sticky; top: 0; z-index: 10;">
        <v-toolbar density="compact" color="transparent" elevation="0">
          <v-toolbar-title class="text-subtitle-1 font-weight-bold">
            <v-icon start color="primary">mdi-multimedia</v-icon> Gerenciador
          </v-toolbar-title>
          <v-spacer></v-spacer>

          <v-btn-toggle v-model="viewMode" color="primary" mandatory density="compact" class="mr-2 border"
            variant="text">
            <v-btn value="grid" size="small" icon="mdi-view-grid-outline"></v-btn>
            <v-btn value="list" size="small" icon="mdi-view-list-outline"></v-btn>
          </v-btn-toggle>

          <v-btn icon="mdi-refresh" size="small" variant="text" @click="mediaStore.loadMedia"
            :loading="mediaStore.isLoading"></v-btn>
        </v-toolbar>

        <v-tabs v-model="currentContext" color="primary" grow density="compact" class="mb-2">
          <v-tab value="Media" class="text-caption font-weight-bold">
            <v-icon start size="small">mdi-play-circle-outline</v-icon> Reprodução
          </v-tab>
          <v-tab value="Theme" class="text-caption font-weight-bold">
            <v-icon start size="small">mdi-image-multiple</v-icon> Temas (Slides)
          </v-tab>
        </v-tabs>

        <div class="px-3 pb-3">
          <v-text-field v-model="searchQuery" density="compact" variant="solo-filled" flat hide-details
            placeholder="Buscar mídia..." prepend-inner-icon="mdi-magnify" class="mb-2"></v-text-field>
          <div class="d-flex align-center gap-2">
            <v-btn-toggle v-model="activeFilter" color="primary" mandatory density="compact" variant="outlined"
              class="flex-grow-1">
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

        <v-slide-y-transition>
          <v-card v-if="isProjecting && projectedFile" class="mb-4 border-md"
            style="border-color: rgb(var(--v-theme-error)) !important;" elevation="2">
            <div class="bg-error px-3 py-1 text-caption font-weight-bold d-flex align-center text-white">
              <v-icon start size="small">mdi-record-circle-outline</v-icon> AO VIVO NO TELÃO
              <v-spacer></v-spacer>
              <span class="text-uppercase" style="font-size: 0.65rem;">Controles de Apresentação</span>
            </div>
            <div class="pa-3 d-flex align-center bg-surface-variant">
              <div class="preview-container mr-3 rounded overflow-hidden flex-shrink-0"
                style="width: 80px; height: 60px;">
                <video v-if="projectedFile.isVideo" :src="`${projectedFile.url}#t=0.5`" class="w-100 h-100 object-cover"
                  muted></video>
                <v-img v-else :src="projectedFile.url" cover class="w-100 h-100"></v-img>
              </div>
              <div class="flex-grow-1 overflow-hidden">
                <div class="text-subtitle-2 font-weight-bold text-truncate mb-2">{{ projectedFile.name }}</div>
                <div class="d-flex gap-2">
                  <v-btn v-if="projectedFile.isVideo" :icon="isPlaying ? 'mdi-pause' : 'mdi-play'" size="small"
                    variant="tonal" @click="togglePlay">
                  </v-btn>
                  <v-btn v-if="projectedFile.isVideo" icon="mdi-replay" size="small" variant="tonal"
                    v-show="!isReloaded" @click="restartMedia" title="Reiniciar vídeo"></v-btn>
                  <v-btn v-if="projectedFile.isVideo" :icon="isMuted ? 'mdi-volume-off' : 'mdi-volume-high'"
                    size="small" variant="tonal" @click="toggleVolume"></v-btn>
                  <v-spacer></v-spacer>
                  <v-btn size="small" color="error" variant="flat" prepend-icon="mdi-stop"
                    @click="clearPresentationScreen">Parar Apresentação</v-btn>
                </div>
              </div>
            </div>
          </v-card>
        </v-slide-y-transition>

        <div v-if="viewMode === 'list'" class="pt-2">
          <v-slide-y-transition group>
            <v-card 
              v-for="file in filteredAndSortedFiles" 
              :key="file.id" 
              v-click-outside="{
                handler: () => { if (editingId === file.id) cancelEdit() },
                closeConditional: () => editingId === file.id
              }" 
              class="mb-3 border-sm rounded-lg" 
              elevation="0" 
              hover
            >
              <MediaListItem 
                :file="file"
                :is-projecting="isProjecting"
                :projected-file-id="projectedFile?.id"
                :fixed-media-id="mediaStore.fixedMedia?.id"
                :editing-id="editingId"
                v-model:edit-name="editName"
                :is-grid-expanded="false"
                
                @open-preview="openPreview"
                @toggle-favorite="toggleFavorite"
                @project="handleProjectFile"
                @set-fixed="handleSetFixed"
                @delete="confirmDeletePrompt"
                @start-edit="startEdit"
                @save-edit="saveEdit"
                @cancel-edit="cancelEdit"
                @video-loaded="onVideoLoaded"
              />
            </v-card>
          </v-slide-y-transition>
        </div>

        <div v-else class="media-grid pt-2">
          <transition-group name="slide-y">
            <v-card v-for="file in filteredAndSortedFiles" v-click-outside="{
              handler: () => { if (editingId === file.id) cancelEdit() },
              closeConditional: () => editingId === file.id
            }" :key="`grid-${file.id}`"
              :class="['border-sm rounded-lg overflow-hidden transition-all bg-surface', expandedId === file.id ? 'grid-item-expanded' : 'cursor-pointer']"
              elevation="0" hover @click="expandedId !== file.id && toggleExpand(file.id)">

              <MediaListItem 
                v-if="expandedId === file.id"
                :file="file"
                :is-projecting="isProjecting"
                :projected-file-id="projectedFile?.id"
                :fixed-media-id="mediaStore.fixedMedia?.id"
                :editing-id="editingId"
                v-model:edit-name="editName"
                :is-grid-expanded="true"
                
                @open-preview="openPreview"
                @toggle-favorite="toggleFavorite"
                @project="handleProjectFile"
                @set-fixed="handleSetFixed"
                @delete="confirmDeletePrompt"
                @collapse="toggleExpand"
                @start-edit="startEdit"
                @save-edit="saveEdit"
                @cancel-edit="cancelEdit"
                @video-loaded="onVideoLoaded"
              />

              <div v-else class="d-flex flex-column h-100 position-relative">
                <div v-if="projectedFile?.id === file.id"
                  class="position-absolute top-0 left-0 w-100 h-100 d-flex align-center justify-center bg-black opacity-70 z-10"
                  style="background: rgba(0,0,0,0.6)">
                  <v-icon color="success" size="large">mdi-projector-screen</v-icon>
                </div>

                <div class="square-preview position-relative bg-surface-variant" style="aspect-ratio: 1/1;">
                  <video v-if="file.isVideo" :src="`${file.url}#t=0.5`" class="w-100 h-100 object-cover" muted
                    preload="metadata"></video>
                  <v-img v-else :src="file.url" cover class="w-100 h-100"></v-img>

                  <v-icon v-if="file.isVideo" color="white" size="small"
                    class="position-absolute bottom-0 left-0 ma-1 text-shadow">mdi-video</v-icon>

                  <v-btn size="x-small" icon class="position-absolute top-0 right-0 ma-1"
                    :color="file.isFavorite ? 'error' : 'rgba(0,0,0,0.5)'" variant="flat"
                    style="color: white !important" @click.stop="toggleFavorite(file)">
                    <v-icon size="small">{{ file.isFavorite ? 'mdi-heart' : 'mdi-heart-outline' }}</v-icon>
                  </v-btn>
                </div>

                <div class="pa-2 bg-surface text-center">
                  <template v-if="editingId === file.id">
                    <div class="d-flex align-center w-100">
                      <v-text-field v-model="editName" density="compact" variant="underlined" hide-details autofocus
                        @keyup.enter="saveEdit(file)" @keyup.esc="cancelEdit"></v-text-field>
                      <v-btn icon="mdi-check" color="success" size="x-small" variant="text"
                        @click.stop="saveEdit(file)"></v-btn>
                    </div>
                  </template>
                  <template v-else>
                    <div class="text-caption font-weight-medium text-truncate cursor-text" :title="file.name"
                      @dblclick="startEdit(file)">
                      {{ file.name }}
                    </div>
                  </template>
                </div>
              </div>

            </v-card>
          </transition-group>
        </div>

        <div v-if="!mediaStore.isLoading && filteredAndSortedFiles.length === 0" class="pa-6 text-center">
          <v-icon size="large" color="medium-emphasis" class="mb-2">mdi-folder-search-outline</v-icon>
          <p class="text-caption text-medium-emphasis">Nenhum arquivo encontrado.</p>
        </div>
      </div>
    </div>
  </div>

  <v-dialog v-model="previewDialog" max-width="800">
    <v-card class="bg-black">
      <v-toolbar color="transparent" theme="dark" density="compact">
        <v-toolbar-title class="text-subtitle-1">{{ previewFile?.name }}</v-toolbar-title>
        <v-spacer></v-spacer>
        <v-btn icon="mdi-close" @click="previewDialog = false"></v-btn>
      </v-toolbar>
      <div class="pa-2 d-flex justify-center align-center" style="min-height: 400px;">
        <video v-if="previewFile?.isVideo" :src="previewFile.url" controls autoplay class="w-100 rounded"
          style="max-height: 60vh;"></video>
        <v-img v-else-if="previewFile" :src="previewFile.url" contain class="w-100 rounded"
          style="max-height: 60vh;"></v-img>
      </div>
      <v-card-actions class="pa-4 bg-grey-darken-4 justify-end">
        <v-btn color="grey" variant="text" @click="previewDialog = false">Fechar</v-btn>
        <v-btn color="secondary" prepend-icon="mdi-pin"
          @click="handleSetFixed(previewFile!); previewDialog = false">Fundo</v-btn>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-projector"
          @click="handleProjectFile(previewFile!); previewDialog = false">Projetar Agora</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="deleteDialog" max-width="450">
    <v-card>
      <v-card-title class="text-h6 d-flex align-center">
        <v-icon color="warning" start>mdi-alert</v-icon>
        Excluir Arquivo
      </v-card-title>
      <v-card-text>
        O que você deseja fazer com o arquivo <strong>{{ fileToDelete?.name }}</strong>?
      </v-card-text>

      <v-divider></v-divider>

      <v-card-actions class="d-flex flex-wrap gap-2 pa-3">
        <v-btn color="grey-darken-1" variant="text" @click="deleteDialog = false">
          Cancelar
        </v-btn>
        <v-spacer></v-spacer>
        <v-btn color="warning" variant="tonal" @click="executeDelete(false)"
          title="Apenas remove da lista visualmente até o próximo reload">
          Deletar (Ocultar)
        </v-btn>
        <v-btn color="error" variant="flat" prepend-icon="mdi-delete-forever" @click="executeDelete(true)"
          title="Apaga permanentemente do seu computador">
          Deletar Completamente
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-snackbar v-model="showSaveAlert" color="success" elevation="24" rounded="pill" :timeout="3000">
    <v-icon start icon="mdi-check-circle"></v-icon>
    Renomeado para **{{ newNameFile }}** com sucesso!

    <template v-slot:actions>
      <v-btn variant="text" @click="showSaveAlert = false">Fechar</v-btn>
    </template>
  </v-snackbar>
</template>

<style scoped>
.position-relative {
  position: relative;
}

.gap-2 {
  gap: 8px;
}

.object-cover {
  object-fit: cover;
}

.text-shadow {
  text-shadow: 0px 1px 3px rgba(0, 0, 0, 0.8);
}

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
  background: rgba(0, 0, 0, 0.7) !important;
  font-size: 0.65rem !important;
  z-index: 2;
}

.play-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.4);
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
  grid-column: 1 / -1;
  cursor: default;
}

.square-preview {
  aspect-ratio: 1;
  width: 100%;
}

.transition-all {
  transition: all 0.3s ease;
}

.media-grid {
  display: grid;
  overflow-x: hidden;
  width: 100%;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
}

.grid-item-expanded {
  grid-column: 1 / -1;
  max-width: 100vw;
}

.square-preview {
  aspect-ratio: 1 / 1;
  width: 100%;
}

.text-shadow {
  text-shadow: 0px 1px 3px rgba(0, 0, 0, 0.8);
}
</style>