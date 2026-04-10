<script setup lang="ts">
import { onMounted } from 'vue';
import { useFontStore } from '../../stores/useFontStore';

const props = defineProps<{
    modelValue: string | null | undefined; 
}>();

const emit = defineEmits(['update:modelValue']);

const fontStore = useFontStore();

onMounted(async () => {
    // 1. Carrega as fontes que você colocou na pasta src/fonts
    if (fontStore.allFonts.length === 0) {
        await fontStore.loadDefaultFonts();
    }
    
    // 2. Carrega as fontes do disco instaladas pelo usuário
    if (fontStore.customFonts.length === 0) {
        await fontStore.loadCustomFonts();
    }
});

const updateValue = (val: string | null) => {
    emit('update:modelValue', val);
};
</script>

<template>
    <div>
        <p class="text-caption font-weight-bold mb-2 d-flex align-center justify-space-between">
            Família da Fonte
            <v-progress-circular v-if="fontStore.isLoading" indeterminate size="16" width="2" color="primary"></v-progress-circular>
        </p>

        <v-autocomplete 
            :model-value="props.modelValue" 
            @update:model-value="updateValue"
            :items="fontStore.allFonts" 
            item-title="title" 
            item-value="value" 
            variant="outlined" 
            density="compact" 
            hide-details
            placeholder="Pesquise uma fonte..."
            no-data-text="Nenhuma fonte encontrada"
        >
            <template #append-inner>
                <v-tooltip text="Importar nova fonte (.ttf / .otf)" location="top">
                    <template #activator="{ props: tooltipProps }">
                        <v-btn 
                            v-bind="tooltipProps" 
                            icon="mdi-plus" 
                            variant="tonal" 
                            color="primary" 
                            size="small" 
                            class="mt-n1"
                            @click="fontStore.addNewFont"
                            :loading="fontStore.isLoading"
                        ></v-btn>
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
                            
                            <v-chip v-if="item.raw?.isCustom" size="x-small" color="success" variant="flat" class="ml-2">
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