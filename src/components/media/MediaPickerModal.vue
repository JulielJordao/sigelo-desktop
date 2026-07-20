<script setup lang="ts">
import { ref, computed } from 'vue';
import { useMediaStore } from '../../stores/mediaStore';

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

const filteredMedia = computed(() => {
    const q = search.value.trim().toLowerCase();
    const list = mediaStore.mediaFiles || [];
    if (!q) return list;
    return list.filter((m) => m.name.toLowerCase().includes(q));
});

const onSelect = (media: any) => {
    emit('select', media);
    isOpen.value = false;
};
</script>

<template>
    <v-dialog v-model="isOpen" max-width="600">
        <v-card rounded="lg">
            <v-toolbar color="deep-purple" density="compact">
                <v-toolbar-title class="text-subtitle-1 font-weight-bold">
                    {{ replacing ? 'Trocar mídia' : 'Adicionar Mídia' }}
                </v-toolbar-title>
                <v-spacer></v-spacer>
                <v-btn icon="mdi-close" variant="text" @click="isOpen = false"></v-btn>
            </v-toolbar>
            <v-card-text class="pa-3">
                <v-text-field v-model="search" label="Buscar mídia..." variant="outlined" density="comfortable"
                    hide-details clearable prepend-inner-icon="mdi-magnify" class="mb-3"></v-text-field>
                <v-list v-if="filteredMedia.length > 0" class="border rounded-lg" density="compact"
                    style="max-height: 400px; overflow-y: auto;">
                    <v-list-item v-for="media in filteredMedia" :key="media.id" @click="onSelect(media)" hover
                        class="cursor-pointer">
                        <template v-slot:prepend>
                            <v-avatar rounded="lg" size="40" class="mr-2">
                                <v-img v-if="!media.isVideo" :src="media.url" cover></v-img>
                                <v-icon v-else color="deep-purple">mdi-play-box</v-icon>
                            </v-avatar>
                        </template>
                        <v-list-item-title class="text-subtitle-2 text-truncate">{{ media.name }}</v-list-item-title>
                        <v-list-item-subtitle class="text-caption">{{ media.isVideo ? 'Vídeo' : 'Imagem' }} • {{ media.category }}</v-list-item-subtitle>
                    </v-list-item>
                </v-list>
                <div v-else class="text-center py-8 text-grey">
                    <v-icon size="40" color="grey-lighten-2" class="mb-2">mdi-image-off</v-icon>
                    <p class="text-caption">Nenhuma mídia encontrada.</p>
                </div>
            </v-card-text>
        </v-card>
    </v-dialog>
</template>