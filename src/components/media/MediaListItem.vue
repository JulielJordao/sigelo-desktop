<script setup lang="ts">
import { ref } from "vue"
import type { MediaFile } from '../../stores/mediaStore'; // Ajuste o caminho se necessário
import TagEditModal from "./TagEditModal.vue"
import { useMediaStore } from "../../stores/mediaStore";
import { useStatusPresentationStore } from "../../stores/statusPresentationStore";

const mediaStore = useMediaStore()
const statusStore = useStatusPresentationStore()

const props = defineProps<{
    file: MediaFile;
    projectedFileId?: string;
    fixedMediaId?: string;
    editingId?: string | null;
    editName?: string;
    isGridExpanded?: boolean; // Define se está sendo usado dentro do grid expandido
}>();

const emit = defineEmits<{
    (e: 'update:editName', value: string): void;
    (e: 'open-preview', file: MediaFile): void;
    (e: 'toggle-favorite', file: MediaFile): void;
    (e: 'project', file: MediaFile): void;
    (e: 'set-fixed', file: MediaFile): void;
    (e: 'delete', file: MediaFile): void;
    (e: 'collapse', id: string): void;
    (e: 'start-edit', file: MediaFile): void;
    (e: 'save-edit', file: MediaFile): void;
    (e: 'cancel-edit'): void;
    (e: 'video-loaded', event: Event, file: MediaFile): void;
}>();

// Formatação local do tempo
const formatDuration = (seconds?: number) => {
    console.log(props)
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
};

const isTagModalOpen = ref(false);

// Função para abrir o modal quando clicar no botão da música
const openTagModal = () => {
    isTagModalOpen.value = true;
};

</script>

<template>
    <div class="d-flex pa-2 bg-surface-light" :class="{ 'position-relative': isGridExpanded }">

        <v-btn v-if="isGridExpanded" icon="mdi-chevron-up" size="x-small" variant="text"
            class="position-absolute top-0 right-0 ma-1 z-10" @click.stop="emit('collapse', file.id)"></v-btn>

        <div class="preview-container mr-3 rounded-lg overflow-hidden cursor-pointer position-relative flex-shrink-0"
            @click.stop="emit('open-preview', file)">
            <video v-if="file.isVideo" :src="`${file.url}#t=0.5`" class="w-100 h-100 object-cover" muted
                preload="metadata" @loadedmetadata="emit('video-loaded', $event, file)"></video>
            <v-img v-else :src="file.url" cover class="w-100 h-100"></v-img>

            <div v-if="file.isVideo" class="duration-badge bg-black text-white text-caption px-1 rounded">
                {{ formatDuration(file.duration) }}
            </div>
            <div v-if="file.isVideo" class="play-overlay">
                <v-icon color="white" size="large">mdi-play-circle-outline</v-icon>
            </div>
        </div>

        <div class="flex-grow-1 overflow-hidden d-flex flex-column" :class="{ 'pr-4': isGridExpanded }">

            <div class="d-flex justify-space-between align-start w-100" :class="{ 'mt-3': isGridExpanded }">
                <template v-if="editingId === file.id">
                    <div class="d-flex align-center w-100" :class="isGridExpanded ? 'mb-1' : 'mr-2'">
                        <v-text-field :model-value="editName" @update:model-value="emit('update:editName', $event)"
                            density="compact" variant="outlined" hide-details autofocus
                            @keyup.enter="emit('save-edit', file)" @keyup.esc="emit('cancel-edit')"></v-text-field>
                        <v-btn icon="mdi-check" color="success" size="x-small" variant="text"
                            @click.stop="emit('save-edit', file)"></v-btn>
                        <v-btn icon="mdi-close" color="error" size="x-small" variant="text"
                            @click.stop="emit('cancel-edit')"></v-btn>
                    </div>
                </template>
                <template v-else>
                    <span class="text-subtitle-2 font-weight-bold text-truncate d-block flex-grow-1 cursor-text"
                        :title="file.name" @dblclick.stop="emit('start-edit', file)">
                        {{ file.name }}
                    </span>
                    <v-btn size="x-small" variant="text" :icon="file.isFavorite ? 'mdi-heart' : 'mdi-heart-outline'"
                        :color="file.isFavorite ? 'error' : 'medium-emphasis'"
                        @click.stop="emit('toggle-favorite', file)" density="compact"
                        class="flex-shrink-0 ml-1"></v-btn>
                </template>
            </div>

            <div class="d-flex flex-wrap align-center mt-2 mb-2" style="gap: 6px;">

                <v-icon size="small" :icon="file.isVideo ? 'mdi-video-box' : 'mdi-image-outline'"
                    color="medium-emphasis" title="Tipo de Mídia"></v-icon>

                <v-chip size="x-small" color="primary" variant="tonal" class="font-weight-bold text-uppercase"
                    style="letter-spacing: 0.5px;">
                    {{ file.category }}
                </v-chip>

                <v-divider vertical class="mx-1" style="max-height: 14px; opacity: 0.5;"></v-divider>

                <template v-if="mediaStore.tagsByFiles[file.id] && mediaStore.tagsByFiles[file.id].length > 0">
                    <v-chip 
                    v-for="(tag, index) in mediaStore.tagsByFiles[file.id]" 
                    :key="index"
                    size="x-small" 
                    color="secondary" 
                    variant="flat" 
                    class="font-weight-medium px-2" 
                    @dblclick.stop="openTagModal()"
                    >
                    {{ tag }}
                    </v-chip>
                </template>

                <v-btn icon="mdi-plus-circle-outline" size="x-small" variant="text" color="medium-emphasis"
                    density="compact" class="opacity-60" title="Gerenciar Tags" @click.stop="openTagModal()"></v-btn>

            </div>

            <v-spacer v-if="!isGridExpanded"></v-spacer>

            <div class="d-flex gap-2" :class="isGridExpanded ? 'mt-auto' : 'mt-2'">
                <v-btn size="small" :color="statusStore.projectedFile?.id === file.id  && statusStore.status.isPresentation === 'Media' ? 'success' : 'primary'" variant="tonal"
                    :prepend-icon="statusStore.projectedFile?.id === file.id  && statusStore.status.isPresentation === 'Media' ? 'mdi-projector-screen' : 'mdi-projector'"
                    class="flex-grow-1" :class="{ 'px-0': isGridExpanded }" @click.stop="emit('project', file)">
                    {{ statusStore.projectedFile?.id === file.id && statusStore.status.isPresentation === 'Media' ? 'Projetando...' : 'Projetar' }}
                </v-btn>
                <v-btn size="small" :icon="fixedMediaId === file.id ? 'mdi-pin-off' : 'mdi-pin'"
                    :color="fixedMediaId === file.id ? 'success' : 'secondary'"
                    :variant="fixedMediaId === file.id ? 'flat' : 'outlined'"
                    @click.stop="emit('set-fixed', file)"></v-btn>
                <v-btn size="small" color="error" variant="text" icon="mdi-delete"
                    @click.stop="emit('delete', file)"></v-btn>
            </div>
            <TagEditModal v-model="isTagModalOpen" :media-id="file.id" :media-name="file.name" :initial-tags="[]" />

        </div>
    </div>
</template>

<style scoped>
/* Transfira para cá apenas o CSS que pertence a este escopo */
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

.object-cover {
    object-fit: cover;
}

.gap-2 {
    gap: 8px;
}
</style>