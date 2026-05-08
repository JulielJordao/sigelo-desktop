<script setup lang="ts">
import { computed } from 'vue';
import { usePresentationStore } from '../../stores/usePresentationStore';

const presentationStore = usePresentationStore();

const targetLines = computed({
    get: () => presentationStore.design.targetLines,
    set: (val) => presentationStore.design.targetLines = val ? Number(val) : undefined
});

const maxLines = computed({
    get: () => presentationStore.design.maxLines,
    set: (val) => presentationStore.design.maxLines = val ? Number(val) : undefined
});

const coverSlide = computed({
    get: () => presentationStore.design.coverSlide,
    set: (val) => presentationStore.design.coverSlide = val
});

const authorCredits = computed({
    get: () => presentationStore.design.authorCredits,
    set: (val) => presentationStore.design.authorCredits = val
});

// Posicionamento dos créditos
const authorCreditsPosition = computed({
    get: () => presentationStore.design.authorCreditsPosition || 'bottom-right',
    set: (val) => presentationStore.design.authorCreditsPosition = val
});

// Mostrar só na capa
const authorCreditsCoverOnly = computed({
    get: () => presentationStore.design.authorCreditsCoverOnly || false,
    set: (val) => presentationStore.design.authorCreditsCoverOnly = val
});

const positionOptions = [
    { value: 'top-left', label: 'Superior Esquerda', icon: 'mdi-arrow-top-left' },
    { value: 'top-right', label: 'Superior Direita', icon: 'mdi-arrow-top-right' },
    { value: 'bottom-left', label: 'Inferior Esquerda', icon: 'mdi-arrow-bottom-left' },
    { value: 'bottom-right', label: 'Inferior Direita', icon: 'mdi-arrow-bottom-right' },
];

const clearDivisionLimits = () => {
    presentationStore.design.targetLines = undefined;
    presentationStore.design.maxLines = undefined;
};
</script>

<template>
    <div class="d-flex flex-column gap-6">

        <v-card variant="outlined" class="pa-4 rounded-lg">
            <div class="d-flex justify-space-between align-start mb-4">
                <h3 class="text-subtitle-2 font-weight-bold d-flex align-center mb-0">
                    <v-icon size="small" class="mr-2 text-primary">mdi-format-line-spacing</v-icon>
                    Divisão de Slides
                </h3>

                <v-btn variant="tonal" size="x-small" color="error" prepend-icon="mdi-eraser"
                    @click="clearDivisionLimits" :disabled="!targetLines && !maxLines">
                    Remover Limites
                </v-btn>
            </div>

            <v-row>
                <v-col cols="6">
                    <v-text-field v-model="targetLines" label="Linhas por Slide (Ideal)" type="number"
                        variant="outlined" density="comfortable" hide-details clearable min="1"></v-text-field>
                </v-col>
                <v-col cols="6">
                    <v-text-field v-model="maxLines" label="Tolerância Máxima" type="number" variant="outlined"
                        density="comfortable" hide-details clearable :min="targetLines || 1"></v-text-field>
                </v-col>
            </v-row>
            <p class="text-caption text-medium-emphasis mt-2">
                O aplicativo recalculará a música para dividir estrofes longas sem quebrar o ritmo.
                <span class="text-primary font-weight-medium">Deixe vazio para manter a música original.</span>
            </p>
        </v-card>

        <v-card variant="outlined" class="pa-4 rounded-lg">
            <h3 class="text-subtitle-2 font-weight-bold mb-3 d-flex align-center">
                <v-icon size="small" class="mr-2 text-primary">mdi-information-outline</v-icon>
                Informações da Música
            </h3>

            <!-- Switches principais lado a lado -->
            <v-row density="comfortable">
                <v-col cols="12" sm="6">
                    <v-switch v-model="coverSlide" color="primary" label="Slide de Capa (Título)" density="compact"
                        hide-details></v-switch>
                </v-col>
                <v-col cols="12" sm="6">
                    <v-switch v-model="authorCredits" color="primary" label="Créditos do Autor" density="compact"
                        hide-details></v-switch>
                </v-col>
            </v-row>

            <!-- Configurações dos créditos -->
            <v-expand-transition>
                <div v-if="authorCredits" class="credits-config mt-3 pa-3 rounded-lg">
                    <v-row density="comfortable" align="center">

                        <!-- Opção: somente na capa (só aparece se coverSlide estiver ativo) -->
                        <v-col v-if="coverSlide" cols="12" :md="authorCreditsCoverOnly ? 12 : 5">
                            <v-switch v-model="authorCreditsCoverOnly" color="primary" density="compact" hide-details
                                class="ma-0">
                                <template v-slot:label>
                                    <span class="text-body-2">Apenas no slide de Capa</span>
                                    <v-tooltip location="top" max-width="280">
                                        <template v-slot:activator="{ props }">
                                            <v-icon v-bind="props" size="x-small" class="ml-1 text-medium-emphasis">
                                                mdi-help-circle-outline
                                            </v-icon>
                                        </template>
                                        Os créditos serão exibidos abaixo do título, em tamanho reduzido (~30% do texto
                                        principal).
                                    </v-tooltip>
                                </template>
                            </v-switch>
                        </v-col>

                        <!-- Posicionamento (oculto se for somente na capa) -->
                        <v-expand-transition>
                            <v-col v-if="!authorCreditsCoverOnly" cols="12" :md="coverSlide ? 7 : 12">
                                <div class="d-flex align-center flex-wrap ga-2">
                                    <span
                                        class="text-caption text-medium-emphasis font-weight-medium d-flex align-center flex-shrink-0">
                                        <v-icon size="x-small" class="mr-1">mdi-crosshairs-gps</v-icon>
                                        Posição:
                                    </span>
                                    <v-btn-toggle v-model="authorCreditsPosition" color="primary" variant="outlined"
                                        density="comfortable" mandatory divided class="position-toggle flex-grow-1">
                                        <v-btn v-for="opt in positionOptions" :key="opt.value" :value="opt.value"
                                            size="small">
                                            <v-tooltip activator="parent" location="bottom">{{ opt.label }}</v-tooltip>
                                            <v-icon>{{ opt.icon }}</v-icon>
                                        </v-btn>
                                    </v-btn-toggle>
                                </div>
                            </v-col>
                        </v-expand-transition>

                    </v-row>
                </div>
            </v-expand-transition>
        </v-card>

    </div>
</template>

<style scoped>
.credits-config {
    background-color: rgba(var(--v-theme-primary), 0.04);
    border: 1px dashed rgba(var(--v-theme-primary), 0.25);
}

.credits-config {
    background-color: rgba(var(--v-theme-primary), 0.04);
    border: 1px dashed rgba(var(--v-theme-primary), 0.25);
}

.position-toggle {
    min-width: 0;
}

.position-toggle :deep(.v-btn) {
    flex: 1;
    min-width: 0;
}
</style>