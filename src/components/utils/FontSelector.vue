<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useFontStore } from '../../stores/useFontStore';
import { useMenuStore } from '../../stores/menuStore'; // Ajuste o caminho se necessário

const menuStore = useMenuStore();
const props = defineProps<{
    modelValue: string | null | undefined;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', val: string | null): void;
    (e: 'update:fontPath', path: string): void;
    (e: 'update:fontFileName', fileName: string): void;
}>();
const fontStore = useFontStore();

onMounted(async () => {
    if (fontStore.allFonts.length === 0) {
        await fontStore.loadDefaultFonts();
    }
    if (fontStore.customFonts.length === 0) {
        await fontStore.loadCustomFonts();
    }
});

const updateValue = (val: string | null) => {
    emit('update:modelValue', val);

    if (val) {
        const found = fontStore.allFonts.find((f: any) => f.value === val || f.title === val);
        // Para fontes custom: emite o caminho absoluto
        const path = found?.isCustom ? (found.filePath || '') : '';
        emit('update:fontPath', path);
        // Para fontes padrão: emite o fileName original (ex: "Inter_18pt-Regular")
        // pra que o servidor ache o arquivo correto
        const fileName = !found?.isCustom ? (found?.fileName || val) : '';
        emit('update:fontFileName', fileName);
    } else {
        emit('update:fontPath', '');
        emit('update:fontFileName', '');
    }
};

// --- CONTROLE DE FOCO E ATALHOS ---
const isFocused = ref(false);

const handleFocus = () => {
    isFocused.value = true;
    menuStore.setShiftShortcutLocked(true); // Bloqueia o atalho ao entrar no campo
};

const handleBlur = () => {
    isFocused.value = false;
    menuStore.setShiftShortcutLocked(false); // Libera o atalho ao sair do campo
};

// Regra de Segurança: Se o componente for destruído enquanto estiver focado,
// garantimos que o atalho não fique preso para sempre.
onUnmounted(() => {
    if (isFocused.value) {
        menuStore.setShiftShortcutLocked(false);
    }
});
</script>

<template>
    <div>
        <p class="text-caption font-weight-bold mb-2 d-flex align-center justify-space-between">
            Família da Fonte
            <v-progress-circular v-if="fontStore.isLoading" indeterminate size="16" width="2"
                color="primary"></v-progress-circular>
        </p>

        <v-autocomplete :model-value="props.modelValue" @update:model-value="updateValue" @focus="handleFocus"
            @blur="handleBlur" :items="fontStore.allFonts" item-title="title" item-value="value" variant="outlined"
            density="compact" hide-details placeholder="Pesquise uma fonte..." no-data-text="Nenhuma fonte encontrada">
            <template #append-inner>
                <v-tooltip text="Importar nova fonte (.ttf / .otf)" location="top">
                    <template #activator="{ props: tooltipProps }">
                        <v-btn v-bind="tooltipProps" icon="mdi-plus" variant="tonal" color="primary" size="small"
                            class="mt-n1" @click="fontStore.addNewFont" :loading="fontStore.isLoading"></v-btn>
                    </template>
                </v-tooltip>
            </template>

            <template #item="{ props: itemProps, item }">
                <v-list-item v-bind="itemProps">
                    <template #title>
                        <div class="d-flex align-center justify-space-between w-100">
                            <span :style="{ fontFamily: item.value, fontSize: '16px' }">
                                {{ item.title }}
                            </span>

                            <v-chip v-if="item.isCustom || item.isCustom" size="x-small" color="success" variant="flat"
                                class="ml-2">
                                Instalada
                            </v-chip>
                        </div>
                    </template>
                </v-list-item>
            </template>

            <template #selection="{ item }">
                <span :style="{ fontFamily: item.value }" class="text-truncate">
                    {{ item.title }}
                </span>
            </template>
        </v-autocomplete>
    </div>
</template>