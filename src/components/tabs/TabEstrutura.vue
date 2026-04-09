<script setup lang="ts">
import { computed } from 'vue';
import { usePresentationStore } from '../../stores/usePresentationStore'; // Ajuste o caminho

const presentationStore = usePresentationStore();

// Computeds com Get/Set garantem que o v-model atualize a Store diretamente e reativamente
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

// Função para o botão "Remover Limites"
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
                
                <v-btn 
                    variant="tonal" 
                    size="x-small" 
                    color="error" 
                    prepend-icon="mdi-eraser"
                    @click="clearDivisionLimits"
                    :disabled="!targetLines && !maxLines"
                >
                    Remover Limites
                </v-btn>
            </div>
            
            <v-row>
                <v-col cols="6">
                    <v-text-field 
                        v-model="targetLines"
                        label="Linhas por Slide (Ideal)" 
                        type="number" 
                        variant="outlined" 
                        density="comfortable" 
                        hide-details
                        clearable
                        min="1"
                    ></v-text-field>
                </v-col>
                <v-col cols="6">
                    <v-text-field 
                        v-model="maxLines"
                        label="Tolerância Máxima" 
                        type="number" 
                        variant="outlined" 
                        density="comfortable" 
                        hide-details
                        clearable
                        :min="targetLines || 1"
                    ></v-text-field>
                </v-col>
            </v-row>
            <p class="text-caption text-medium-emphasis mt-2">
                O aplicativo recalculará a música para dividir estrofes longas sem quebrar o ritmo. 
                <span class="text-primary font-weight-medium">Deixe vazio para manter a música original.</span>
            </p>
        </v-card>

        <v-card variant="outlined" class="pa-4 rounded-lg">
            <h3 class="text-subtitle-2 font-weight-bold mb-4 d-flex align-center">
                <v-icon size="small" class="mr-2 text-primary">mdi-information-outline</v-icon>
                Informações da Música
            </h3>
            
            <v-switch 
                v-model="coverSlide"
                color="primary" 
                label="Criar slide de Capa (Título)" 
                density="compact" 
                hide-details
            ></v-switch>
            
            <v-switch 
                v-model="authorCredits"
                color="primary" 
                label="Mostrar Créditos do Autor" 
                density="compact" 
                hide-details
            ></v-switch>
        </v-card>

    </div>
</template>