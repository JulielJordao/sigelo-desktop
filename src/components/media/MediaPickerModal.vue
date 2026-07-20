<script setup lang="ts">
import { ref, computed } from 'vue';
import { useMediaStore, type MediaFile, type MediaContext } from '../../stores/mediaStore';
import SmartVideo from '../SmartVideo.vue';

const props = defineProps<{
    modelValue: boolean;
    replacing?: boolean;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'select', media: any): void;
}>();

const mediaStore = useMediaStore();

const isOpen = computed({
    get: () => props.modelValue,
    set: (v) => emit('update:modelValue', v),
});

const search = ref('');
const context = ref<MediaContext>('Media');

// lista base conforme o contexto selecionado
const contextFiles = computed<MediaFile[]>(() => {
    if (context.value === 'Media') return mediaStore.reproductionFiles || [];
    if (context.value === 'Theme') return mediaStore.themeFiles || [];
    // YouTube — confirmar o getter correto no store
    return [];
});

const filteredMedia = computed<MediaFile[]>(() => {
    const q = search.value.trim().toLowerCase();
    const list = contextFiles.value;
    if (!q) return list;
    return list.filter((m) => m.name.toLowerCase().includes(q));
});

// ===== preview interno =====
const previewFile = ref<MediaFile | null>(null);
const openPreview = (media: MediaFile) => { previewFile.value = media; };
const closePreview = () => { previewFile.value = null; };

const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
};

const confirmSelect = (media: MediaFile) => {
    emit('select', media);
    previewFile.value = null;
    isOpen.value = false;
};
</script>

<template>
    <v-dialog v-model="isOpen" max-width="640">
        <v-card rounded="lg">
            <v-toolbar color="deep-purple" density="compact">
                <v-btn v-if="previewFile" icon="mdi-arrow-left" variant="text" @click="closePreview"></v-btn>
                <v-toolbar-title class="text-subtitle-1 font-weight-bold">
                    {{ previewFile ? previewFile.name : (replacing ? 'Trocar mídia' : 'Adicionar Mídia') }}
                </v-toolbar-title>
                <v-spacer></v-spacer>
                <v-btn icon="mdi-close" variant="text" @click="isOpen = false"></v-btn>
            </v-toolbar>

            <!-- abas de contexto (só na listagem, não no preview) -->
            <v-tabs v-if="!previewFile" v-model="context" color="deep-purple" grow density="compact" class="border-b">
                <v-tab value="Media" class="text-caption font-weight-bold">
                    <v-icon start size="small">mdi-play-circle-outline</v-icon> Reprodução
                </v-tab>
                <v-tab value="Theme" class="text-caption font-weight-bold">
                    <v-icon start size="small">mdi-image-multiple</v-icon> Temas
                </v-tab>
            </v-tabs>

            <!-- ===== PREVIEW ===== -->
            <template v-if="previewFile">
                <div class="bg-black d-flex align-center justify-center position-relative" style="height: 320px;">
                    <SmartVideo v-if="previewFile.isVideo" :src="previewFile.url" class="w-100 h-100 object-cover"
                        controls preload="metadata" autoplay no-audio muted></SmartVideo>
                    <v-img v-else :src="previewFile.url" contain height="320" width="100%"></v-img>

                    <v-chip v-if="previewFile.isVideo" size="x-small" color="black" variant="flat"
                        class="position-absolute" style="bottom: 8px; left: 8px; opacity: 0.85;"
                        prepend-icon="mdi-volume-off">
                        Prévia sem áudio
                    </v-chip>
                </div>

                <v-card-text class="pa-4">
                    <div class="d-flex flex-wrap align-center mb-3" style="gap: 6px;">
                        <v-icon size="small" :icon="previewFile.isVideo ? 'mdi-video-box' : 'mdi-image-outline'"
                            color="medium-emphasis"></v-icon>
                        <v-chip size="x-small" color="primary" variant="tonal" class="font-weight-bold text-uppercase"
                            style="letter-spacing: 0.5px;">{{ previewFile.category }}</v-chip>
                        <template v-if="mediaStore.tagsByFiles[previewFile.id]?.length">
                            <v-chip v-for="(tag, i) in mediaStore.tagsByFiles[previewFile.id]" :key="i" size="x-small"
                                color="secondary" variant="flat" class="font-weight-medium px-2">{{ tag }}</v-chip>
                        </template>
                    </div>

                    <div class="d-flex gap-2">
                        <v-btn color="deep-purple" variant="flat"
                            :prepend-icon="replacing ? 'mdi-swap-horizontal' : 'mdi-plus'" class="flex-grow-1"
                            @click="confirmSelect(previewFile)">
                            {{ replacing ? 'Trocar por esta' : 'Adicionar à programação' }}
                        </v-btn>
                        <v-btn variant="text" @click="closePreview">Voltar</v-btn>
                    </div>
                </v-card-text>
            </template>

            <!-- ===== LISTA ===== -->
            <template v-else>
                <v-card-text class="pa-3">
                    <v-text-field v-model="search" label="Buscar mídia..." variant="outlined" density="comfortable"
                        hide-details clearable prepend-inner-icon="mdi-magnify" class="mb-3"></v-text-field>

                    <v-list v-if="filteredMedia.length > 0" class="border rounded-lg pa-0" density="compact"
                        style="max-height: 420px; overflow-y: auto;">
                        <template v-for="media in filteredMedia" :key="media.id">
                            <v-list-item @click="openPreview(media)" hover class="cursor-pointer py-2">
                                <template v-slot:prepend>
                                    <div
                                        class="preview-thumb mr-3 rounded-lg overflow-hidden position-relative flex-shrink-0">
                                        <SmartVideo v-if="media.isVideo" :src="media.url"
                                            class="w-100 h-100 object-cover" no-audio muted preload="metadata">
                                        </SmartVideo>
                                        <v-img v-else :src="media.url" cover class="w-100 h-100"></v-img>
                                        <div v-if="media.isVideo" class="duration-badge text-white px-1 rounded">
                                            {{ formatDuration(media.duration) }}
                                        </div>
                                        <div v-if="media.isVideo" class="play-overlay">
                                            <v-icon color="white" size="small">mdi-play-circle-outline</v-icon>
                                        </div>
                                    </div>
                                </template>

                                <v-list-item-title class="text-subtitle-2 font-weight-bold text-truncate">
                                    {{ media.name }}
                                </v-list-item-title>
                                <v-list-item-subtitle class="d-flex flex-wrap align-center mt-1" style="gap: 4px;">
                                    <v-chip size="x-small" color="primary" variant="tonal"
                                        class="font-weight-bold text-uppercase" style="letter-spacing: 0.5px;">
                                        {{ media.category }}
                                    </v-chip>
                                    <template v-if="mediaStore.tagsByFiles[media.id]?.length">
                                        <v-chip v-for="(tag, i) in mediaStore.tagsByFiles[media.id]" :key="i"
                                            size="x-small" color="secondary" variant="flat" class="px-2">{{ tag
                                            }}</v-chip>
                                    </template>
                                </v-list-item-subtitle>

                                <template v-slot:append>
                                    <v-icon color="medium-emphasis">mdi-chevron-right</v-icon>
                                </template>
                            </v-list-item>
                            <v-divider></v-divider>
                        </template>
                    </v-list>

                    <div v-else class="text-center py-8 text-grey">
                        <v-icon size="40" color="grey-lighten-2" class="mb-2">
                            {{ context === 'YouTube' ? 'mdi-youtube' : 'mdi-image-off' }}
                        </v-icon>
                        <p class="text-caption">Nenhuma mídia encontrada nesta categoria.</p>
                    </div>
                </v-card-text>
            </template>
        </v-card>
    </v-dialog>
</template>

<style scoped>
.preview-thumb {
    width: 80px;
    height: 56px;
    background-color: #000;
}

.duration-badge {
    position: absolute;
    bottom: 2px;
    right: 2px;
    background: rgba(0, 0, 0, 0.7);
    font-size: 0.6rem;
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