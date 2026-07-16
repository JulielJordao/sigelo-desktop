<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useMenuStore } from '../../stores/menuStore';
import { useYoutubeStore } from '../../stores/useYoutubeStore';

const menuStore = useMenuStore()
const youtube = useYoutubeStore()

const props = defineProps({
    modelValue: Boolean
});

const emit = defineEmits(['update:modelValue', 'video-ready']);

const isOpen = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val)
});

// Estado do motor vem do store (persiste mesmo com a modal fechada).
const isEngineReady = computed(() => youtube.engine.isReady);
const isUpdatingEngine = computed(() => youtube.engine.isUpdating);

// Estados do Vídeo
const url = ref('');
const isFetchingInfo = ref(false);
const isDownloading = ref(false);
const videoInfo = ref<{ title: string, thumbnail: string } | null>(null);

const selectedQuality = ref('Highest');
const qualityOptions = [
    { title: 'Melhor Qualidade (1080p+)', value: 'Highest' },
    { title: 'Média Qualidade (720p)', value: 'Medium' },
    { title: 'Baixa Qualidade (Mais rápido)', value: 'Lowest' }
];

// Estados de Navegador para os Cookies
const selectedBrowser = ref('none');
const browserOptions = [
    { title: 'Sem Login (Padrão)', value: 'none' },
    { title: 'Google Chrome', value: 'chrome' },
    { title: 'Microsoft Edge', value: 'edge' },
    { title: 'Mozilla Firefox', value: 'firefox' },
    { title: 'Opera', value: 'opera' },
    { title: 'Brave', value: 'brave' },
];

watch(isOpen, async (newVal) => {
    if (newVal) {
        // Dispara o setup em segundo plano; NÃO bloqueia a modal.
        youtube.ensureEngineReady();
    } else {
        setTimeout(() => {
            url.value = '';
            videoInfo.value = null;
            selectedQuality.value = 'Highest';
            selectedBrowser.value = 'none';
        }, 300);
    }
});

const updateEngine = () => {
    youtube.updateEngine();
};

const fetchVideoInfo = async () => {
    if (!url.value) return;
    isFetchingInfo.value = true;
    try {
        const info = await invoke<any>('get_youtube_info', { url: url.value });
        videoInfo.value = {
            title: info.title,
            thumbnail: info.thumbnail
        };
    } catch (error) {
        alert("Erro 403 ou Link Inválido. Tente clicar em 'Atualizar Motor' e tente novamente.");
        console.error(error);
    } finally {
        isFetchingInfo.value = false;
    }
};

const downloadAndCache = async () => {
    if (!url.value) return;

    isDownloading.value = true;
    isOpen.value = false;

    try {
        const browserToSend =
            selectedBrowser.value === 'none'
                ? null
                : selectedBrowser.value;

        await invoke('cache_youtube_video', {
            url: url.value,
            quality: selectedQuality.value,
            browser: browserToSend
        });
    } catch (error) {
        console.error(error);
    } finally {
        isDownloading.value = false;
    }
};

// Fechar agora é permitido durante o setup do motor: o download dos binários
// continua no backend. Só bloqueia enquanto o vídeo em si está baixando.
const closeModal = () => {
    if (!isDownloading.value) {
        isOpen.value = false;
    }
};

watch(isOpen, () => {
    menuStore.setShiftShortcutLocked(isOpen.value)
})
</script>

<template>
    <v-dialog v-model="isOpen" max-width="500" persistent>
        <v-card rounded="lg">
            <v-card-title class="d-flex align-center border-b bg-surface-light pa-4">
                <v-icon icon="mdi-youtube" color="red" class="mr-2"></v-icon>
                Importar do YouTube
                <v-spacer></v-spacer>
                <v-btn icon="mdi-close" variant="text" size="small" @click="closeModal"
                    :disabled="isDownloading"></v-btn>
            </v-card-title>

            <v-card-text class="pa-5">

                <div v-if="!isEngineReady" class="text-center py-6">
                    <v-progress-circular indeterminate color="red" size="64" width="6"
                        class="mb-4"></v-progress-circular>
                    <h3 class="text-h6 font-weight-bold">Preparando Importador...</h3>
                    <p class="text-body-2 text-medium-emphasis mt-2">
                        O Sigelo está baixando os componentes necessários para processar vídeos do YouTube (Primeira
                        Instalação).
                    </p>

                    <div class="text-caption text-medium-emphasis mb-4">
                        {{ youtube.engine.progress }} de {{ youtube.engine.total }} componentes prontos
                    </div>

                    <v-alert v-if="youtube.engine.error" type="error" variant="tonal" density="compact"
                        class="mb-4 text-caption text-left">
                        {{ youtube.engine.error }}
                        <div class="mt-2">
                            <v-btn size="x-small" variant="flat" color="error" @click="updateEngine">
                                Tentar novamente
                            </v-btn>
                        </div>
                    </v-alert>

                    <v-btn variant="text" color="medium-emphasis" size="small" @click="closeModal">
                        Continuar em segundo plano
                    </v-btn>
                </div>

                <div v-else>
                    <v-alert v-if="!videoInfo && !isDownloading" type="info" variant="tonal" density="compact"
                        class="mb-4 text-caption">
                        <div class="d-flex align-center justify-space-between w-100">
                            <span>O YouTube parou de funcionar (Erro)?</span>
                            <v-btn size="x-small" variant="flat" color="info" :loading="isUpdatingEngine"
                                @click="updateEngine">
                                Atualizar Motor
                            </v-btn>
                        </div>
                    </v-alert>

                    <v-text-field v-model="url" label="Cole o link do vídeo"
                        placeholder="https://www.youtube.com/watch?v=..." variant="outlined" density="comfortable"
                        :disabled="isFetchingInfo || isDownloading" @keyup.enter="fetchVideoInfo"
                        hide-details="auto" class="mb-4">
                        <template v-slot:append-inner>
                            <v-btn color="primary" variant="tonal" size="small" :loading="isFetchingInfo"
                                @click="fetchVideoInfo" :disabled="!url">Buscar</v-btn>
                        </template>
                    </v-text-field>

                    <v-expand-transition>
                        <div v-if="videoInfo" class="mt-2">
                            <v-card variant="outlined"
                                class="d-flex pa-2 align-center mb-4 rounded-lg bg-surface-light">
                                <v-img :src="videoInfo.thumbnail" width="100" max-width="100" class="rounded mr-3" cover
                                    aspect-ratio="16/9"></v-img>
                                <div class="text-subtitle-2 font-weight-medium text-truncate" :title="videoInfo.title">
                                    {{ videoInfo.title }}
                                </div>
                            </v-card>

                            <v-select v-model="selectedQuality" :items="qualityOptions" label="Qualidade do Vídeo"
                                variant="outlined" density="comfortable" hide-details :disabled="isDownloading"
                                prepend-inner-icon="mdi-quality-high" class="mb-4"></v-select>

                            <v-select v-model="selectedBrowser" :items="browserOptions"
                                label="Usar login do navegador (Para vídeos restritos)" variant="outlined"
                                density="comfortable" hide-details :disabled="isDownloading"
                                prepend-inner-icon="mdi-cookie"></v-select>

                            <v-expand-transition>
                                <v-alert v-if="selectedBrowser !== 'none'" type="warning" variant="tonal"
                                    density="compact" class="mt-3 text-caption" icon="mdi-alert">
                                    <strong>Atenção:</strong> Você deve <b>fechar o {{browserOptions.find(b => b.value
                                        ===
                                        selectedBrowser)?.title }}</b> completamente antes de clicar em Baixar, ou o
                                    download irá falhar.
                                </v-alert>
                            </v-expand-transition>
                        </div>
                    </v-expand-transition>

                    <div v-if="isDownloading" class="mt-6 text-center">
                        <v-progress-linear indeterminate color="red" rounded height="6"></v-progress-linear>
                        <div class="text-caption text-medium-emphasis mt-2 font-weight-bold">
                            Baixando e processando vídeo... Isso pode levar alguns minutos.
                        </div>
                    </div>
                </div>

            </v-card-text>

            <v-card-actions class="pa-4 border-t bg-surface-light" v-if="isEngineReady && videoInfo && !isDownloading">
                <v-spacer></v-spacer>
                <v-btn color="medium-emphasis" variant="text" @click="closeModal">Cancelar</v-btn>
                <v-btn color="red-darken-1" variant="flat" prepend-icon="mdi-download" @click="downloadAndCache">
                    Baixar e Salvar
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>