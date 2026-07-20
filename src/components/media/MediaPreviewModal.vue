<script setup lang="ts">
import { computed } from 'vue';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import SmartVideo from '../SmartVideo.vue';

const props = defineProps<{
    modelValue: boolean;
    file: MediaFile | null;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'project', file: MediaFile): void;
}>();

const mediaStore = useMediaStore();

const isOpen = computed({
    get: () => props.modelValue,
    set: (v) => emit('update:modelValue', v),
});

const confirmProject = () => {
    if (props.file) emit('project', props.file);
    isOpen.value = false;
};
</script>

<template>
    <v-dialog v-model="isOpen" max-width="640">
        <v-card rounded="lg" v-if="file">
            <v-toolbar color="deep-purple" density="compact">
                <v-toolbar-title class="text-subtitle-1 font-weight-bold text-truncate">{{ file.name }}</v-toolbar-title>
                <v-spacer></v-spacer>
                <v-btn icon="mdi-close" variant="text" @click="isOpen = false"></v-btn>
            </v-toolbar>

            <div class="bg-black d-flex align-center justify-center position-relative" style="height: 320px;">
                <SmartVideo v-if="file.isVideo" :src="file.url" class="w-100 h-100 object-cover"
                    controls preload="metadata" autoplay no-audio muted></SmartVideo>
                <v-img v-else :src="file.url" contain height="320" width="100%"></v-img>

                <v-chip v-if="file.isVideo" size="x-small" color="black" variant="flat"
                    class="position-absolute" style="bottom: 8px; left: 8px; opacity: 0.85;"
                    prepend-icon="mdi-volume-off">
                    Prévia sem áudio
                </v-chip>
            </div>

            <v-card-text class="pa-4">
                <div class="d-flex flex-wrap align-center mb-3" style="gap: 6px;">
                    <v-icon size="small" :icon="file.isVideo ? 'mdi-video-box' : 'mdi-image-outline'"
                        color="medium-emphasis"></v-icon>
                    <v-chip size="x-small" color="primary" variant="tonal" class="font-weight-bold text-uppercase"
                        style="letter-spacing: 0.5px;">{{ file.category }}</v-chip>
                    <template v-if="mediaStore.tagsByFiles[file.id]?.length">
                        <v-chip v-for="(tag, i) in mediaStore.tagsByFiles[file.id]" :key="i" size="x-small"
                            color="secondary" variant="flat" class="px-2">{{ tag }}</v-chip>
                    </template>
                </div>

                <div class="d-flex gap-2">
                    <v-btn color="primary" variant="flat" prepend-icon="mdi-projector" class="flex-grow-1"
                        @click="confirmProject">Apresentar</v-btn>
                    <v-btn variant="text" @click="isOpen = false">Fechar</v-btn>
                </div>
            </v-card-text>
        </v-card>
    </v-dialog>
</template>

<style scoped>
.object-cover { object-fit: cover; }
.gap-2 { gap: 8px; }
</style>