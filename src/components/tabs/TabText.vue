<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { usePresentationStore } from '../../stores/usePresentationStore';
import FontSelector from '../utils/FontSelector.vue';
import { useMusicPresentationStore } from '../../stores/presentationStore';

const songInfo = useMusicPresentationStore();

defineProps<{ maxAllowedFontSize: number }>();

const store = usePresentationStore();
const activeTextSetting = ref<'geral' | 'titulo' | 'verso' | 'refrao'>('geral');

watch(() => songInfo.getCurrentSlideType, (newValue) => {
    if (newValue) {
        activeTextSetting.value = newValue;
    }
});

onMounted(() => {
    // Sincroniza a aba ativa com o tipo do slide atual ao montar o componente
    const currentType = songInfo.getCurrentSlideType;
    if (currentType) {
        activeTextSetting.value = currentType;
    }
});
</script>

<template>
    <div class="d-flex justify-center pb-4">
        <v-card max-width="750" width="100%" variant="outlined" class="rounded-lg bg-surface">
            <v-tabs v-model="activeTextSetting" color="primary" density="compact" show-arrows
                class="border-b bg-surface-light">
                <v-tab value="geral">Geral</v-tab>
                <v-tab value="refrao">Refrão</v-tab>
                <v-tab value="verso">Verso</v-tab>
                <v-tab value="titulo">Título</v-tab>
            </v-tabs>

            <v-card-text class="pa-4 pa-sm-6">
                <v-btn v-if="activeTextSetting === 'geral'" prepend-icon="mdi-content-copy" variant="tonal"
                    color="primary" class="mb-6 w-100" size="small" @click="store.applyGeralToAll()">
                    Aplicar este estilo a todos os slides
                </v-btn>

                <v-row>
                    <v-col cols="12" md="6">
                        <p class="text-caption font-weight-bold mb-2">Cor do Texto</p>
                        <div class="d-flex align-center gap-3 mb-6">

                            <v-btn icon size="small" class="border color-btn"
                                :class="{ 'selected-color': store.textStyles[activeTextSetting].color === '#FFFFFF' }"
                                color="#FFFFFF" @click="store.textStyles[activeTextSetting].color = '#FFFFFF'">
                                <v-icon v-if="store.textStyles[activeTextSetting].color === '#FFFFFF'" color="black"
                                    size="18">mdi-check</v-icon>
                            </v-btn>

                            <v-btn icon size="small" class="border color-btn"
                                :class="{ 'selected-color': store.textStyles[activeTextSetting].color === '#000000' }"
                                color="#000000" @click="store.textStyles[activeTextSetting].color = '#000000'">
                                <v-icon v-if="store.textStyles[activeTextSetting].color === '#000000'" color="white"
                                    size="18">mdi-check</v-icon>
                            </v-btn>

                            <v-divider vertical class="mx-1 my-2" length="24"></v-divider>

                            <div class="d-flex align-center gap-2">
                                <input type="color" v-model="store.textStyles[activeTextSetting].color"
                                    title="Escolher cor personalizada"
                                    style="width: 36px; height: 36px; border: 1px solid #e0e0e0; border-radius: 8px; cursor: pointer; padding: 2px; background-color: white;">
                                <span class="text-caption font-weight-medium text-uppercase text-medium-emphasis">
                                    {{ store.textStyles[activeTextSetting].color }}
                                </span>
                            </div>

                        </div>

                        <p class="text-caption font-weight-bold mb-2">Alinhamento</p>
                        <v-btn-toggle v-model="store.textStyles[activeTextSetting].align" color="primary"
                            variant="outlined" divided density="compact" mandatory class="mb-4 mb-md-0">
                            <v-btn value="left" icon="mdi-format-align-left"></v-btn>
                            <v-btn value="center" icon="mdi-format-align-center"></v-btn>
                            <v-btn value="right" icon="mdi-format-align-right"></v-btn>
                        </v-btn-toggle>
                    </v-col>

                    <v-col cols="12" md="6">
                        <FontSelector v-model="store.textStyles[activeTextSetting].fontFamily" class="mb-6" />


                        <p class="text-caption font-weight-bold mb-2">Estilo</p>
                        <div class="d-flex gap-2 mb-4 mb-md-0">
                            <v-btn :variant="store.textStyles[activeTextSetting].bold ? 'flat' : 'outlined'"
                                :color="store.textStyles[activeTextSetting].bold ? 'primary' : 'surface-variant'"
                                icon="mdi-format-bold" density="compact"
                                @click="store.textStyles[activeTextSetting].bold = !store.textStyles[activeTextSetting].bold"></v-btn>
                            <v-btn :variant="store.textStyles[activeTextSetting].italic ? 'flat' : 'outlined'"
                                :color="store.textStyles[activeTextSetting].italic ? 'primary' : 'surface-variant'"
                                icon="mdi-format-italic" density="compact"
                                @click="store.textStyles[activeTextSetting].italic = !store.textStyles[activeTextSetting].italic"></v-btn>
                        </div>
                    </v-col>
                </v-row>

                <v-divider class="my-6"></v-divider>

                <p class="text-caption font-weight-bold mb-0">Tamanho da Fonte</p>
                <v-slider v-model="store.textStyles[activeTextSetting].fontSize" min="2" :max="maxAllowedFontSize"
                    step="0.1" thumb-label color="primary" append-icon="mdi-format-size" hide-details></v-slider>
            </v-card-text>
        </v-card>
    </div>
</template>

<style scoped>
.color-btn {
    transition: all 0.2s ease;
}

.color-btn.selected-color {
    outline: 2px solid rgb(var(--v-theme-primary));
    outline-offset: 3px;
    transform: scale(1.1);
}

.gap-4 {
    gap: 16px;
}

.gap-2 {
    gap: 8px;
}
</style>