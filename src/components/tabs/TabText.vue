<script setup lang="ts">
import { ref } from 'vue';
import { usePresentationStore } from '../../stores/usePresentationStore';

defineProps<{ maxAllowedFontSize: number }>();

const store = usePresentationStore();
const activeTextSetting = ref<'geral' | 'titulo' | 'verso' | 'refrao'>('geral');
const fontOptions = [
  { title: 'Arial', value: 'Arial' },
  { title: 'Verdana', value: 'Verdana' },
  { title: 'Roboto', value: 'Roboto' },
  { title: 'Times New Roman', value: 'Times New Roman' },
  { title: 'Inter', value: 'Inter' }
];
</script>

<template>
    <div class="d-flex justify-center pb-4">
        <v-card max-width="750" width="100%" variant="outlined" class="rounded-lg bg-surface">
            <v-tabs v-model="activeTextSetting" color="primary" density="compact" show-arrows class="border-b bg-surface-light">
                <v-tab value="geral">Geral</v-tab>
                <v-tab value="refrao">Refrão</v-tab>
                <v-tab value="verso">Verso</v-tab>
                <v-tab value="titulo">Título</v-tab>
            </v-tabs>

            <v-card-text class="pa-4 pa-sm-6">
                <v-btn v-if="activeTextSetting === 'geral'" prepend-icon="mdi-content-copy" variant="tonal" color="primary" class="mb-6 w-100" size="small" @click="store.applyGeralToAll()">
                    Aplicar este estilo a todos os slides
                </v-btn>

                <v-row>
                    <v-col cols="12" md="6">
                        <p class="text-caption font-weight-bold mb-2">Cor do Texto</p>
                        <div class="d-flex align-center gap-4 mb-6">
                            <v-btn icon size="small" class="border color-btn" :class="{ 'selected-color': store.textStyles[activeTextSetting].color === '#FFFFFF' }" color="#FFFFFF" @click="store.textStyles[activeTextSetting].color = '#FFFFFF'">
                                <v-icon v-if="store.textStyles[activeTextSetting].color === '#FFFFFF'" color="black" size="18">mdi-check</v-icon>
                            </v-btn>
                            </div>

                        <p class="text-caption font-weight-bold mb-2">Alinhamento</p>
                        <v-btn-toggle v-model="store.textStyles[activeTextSetting].align" color="primary" variant="outlined" divided density="compact" mandatory class="mb-4 mb-md-0">
                            <v-btn value="left" icon="mdi-format-align-left"></v-btn>
                            <v-btn value="center" icon="mdi-format-align-center"></v-btn>
                            <v-btn value="right" icon="mdi-format-align-right"></v-btn>
                        </v-btn-toggle>
                    </v-col>

                    <v-col cols="12" md="6">
                        <p class="text-caption font-weight-bold mb-2">Família da Fonte</p>
                        <v-select 
                            v-model="store.textStyles[activeTextSetting].fontFamily" 
                            :items="fontOptions" 
                            item-title="title"
                            item-value="value"
                            variant="outlined" 
                            density="compact" 
                            class="mb-6" 
                            hide-details
                        >
                            <template #item="{ props, item }">
                                <v-list-item v-bind="props">
                                    <template #title>
                                        <span :style="{ fontFamily: item.value }">
                                            {{ item.title }}
                                        </span>
                                    </template>
                                </v-list-item>
                            </template>

                            <template #selection="{ item }">
                                <span :style="{ fontFamily: item.value }">
                                    {{ item.title }}
                                </span>
                            </template>
                        </v-select>

                        <p class="text-caption font-weight-bold mb-2">Estilo</p>
                        <div class="d-flex gap-2 mb-4 mb-md-0">
                            <v-btn :variant="store.textStyles[activeTextSetting].bold ? 'flat' : 'outlined'" :color="store.textStyles[activeTextSetting].bold ? 'primary' : 'surface-variant'" icon="mdi-format-bold" density="compact" @click="store.textStyles[activeTextSetting].bold = !store.textStyles[activeTextSetting].bold"></v-btn>
                            <v-btn :variant="store.textStyles[activeTextSetting].italic ? 'flat' : 'outlined'" :color="store.textStyles[activeTextSetting].italic ? 'primary' : 'surface-variant'" icon="mdi-format-italic" density="compact" @click="store.textStyles[activeTextSetting].italic = !store.textStyles[activeTextSetting].italic"></v-btn>
                        </div>
                    </v-col>
                </v-row>

                <v-divider class="my-6"></v-divider>

                <p class="text-caption font-weight-bold mb-0">Tamanho da Fonte</p>
                <v-slider v-model="store.textStyles[activeTextSetting].fontSize" min="2" :max="maxAllowedFontSize" step="0.1" thumb-label color="primary" append-icon="mdi-format-size" hide-details></v-slider>
            </v-card-text>
        </v-card>
    </div>
</template>

<style scoped>
.color-btn { transition: all 0.2s ease; }
.color-btn.selected-color { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 3px; transform: scale(1.1); }
.gap-4 { gap: 16px; }
.gap-2 { gap: 8px; }
</style>