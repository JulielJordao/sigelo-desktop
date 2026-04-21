<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { usePresentationStore } from '../../stores/usePresentationStore'
import { useMenuStore } from '../../stores/menuStore'

const menuStore = useMenuStore()

// Props e Emits para controlar a abertura/fechamento e retornar a música escolhida
const props = defineProps({
    modelValue: {
        type: Boolean,
        required: true
    }
})

const presentationStore = usePresentationStore()

const newPresetName = ref('')

const handleSavePreset = () => {
    // Evita salvar nomes vazios
    if (!newPresetName.value.trim()) return;

    // Chama a ação da Store que criamos
    presentationStore.saveCurrentAsPreset(newPresetName.value.trim());

    // Fecha a modal e limpa o campo
    isSavePresetOpen.value = false;
    newPresetName.value = '';
}

const emit = defineEmits(['update:modelValue'])

const isSavePresetOpen = computed({
    get: () => props.modelValue,
    set: (value) => emit('update:modelValue', value)
})

watch(isSavePresetOpen, () => {
  menuStore.setShiftShortcutLocked(isSavePresetOpen.value)
})

</script>

<template>
    <v-dialog v-model="isSavePresetOpen" max-width="400">
        <v-card rounded="lg">
            <v-card-title class="d-flex align-center border-b bg-surface-light pa-4 text-subtitle-1">
                <v-icon icon="mdi-content-save-cog" class="mr-2" color="primary"></v-icon>
                Salvar Novo Tema
            </v-card-title>

            <v-card-text class="pa-4 pt-6">
                <v-text-field v-model="newPresetName" label="Nome do Tema"
                    placeholder="Ex: Culto de Domingo, Acústico..." variant="outlined" density="comfortable"
                    autofocus hide-details @keyup.enter="handleSavePreset"></v-text-field>
            </v-card-text>

            <v-card-actions class="pa-4 pt-0 border-t bg-surface-light">
                <v-spacer></v-spacer>
                <v-btn variant="text" color="medium-emphasis" class="mt-2" @click="isSavePresetOpen = false">
                    Cancelar
                </v-btn>
                <v-btn class="mt-2" variant="flat" color="primary" @click="handleSavePreset" :disabled="!newPresetName.trim()">
                    Salvar Tema
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>
