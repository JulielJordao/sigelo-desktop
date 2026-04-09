<script setup lang="ts">

import { computed, ref } from 'vue'
import { usePresentationStore } from '../../stores/usePresentationStore'
import { useMusicPresentationStore } from '../../stores/presentationStore';
// import { useConfigStore } from '../../stores/useConfigStore';
import SlidePreview from '../preview/SlidePreview.vue'

// Props e Emits para controlar a abertura/fechamento e retornar a música escolhida
const props = defineProps({
    modelValue: {
        type: Boolean,
        required: true
    }
})

// TO REMOVE
const screenResolution = ref({ width: 1920, height: 1080 });
const screenRatio = computed(() => screenResolution.value.width / screenResolution.value.height);

// const configStore = useConfigStore()
const presentationStore = usePresentationStore()
const songInfo = useMusicPresentationStore()

// --- Lógica de Edição Inline do Nome do Preset ---
const editingPresetId = ref<string | null>(null);
const renameBuffer = ref('');

// Entra no modo de edição
const startEditing = (preset: any) => {
    editingPresetId.value = preset.id;
    renameBuffer.value = preset.name;
};

// Sai do modo de edição (Cancela)
const cancelEditing = () => {
    editingPresetId.value = null;
    renameBuffer.value = '';
};

// Salva a alteração
const saveEditing = () => {
    if (!renameBuffer.value.trim() || !editingPresetId.value) return;

    // Chama a função que já criamos na store
    // presentationStore.renamePreset(editingPresetId.value, renameBuffer.value.trim());

    // Sai do modo de edição
    cancelEditing();
};

const emit = defineEmits(['update:modelValue'])

const isPresetModalOpen = computed({
    get: () => props.modelValue,
    set: (value) => emit('update:modelValue', value)
})


</script>

<template>
    <v-dialog v-model="isPresetModalOpen" max-width="900">
        <v-card rounded="lg">
            <v-card-title class="d-flex align-center border-b bg-surface-light pa-4">
                <v-icon icon="mdi-palette" class="mr-2" color="primary"></v-icon>
                Galeria de Temas
                <v-spacer></v-spacer>
                <v-btn icon="mdi-close" variant="text" @click="isPresetModalOpen = false"></v-btn>
            </v-card-title>

            <v-card-text class="pa-6 bg-background">
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 24px;">

                    <v-card v-for="preset in presentationStore.presets" :key="preset.id" hover
                        class="d-flex flex-column rounded-lg overflow-hidden border"
                        :class="{ 'border-primary border-md': presentationStore.currentPresetId === preset.id }"
                        >
                        <div @click="presentationStore.applyPreset(preset.id); isPresetModalOpen = false;">
                            <SlidePreview :design="preset.design"
                                :textStyle="presentationStore.textStyles[songInfo.getCurrentSlideType]"
                                :text="songInfo.currentSlide.text" :screenRatio="screenRatio" :editable="false"
                                style="height: 140px; border-radius: 0;" />
                        </div>

                        <div class="pa-2 bg-surface d-flex align-center justify-space-between"
                            style="min-height: 52px;">

                            <template v-if="editingPresetId === preset.id">
                                <v-text-field v-model="renameBuffer" density="compact" variant="underlined" hide-details
                                    autofocus class="mr-2" @click.stop @keyup.enter="saveEditing"
                                    @keyup.esc="cancelEditing"></v-text-field>

                                <div class="d-flex flex-shrink-0">
                                    <v-btn icon="mdi-check" size="x-small" color="success" variant="text"
                                        @click.stop="saveEditing" :disabled="!renameBuffer.trim()"></v-btn>
                                    <v-btn icon="mdi-close" size="x-small" color="error" variant="text"
                                        @click.stop="cancelEditing"></v-btn>
                                </div>
                            </template>

                            <template v-else>
                                <span class="text-subtitle-2 font-weight-bold text-truncate ml-2" :title="preset.name">
                                    {{ preset.name }}
                                </span>

                                <v-btn icon="mdi-pencil-outline" variant="text" size="small" color="medium-emphasis"
                                    @click.stop="startEditing(preset)"></v-btn>
                            </template>

                        </div>
                    </v-card>

                </div>
            </v-card-text>
        </v-card>
    </v-dialog>
</template>