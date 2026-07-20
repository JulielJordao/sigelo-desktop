<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { usePresentationStore } from '../../stores/usePresentationStore'
import { useMusicPresentationStore } from '../../stores/presentationStore';
import SlidePreview from '../preview/SlidePreview.vue'
import { useMenuStore } from '../../stores/menuStore';
import { useConfigStore } from '../../stores/useConfigStore';

const menuStore = useMenuStore()
const configStore = useConfigStore()

const props = defineProps({
    modelValue: {
        type: Boolean,
        required: true
    },
    selectMode: { type: Boolean, default: false },
    selectedPresetId: { type: String as () => string | null, default: null },
})

const emit = defineEmits(['update:modelValue', 'select'])

const activeId = computed(() =>
    props.selectMode ? props.selectedPresetId : presentationStore.currentPresetId
);

const onCardClick = (preset: any) => {
    if (isDeleteMode.value) return;
    if (props.selectMode) {
        emit('select', preset.id);
    } else {
        presentationStore.applyPreset(preset.id);
    }
    isPresetModalOpen.value = false;
};

const isPresetModalOpen = computed({
    get: () => props.modelValue,
    set: (value) => emit('update:modelValue', value)
})

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

const toggleDeleteMode = () => {
    isDeleteMode.value = !isDeleteMode.value;
    if (isDeleteMode.value) {
        cancelEditing();
        closeSearch();
    }
};

const promptDelete = (preset: any) => {
    presetToDelete.value = preset;
    confirmDeleteModal.value = true;
};

const confirmDeletion = () => {
    if (presetToDelete.value) {
        presentationStore.deletePreset(presetToDelete.value.id);
    }

    confirmDeleteModal.value = false;
    presetToDelete.value = null;

    if (presentationStore.presets.length === 0) {
        isDeleteMode.value = false;
    }
};

// --- Lógica de Busca ---
const isSearchOpen = ref(false);
const searchQuery = ref('');
const searchInputRef = ref<any>(null);

const openSearch = async (initialChar = '') => {
    isSearchOpen.value = true;
    searchQuery.value = initialChar;
    await nextTick();
    const input = searchInputRef.value?.$el?.querySelector('input');
    if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
    }
};

const closeSearch = () => {
    isSearchOpen.value = false;
    searchQuery.value = '';
};

const filteredPresets = computed(() => {
    if (!searchQuery.value.trim()) {
        return presentationStore.presets;
    }
    const query = searchQuery.value.toLowerCase().trim();
    return presentationStore.presets.filter((preset: any) =>
        preset.name.toLowerCase().includes(query)
    );
});

// Listener global de teclado
const handleGlobalKeydown = (e: KeyboardEvent) => {
    if (!isPresetModalOpen.value) return;

    // ESC com prioridade hierárquica
    if (e.key === 'Escape') {
        // Se a confirmação de delete está aberta, deixa ela tratar
        if (confirmDeleteModal.value) return;

        // 1ª prioridade: fechar busca
        if (isSearchOpen.value) {
            e.preventDefault();
            e.stopPropagation();
            closeSearch();
            return;
        }

        // 2ª prioridade: sair do modo deletar
        if (isDeleteMode.value) {
            e.preventDefault();
            e.stopPropagation();
            isDeleteMode.value = false;
            return;
        }

        // 3ª prioridade: cancelar edição
        if (editingPresetId.value !== null) {
            e.preventDefault();
            e.stopPropagation();
            cancelEditing();
            return;
        }

        // Sem nenhum modo ativo → deixa o ESC fechar a modal naturalmente
        return;
    }

    // Bloqueios para abrir busca por digitação
    if (editingPresetId.value !== null) return;
    if (isDeleteMode.value) return;
    if (confirmDeleteModal.value) return;
    if (isSearchOpen.value) return;

    const target = e.target as HTMLElement;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;

    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key.length === 1 && /\S/.test(e.key)) {
        e.preventDefault();
        openSearch(e.key);
    }
};

onMounted(() => {
    window.addEventListener('keydown', handleGlobalKeydown, true);
});

onUnmounted(() => {
    window.removeEventListener('keydown', handleGlobalKeydown, true);
});

watch(isPresetModalOpen, (newVal) => {
    if (!newVal) {
        isDeleteMode.value = false;
        cancelEditing();
        closeSearch();
    }
    menuStore.setShiftShortcutLocked(newVal)
});
</script>

<template>
    <v-dialog v-model="isPresetModalOpen" max-width="900">
        <v-card rounded="lg">
            <v-card-title class="d-flex align-center border-b bg-surface-light pa-4">
                <v-icon icon="mdi-palette" class="mr-2" color="primary"></v-icon>
                Galeria de Temas
                <v-spacer></v-spacer>
                <v-btn v-if="selectMode" variant="text" size="small" class="mr-2"
                    prepend-icon="mdi-close-circle-outline"
                    @click="emit('select', null); isPresetModalOpen = false">
                    Sem tema
                </v-btn>

                <!-- Campo de busca expansível (à esquerda da lupa) -->
                <div class="search-wrapper" :class="{ 'is-open': isSearchOpen }">
                    <v-text-field v-show="isSearchOpen" ref="searchInputRef" v-model="searchQuery" density="compact"
                        variant="solo-filled" flat hide-details placeholder="Buscar tema..." clearable
                        class="search-field" @keyup.esc.stop="closeSearch" @click:clear="closeSearch"></v-text-field>
                </div>

                <v-tooltip :text="isSearchOpen ? 'Fechar busca' : 'Buscar tema'" location="bottom">
                    <template v-slot:activator="{ props }">
                        <v-btn v-bind="props" :icon="isSearchOpen ? 'mdi-magnify-close' : 'mdi-magnify'" variant="text"
                            :color="isSearchOpen ? 'primary' : 'medium-emphasis'" class="mr-1" :disabled="isDeleteMode"
                            @click="isSearchOpen ? closeSearch() : openSearch()"></v-btn>
                    </template>
                </v-tooltip>

                <v-tooltip :text="isDeleteMode ? 'Sair do modo de exclusão' : 'Excluir temas'" location="bottom">
                    <template v-slot:activator="{ props }">
                        <v-btn v-bind="props" icon="mdi-trash-can-outline" :variant="isDeleteMode ? 'tonal' : 'text'"
                            :color="isDeleteMode ? 'error' : 'medium-emphasis'" class="mr-2"
                            @click="toggleDeleteMode"></v-btn>
                    </template>
                </v-tooltip>

                <v-btn icon="mdi-close" variant="text" @click="isPresetModalOpen = false"></v-btn>
            </v-card-title>

            <v-card-text class="pa-6 bg-background">
                <div v-if="filteredPresets.length === 0" class="text-center py-8 text-medium-emphasis">
                    <v-icon icon="mdi-magnify-close" size="48" class="mb-2"></v-icon>
                    <div>Nenhum tema encontrado para "{{ searchQuery }}"</div>
                </div>

                <div v-else
                    style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 24px;">

                    <v-card v-for="preset in filteredPresets" :key="preset.id" hover
                        class="d-flex flex-column rounded-lg overflow-hidden border" :class="{
                            'border-primary border-md': activeId === preset.id && !isDeleteMode,
                            'border-error': isDeleteMode
                        }">

                        <div @click="onCardClick(preset)" :style="{ cursor: isDeleteMode ? 'default' : 'pointer' }">

                            <SlidePreview :design="preset.design"
                                :textStyle="preset.textStyles[songInfo.getCurrentSlideType]"
                                :text="songInfo.currentSlide.text" :screenRatio="configStore.screenRatio"
                                :editable="false" style="border-radius: 0;" :isFixedPreview="true"
                                :class="{ 'opacity-50': isDeleteMode }" :pauseVideo="true"
                                :isCoverSlide="songInfo.getCurrentSlideType === 'titulo'" />
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

                                <v-btn v-if="isDeleteMode" icon="mdi-delete" variant="text" size="small" color="error"
                                    @click.stop="promptDelete(preset)"></v-btn>

                                <v-btn v-else icon="mdi-pencil-outline" variant="text" size="small"
                                    color="medium-emphasis" @click.stop="startEditing(preset)"></v-btn>
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
                Tem certeza que deseja excluir o tema <strong>{{ presetToDelete?.name }}</strong>? Esta ação não pode
                ser
                desfeita.
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

<style scoped>
.search-wrapper {
    width: 0;
    overflow: hidden;
    transition: width 0.25s ease;
    margin-right: 0;
}

.search-wrapper.is-open {
    width: 240px;
    margin-right: 8px;
}

.search-field {
    width: 100%;
}
</style>