<script setup lang="ts">
import { usePresentationStore } from '../../stores/usePresentationStore';
const store = usePresentationStore();
</script>

<template>
    <div class="d-flex flex-column w-100 pa-4">
        
        <div class="d-flex mb-2">
            <v-checkbox 
                v-model="store.autoFontSize" 
                label="Ajustar fonte automaticamente ao redimensionar" 
                color="primary" 
                density="compact" 
                hide-details 
            ></v-checkbox>
        </div>

        <v-card variant="outlined" class="w-100 pa-4 rounded-lg bg-surface">
            <v-row align="center">
                
                <v-col cols="12" md="5" lg="4" class="d-flex align-center text-center text-md-left">
                    <v-icon icon="mdi-gesture-tap" size="36" color="primary" class="mr-4 d-none d-sm-flex"></v-icon>
                    <div>
                        <h3 class="text-h6 font-weight-bold mb-1">Ajuste Livre</h3>
                        <p class="text-body-2 text-medium-emphasis mb-0">
                            Arraste a caixa pontilhada no telão acima para posicionar.
                        </p>
                    </div>
                </v-col>

                <v-col cols="12" md="7" lg="8">
                    <v-row density="comfortable">
                        <v-col cols="6" sm="3">
                            <v-text-field 
                                v-model="store.design.posX" 
                                label="Eixo X" 
                                type="number" 
                                variant="outlined" 
                                density="compact" 
                                suffix="%" 
                                hide-details
                            ></v-text-field>
                        </v-col>
                        <v-col cols="6" sm="3">
                            <v-text-field 
                                v-model="store.design.posY" 
                                label="Eixo Y" 
                                type="number" 
                                variant="outlined" 
                                density="compact" 
                                suffix="%" 
                                hide-details
                            ></v-text-field>
                        </v-col>
                        <v-col cols="6" sm="3">
                            <v-text-field 
                                v-model="store.design.width" 
                                label="Largura" 
                                type="number" 
                                variant="outlined" 
                                density="compact" 
                                suffix="%" 
                                hide-details
                            ></v-text-field>
                        </v-col>
                        <v-col cols="6" sm="3">
                            <v-text-field 
                                v-model="store.design.height" 
                                label="Altura" 
                                type="number" 
                                variant="outlined" 
                                density="compact" 
                                suffix="%" 
                                hide-details
                            ></v-text-field>
                        </v-col>
                    </v-row>
                </v-col>
                
            </v-row>
        </v-card>
        
    </div>
</template>