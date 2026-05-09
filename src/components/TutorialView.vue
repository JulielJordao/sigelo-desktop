<template>
    <div class="tutorial-wrapper">
        <v-icon v-if="!props.noIcon" color="primary" size="x-large" class="mb-2">mdi-help-circle-outline</v-icon>
        <h2 class="text-h5 font-weight-bold mb-4">Como funciona o Sigelo</h2>

        <v-carousel hide-delimiter-background show-arrows="hover" :height="carouselHeight" cycle interval="8000"
            color="primary" class="rounded-xl elevation-0 border">
            <v-carousel-item v-for="(item, index) in tutorial" :key="index">
                <v-sheet height="100%" class="d-flex flex-column pa-4 pa-md-6 bg-surface-variant">
                    <div class="image-container flex-grow-1 d-flex align-center justify-center w-100 mb-6"
                        style="min-height: 0;">
                        <v-img :src="item.img" class="rounded-lg elevation-4 border" contain max-height="100%"
                            max-width="100%" alt="Instrução Sigelo">
                            <template v-slot:placeholder>
                                <div class="d-flex align-center justify-center fill-height">
                                    <v-progress-circular indeterminate color="primary"></v-progress-circular>
                                </div>
                            </template>
                        </v-img>
                    </div>
                    <div class="text-container flex-shrink-0 text-center px-4 py-3 bg-surface rounded-lg elevation-2 border mx-auto"
                        style="max-width: 90%;">
                        <p class="text-h6 font-weight-bold text-high-emphasis mb-3" style="line-height: 1.4;">
                            {{ item.text }}
                        </p>
                    </div>
                </v-sheet>
            </v-carousel-item>
        </v-carousel>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useDisplay } from 'vuetify';

const { smAndDown } = useDisplay();

const props = defineProps<{
    noIcon: boolean
}>();

// Altura do carrossel
const carouselHeight = computed(() => (smAndDown.value ? 450 : 550));

const tutorial = [
    {
        img: '/clip_painel_superior.gif',
        text: 'Controle animado do andamento da projeção de mídias, cronômetros, alertas, retorno de palco e transmissão.'
    },
    {
        img: '/configuracoes.gif',
        text: 'Acesso às configurações de controle da tela de projeção, resolução, motor de reprodução de vídeo, bíblia, atalhos e muito mais...'
    },
    {
        img: '/Editar.gif',
        text: 'Edite nomes de arquivos e temas de forma rápida com um duplo clique no texto.'
    },
    {
        img: '/atalhos rapido.gif',
        text: 'Use atalhos para alternar rapidamente entre músicas e textos bíblicos.'
    }
];
</script>

<style scoped>
.tutorial-wrapper {
    width: 100%;
}

.image-container {
    /* Evita qualquer transbordo do GIF forçando o corte caso o layout seja esmagado */
    overflow: hidden;
}

.border {
    border: 1px solid rgba(var(--v-border-color), 0.12) !important;
}

/* Um leve ajuste nas margens das bolinhas de paginação do carrossel para não sobrepor a nova caixa de texto */
:deep(.v-carousel__controls) {
    padding-bottom: 4px;
}
</style>