<script setup lang="ts">
import { usePresentationStore } from '../../stores/usePresentationStore';
const store = usePresentationStore();
</script>

<template>
    <div class="d-flex flex-column align-center justify-center w-100 pa-4">
        
        <v-checkbox 
            v-model="store.autoFontSize" 
            label="Ajustar fonte automaticamente ao redimensionar" 
            color="primary" 
            density="compact" 
            hide-details 
            class="mb-4"
        ></v-checkbox>

        <v-card max-width="450" variant="outlined" class="w-100 pa-6 rounded-lg text-center bg-surface">
            <v-icon icon="mdi-gesture-tap" size="40" color="primary" class="mb-2"></v-icon>
            <h3 class="text-h6 font-weight-bold mb-1">Ajuste Livre</h3>
            <p class="text-body-2 text-medium-emphasis mb-6">Arraste a caixa pontilhada no telão acima para posicionar o texto onde desejar.</p>

            <v-row density="comfortable">
                <v-col cols="12" sm="6">
                    <v-text-field v-model="store.design.posX" label="Eixo X (%)" type="number" variant="outlined" density="compact" suffix="%"></v-text-field>
                </v-col>
                <v-col cols="12" sm="6">
                    <v-text-field v-model="store.design.posY" label="Eixo Y (%)" type="number" variant="outlined" density="compact" suffix="%"></v-text-field>
                </v-col>
            </v-row>
            
            <v-row density="comfortable">
                <v-col cols="12" sm="6">
                    <v-text-field v-model="store.design.width" label="Largura (%)" type="number" variant="outlined" density="compact" suffix="%"></v-text-field>
                </v-col>
                <v-col cols="12" sm="6">
                    <v-text-field v-model="store.design.height" label="Altura (%)" type="number" variant="outlined" density="compact" suffix="%"></v-text-field>
                </v-col>
            </v-row>
        </v-card>
    </div>
</template>