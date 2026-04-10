<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePresentationStore } from '../../stores/usePresentationStore'
import { useMusicPresentationStore } from '../../stores/presentationStore';
import SlidePreview from '../preview/SlidePreview.vue'

const props = defineProps({
    modelValue: {
        type: Boolean,
        required: true
    }
})

const emit = defineEmits(['update:modelValue'])

const isPresetModalOpen = computed({
    get: () => props.modelValue,
    set: (value) => emit('update:modelValue', value)
})

// TO REMOVE
const screenResolution = ref({ width: 1920, height: 1080 });
const screenRatio = computed(() => screenResolution.value.width / screenResolution.value.height);

const presentationStore = usePresentationStore()
const songInfo = useMusicPresentationStore()

// --- Lógica de Edição ---
const editingPresetId = ref<string | null>(null);
const renameBuffer = ref('');

const startEditing = (preset: any) => {
    editingPresetId.value = preset.id;
    renameBuffer.value = preset.name;
};

const cancelEditing = () => {
    editingPresetId.value = null;
    renameBuffer.value = '';
};

const saveEditing = () => {
    if (!renameBuffer.value.trim() || !editingPresetId.value) return;
    presentationStore.renamePreset(editingPresetId.value, renameBuffer.value.trim());
    cancelEditing();
};

// --- Lógica de Exclusão ---
const isDeleteMode = ref(false);
const confirmDeleteModal = ref(false);
const presetToDelete = ref<any>(null);

// Alterna o modo de exclusão (e cancela edições ativas por segurança)
const toggleDeleteMode = () => {
    isDeleteMode.value = !isDeleteMode.value;
    if (isDeleteMode.value) {
        cancelEditing();
    }
};

// Abre a modal de confirmação
const promptDelete = (preset: any) => {
    presetToDelete.value = preset;
    confirmDeleteModal.value = true;
};

// Efetiva a exclusão
const confirmDeletion = () => {
    if (presetToDelete.value) {
        presentationStore.deletePreset(presetToDelete.value.id);
    }
    
    confirmDeleteModal.value = false;
    presetToDelete.value = null;

    // Opcional: Sai do modo de exclusão se não houver mais presets
    if (presentationStore.presets.length === 0) {
        isDeleteMode.value = false;
    }
};

// Limpa os estados ao fechar a modal principal
watch(isPresetModalOpen, (newVal) => {
    if (!newVal) {
        isDeleteMode.value = false;
        cancelEditing();
    }
});
</script>

<template>
    <v-dialog v-model="isPresetModalOpen" max-width="900">
        <v-card rounded="lg">
            <v-card-title class="d-flex align-center border-b bg-surface-light pa-4">
                <v-icon icon="mdi-palette" class="mr-2" color="primary"></v-icon>
                Galeria de Temas
                <v-spacer></v-spacer>
                
                <v-tooltip :text="isDeleteMode ? 'Sair do modo de exclusão' : 'Excluir temas'" location="bottom">
                    <template v-slot:activator="{ props }">
                        <v-btn 
                            v-bind="props" 
                            icon="mdi-trash-can-outline" 
                            :variant="isDeleteMode ? 'tonal' : 'text'" 
                            :color="isDeleteMode ? 'error' : 'medium-emphasis'"
                            class="mr-2"
                            @click="toggleDeleteMode"
                        ></v-btn>
                    </template>
                </v-tooltip>

                <v-btn icon="mdi-close" variant="text" @click="isPresetModalOpen = false"></v-btn>
            </v-card-title>

            <v-card-text class="pa-6 bg-background">
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 24px;">

                    <v-card v-for="preset in presentationStore.presets" :key="preset.id" hover
                        class="d-flex flex-column rounded-lg overflow-hidden border"
                        :class="{ 
                            'border-primary border-md': presentationStore.currentPresetId === preset.id && !isDeleteMode,
                            'border-error': isDeleteMode 
                        }">
                        
                        <div @click="!isDeleteMode && (presentationStore.applyPreset(preset.id), isPresetModalOpen = false)"
                             :style="{ cursor: isDeleteMode ? 'default' : 'pointer' }">
                            <SlidePreview :design="preset.design"
                                :textStyle="presentationStore.textStyles[songInfo.getCurrentSlideType]"
                                :text="songInfo.currentSlide.text" :screenRatio="screenRatio" :editable="false"
                                style="height: 140px; border-radius: 0;" 
                                :class="{ 'opacity-50': isDeleteMode }" />
                        </div>

                        <div class="pa-2 bg-surface d-flex align-center justify-space-between" style="min-height: 52px;">

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

                                <v-btn v-if="isDeleteMode" icon="mdi-delete" variant="text" size="small" color="error"
                                    @click.stop="promptDelete(preset)"></v-btn>
                                
                                <v-btn v-else icon="mdi-pencil-outline" variant="text" size="small" color="medium-emphasis"
                                    @click.stop="startEditing(preset)"></v-btn>
                            </template>

                        </div>
                    </v-card>

                </div>
            </v-card-text>
        </v-card>
    </v-dialog>

    <v-dialog v-model="confirmDeleteModal" max-width="400" persistent>
        <v-card rounded="lg">
            <v-card-title class="text-h6 font-weight-bold text-error pt-4 px-4 pb-2">
                Excluir Tema
            </v-card-title>
            
            <v-card-text class="px-4 py-2">
                Tem certeza que deseja excluir o tema <strong>{{ presetToDelete?.name }}</strong>? Esta ação não pode ser desfeita.
            </v-card-text>

            <v-card-actions class="pa-4 pt-2">
                <v-spacer></v-spacer>
                <v-btn color="medium-emphasis" variant="text" @click="confirmDeleteModal = false">
                    Cancelar
                </v-btn>
                <v-btn color="error" variant="flat" @click="confirmDeletion">
                    Excluir
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>