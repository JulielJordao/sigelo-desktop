<script setup lang="ts">
import { ref, onMounted, computed, watch, onUpdated, onUnmounted } from 'vue';
import { usePresentationStore } from '../../stores/usePresentationStore';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { useMenuStore } from "../../stores/menuStore";
import SmartVideo from '../SmartVideo.vue';
import { useConfigStore } from '../../stores/useConfigStore';

const menuStore = useMenuStore()
const store = usePresentationStore();
const mediaStore = useMediaStore();
const configStore = useConfigStore();
const scrollContainer = ref<HTMLDivElement | null>(null)
let resizeObserver: ResizeObserver | null = null;

const fileInput = ref<HTMLInputElement | null>(null);

const isReloadEngine = ref(true);


// --- SELEÇÃO DE MÍDIA ---
const selectLocalMedia = (file: MediaFile) => {
    store.design.bgType = 'saved';
    store.design.bgMedia = file.url;
    store.design.bgIsVideo = file.isVideo;
};

const handleFileUpload = (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
        store.design.bgType = 'upload';
        store.design.bgMedia = URL.createObjectURL(file);
        store.design.bgIsVideo = file.type.startsWith('video/');
    }
};

// --- SELEÇÃO DE COR ---
const selectColor = (hex: string) => {
    store.design.bgType = 'color';
    store.design.bgMedia = '';
    store.design.bgColor = hex;
};

// Computed para saber se uma cor customizada (diferente de preto e branco) está selecionada
const isCustomColor = computed(() => {
    return store.design.bgType === 'color' &&
        store.design.bgColor !== '#000000' &&
        store.design.bgColor !== '#FFFFFF';
});
// --- CONTROLE DE FILTRO E PESQUISA ---
const selectedTag = ref<string | null>(null);
const isSearchOpen = ref(false);
const tagSearchQuery = ref('');

// Lista de Tags Processada (Filtrada pela pesquisa e Ordenada)
const displayTags = computed(() => {
    let tags = mediaStore.allTags || [];

    // 1. Filtra as tags se o usuário estiver digitando na pesquisa
    if (tagSearchQuery.value) {
        const q = tagSearchQuery.value.toLowerCase();
        tags = tags.filter(tag => tag.toLowerCase().includes(q));
    }

    // 2. Ordena garantindo que a TAG ATIVA seja SEMPRE a primeira do array (índice 0)
    return [...tags].sort((a, b) => {
        if (a === selectedTag.value) return -1;
        if (b === selectedTag.value) return 1;
        return a.localeCompare(b); // Ordena o resto em ordem alfabética
    });
});

// Ação de Selecionar / Deselecionar Tag
const toggleSelectTag = (tag: string) => {
    if (selectedTag.value === tag) {
        selectedTag.value = null; // Clicou na mesma tag? Remove o filtro.
    } else {
        selectedTag.value = tag;
        // Ao selecionar, fecha a barra de pesquisa automaticamente
        isSearchOpen.value = false;
        tagSearchQuery.value = '';
    }
};

// Captura o Tab e o Enter na Pesquisa
const handleSearchKeydown = (e: KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === 'Tab') && displayTags.value.length === 1) {
        e.preventDefault(); // Impede o Tab de pular para outro botão da tela
        toggleSelectTag(displayTags.value[0]);
    } else if (e.key === 'Escape') {
        isSearchOpen.value = false;
        tagSearchQuery.value = '';
    }
};

// Lista de Mídias (Filtrada e com o item Selecionado sempre fixado no topo)
const displayThemeFiles = computed(() => {
    // Verifica qual é a URL da mídia atualmente selecionada no tema
    const selectedMediaUrl = store.design.bgType === 'saved' ? store.design.bgMedia : null;

    // 1. Isola o arquivo selecionado (se existir)
    const selectedFile = mediaStore.themeFiles.find(f => f.url === selectedMediaUrl);

    // 2. Separa os outros arquivos para aplicar o filtro
    let otherFiles = mediaStore.themeFiles.filter(f => f.url !== selectedMediaUrl);

    // 3. Aplica o filtro de tags apenas nos outros arquivos
    if (selectedTag.value) {
        otherFiles = otherFiles.filter(file => {
            const fileTags = mediaStore.tagsByFiles[file.id];
            // Como você corrigiu para Array de Strings, usamos o .includes direto!
            return fileTags && fileTags.includes(selectedTag.value!);
        });
    }

    // 4. Junta tudo: O selecionado SEMPRE em primeiro, seguido do resto filtrado
    return selectedFile ? [selectedFile, ...otherFiles] : otherFiles;
});

const canScrollLeft = ref(false)
const canScrollRight = ref(false)

const checkScroll = () => {
    if (!scrollContainer.value) return
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainer.value

    // Mostra seta esquerda se rolou mais de 1px
    canScrollLeft.value = scrollLeft > 1
    // Mostra seta direita se ainda há espaço para rolar
    canScrollRight.value = Math.ceil(scrollLeft + clientWidth) < scrollWidth - 1
}

const scroll = (amount: number) => {
    if (scrollContainer.value) {
        scrollContainer.value.scrollLeft += amount
        setTimeout(checkScroll, 300) // Verifica após a animação suave
    }
}

onMounted(() => {
    if (mediaStore.themeFiles?.length === 0) {
        mediaStore.loadMedia();
    }

    checkScroll(); // Checa na primeira montagem

    if (scrollContainer.value) {
        resizeObserver = new ResizeObserver(() => {
            // Envolvemos a checagem no requestAnimationFrame
            window.requestAnimationFrame(() => {
                checkScroll();
            });
        });
        resizeObserver.observe(scrollContainer.value);
    }
});

onUnmounted(() => {
    // É importante limpar o observador quando sair da tela para não pesar a memória
    if (resizeObserver) {
        resizeObserver.disconnect();
    }
});

onUpdated(checkScroll)

watch(() => [displayTags.value, isSearchOpen.value, selectedTag.value], () => {
    setTimeout(checkScroll, 100) // Pequeno delay para o DOM renderizar
}, { deep: true })

watch(isSearchOpen, () => {
    menuStore.setShiftShortcutLocked(isSearchOpen.value)
})

watch(() => configStore.settings.videoEngine, (engine) => {
    console.log("engine", engine)
    isReloadEngine.value = false

    setTimeout(() => {
        isReloadEngine.value = true
    })
})
</script>

<template>
    <v-row class="fill-height">
        <v-col cols="12" md="4" class="border-e">
            <p class="text-caption font-weight-bold mb-2">Cores Sólidas</p>
            <div class="d-flex gap-2 mb-6">
                <v-tooltip text="Fundo Preto" location="bottom">
                    <template v-slot:activator="{ props }">
                        <v-card v-bind="props" width="60" height="60" color="#000000"
                            class="cursor-pointer transition-all"
                            :class="[store.design.bgType === 'color' && store.design.bgColor === '#000000' ? 'selected-item' : 'border']"
                            @click="selectColor('#000000')">
                            <div class="w-100 h-100 d-flex align-center justify-center">
                                <v-icon v-if="store.design.bgType === 'color' && store.design.bgColor === '#000000'"
                                    color="white" size="small">mdi-check</v-icon>
                            </div>
                        </v-card>
                    </template>
                </v-tooltip>

                <v-tooltip text="Fundo Branco" location="bottom">
                    <template v-slot:activator="{ props }">
                        <v-card v-bind="props" width="60" height="60" color="#FFFFFF"
                            class="cursor-pointer transition-all"
                            :class="[store.design.bgType === 'color' && store.design.bgColor === '#FFFFFF' ? 'selected-item' : 'border']"
                            @click="selectColor('#FFFFFF')">
                            <div class="w-100 h-100 d-flex align-center justify-center">
                                <v-icon v-if="store.design.bgType === 'color' && store.design.bgColor === '#FFFFFF'"
                                    color="black" size="small">mdi-check</v-icon>
                            </div>
                        </v-card>
                    </template>
                </v-tooltip>

                <v-tooltip text="Cor Personalizada" location="bottom">
                    <template v-slot:activator="{ props }">
                        <v-card v-bind="props" width="60" height="60"
                            :color="isCustomColor ? store.design.bgColor : 'surface-variant'"
                            class="cursor-pointer position-relative d-flex align-center justify-center transition-all"
                            :class="[isCustomColor ? 'selected-item' : 'border']">
                            <v-icon :color="isCustomColor ? 'white' : 'primary'">mdi-palette</v-icon>

                            <input type="color" v-model="store.design.bgColor"
                                @input="store.design.bgType = 'color'; store.design.bgMedia = ''"
                                class="position-absolute top-0 left-0 w-100 h-100 cursor-pointer" style="opacity: 0;">
                        </v-card>
                    </template>
                </v-tooltip>
            </div>

            <v-divider class="mb-4"></v-divider>

            <p class="text-caption font-weight-bold mb-2">Preenchimento da Mídia</p>
            <v-radio-group v-model="store.design.bgFit" hide-details density="compact" class="mb-4">
                <v-radio label="Cortar (Cover - Sem bordas)" value="cover" color="primary"></v-radio>
                <v-radio label="Estender (Fill - Distorce)" value="fill" color="primary"></v-radio>
            </v-radio-group>
        </v-col>

        <v-col cols="12" md="8" class="d-flex flex-column h-100">

            <div class="d-flex align-center mb-3 w-100 overflow-hidden bg-surface-light rounded-lg pa-1 border"
                style="min-height: 48px;">

                <div class="d-flex align-center flex-shrink-0 px-2 text-caption font-weight-bold text-medium-emphasis">
                    <v-icon size="small" class="mr-1">mdi-image-multiple</v-icon>
                    Galeria
                </div>

                <div class="d-flex align-center mx-1" style="height: 100%;">
                    <v-divider vertical style="opacity: 0.4; border-width: 1.5px; height: 24px;"></v-divider>
                </div>

                <v-expand-x-transition>
                    <div class="d-flex align-center flex-shrink-0 px-1">
                        <v-text-field v-if="isSearchOpen" v-model="tagSearchQuery" autofocus density="compact"
                            variant="solo" flat hide-details placeholder="Pesquisar..." prepend-inner-icon="mdi-magnify"
                            @keydown="handleSearchKeydown" @blur="!tagSearchQuery && (isSearchOpen = false);"
                            class="search-pill border align-center" rounded="pill" bg-color="surface"
                            style="width: 180px;">
                            <template v-slot:append-inner v-if="displayTags.length === 1 && tagSearchQuery">
                                <v-fade-transition>
                                    <v-chip size="x-small" color="primary" variant="tonal" class="ml-1 font-weight-bold"
                                        style="height: 20px;">Enter</v-chip>
                                </v-fade-transition>
                            </template>
                        </v-text-field>

                        <v-btn v-else icon="mdi-magnify" variant="text" size="small" color="medium-emphasis"
                            @click="isSearchOpen = true"></v-btn>
                    </div>
                </v-expand-x-transition>

                <div class="d-flex align-center mx-1" style="height: 100%;">
                    <v-divider vertical style="opacity: 0.4; border-width: 1.5px; height: 24px;"></v-divider>
                </div>

                <v-expand-x-transition>
                    <div v-if="selectedTag" class="d-flex align-center flex-shrink-0 pr-1">
                        <v-chip color="primary" variant="flat" elevation="1" class="font-weight-medium mx-1"
                            size="small" @click="selectedTag = null">
                            <v-icon start size="x-small">mdi-check-circle</v-icon>
                            {{ selectedTag }}
                        </v-chip>

                        <div class="d-flex align-center ml-1" style="height: 100%;">
                            <v-divider vertical style="opacity: 0.4; border-width: 1.5px; height: 24px;"></v-divider>
                        </div>
                    </div>
                </v-expand-x-transition>

                <div class="d-flex align-center flex-grow-1 overflow-hidden" style="min-width: 0;">

                    <v-btn v-show="canScrollLeft" icon="mdi-chevron-left" variant="text" size="small"
                        class="flex-shrink-0" @click="scroll(-200)"></v-btn>

                    <div ref="scrollContainer"
                        class="d-flex align-center overflow-x-auto hide-scrollbar flex-grow-1 px-1"
                        style="scroll-behavior: smooth; min-height: 32px;" @scroll="checkScroll">

                        <div v-if="displayTags.length === 0" class="text-caption text-medium-emphasis mx-2 font-italic">
                            Nenhuma tag encontrada
                        </div>

                        <template v-for="tag in displayTags" :key="tag">
                            <v-chip v-if="selectedTag !== tag" color="surface" variant="elevated" elevation="1"
                                class="cursor-pointer font-weight-medium flex-shrink-0 transition-all mx-1" size="small"
                                @click="toggleSelectTag(tag)">
                                {{ tag }}
                            </v-chip>
                        </template>
                    </div>

                    <v-btn v-show="canScrollRight" icon="mdi-chevron-right" variant="text" size="small"
                        class="flex-shrink-0" @click="scroll(200)"></v-btn>

                </div>

                <v-scale-transition>
                    <v-btn v-if="selectedTag" icon="mdi-close" variant="text" size="x-small" color="error"
                        class="flex-shrink-0 ml-1 mr-1" title="Limpar Filtro" @click="selectedTag = null"></v-btn>
                </v-scale-transition>

            </div>


            <div class="d-flex flex-wrap gap-2 overflow-y-auto pb-2" style="max-height: 100%;">

                <v-tooltip text="Usar imagem ou vídeo externo" location="top">
                    <template v-slot:activator="{ props }">
                        <v-card v-bind="props" width="100" height="70" color="surface-light"
                            class="d-flex flex-column align-center justify-center cursor-pointer transition-all border-dashed"
                            :class="[store.design.bgType === 'upload' ? 'selected-item' : '']"
                            @click="fileInput?.click()">
                            <v-icon color="medium-emphasis">mdi-upload</v-icon>
                            <input type="file" ref="fileInput" class="d-none" accept="image/*,video/*"
                                @change="handleFileUpload">
                        </v-card>
                    </template>
                </v-tooltip>

                <v-card v-if="mediaStore.isLoading" width="100" height="70"
                    class="d-flex align-center justify-center bg-surface-variant border">
                    <v-progress-circular indeterminate size="24" color="primary"></v-progress-circular>
                </v-card>

                <v-card v-for="file in displayThemeFiles" :key="file.id" width="100" height="70"
                    class="cursor-pointer position-relative overflow-hidden transition-all"
                    :class="[store.design.bgType === 'saved' && store.design.bgMedia === file.url ? 'selected-item' : 'border']"
                    @click="selectLocalMedia(file)" v-if="isReloadEngine">
                   <smart-video v-if="file.isVideo" crossorigin="anonymous" playsinline :src="file.url"
                        class="w-100 h-100 object-cover" preload="metadata" no-audio preview-only></smart-video>
                    <v-img v-else :src="file.url" cover height="100%"></v-img>

                    <div v-if="file.isVideo"
                        class="position-absolute top-0 left-0 w-100 h-100 d-flex align-center justify-center"
                        style="background: rgba(0,0,0,0.3);">
                        <v-icon color="white" size="small">mdi-video</v-icon>
                    </div>

                    <div v-if="store.design.bgType === 'saved' && store.design.bgMedia === file.url"
                        class="position-absolute top-0 right-0 ma-1 bg-primary rounded-circle d-flex align-center justify-center"
                        style="width: 18px; height: 18px; z-index: 10;">
                        <v-icon color="white" size="10">mdi-check</v-icon>
                    </div>
                </v-card>

                <div v-if="displayThemeFiles.length === 0 && !mediaStore.isLoading"
                    class="w-100 d-flex flex-column align-center justify-center py-4 opacity-60">
                    <v-icon size="large" class="mb-2">mdi-image-search-outline</v-icon>
                    <span class="text-caption">Nenhuma mídia encontrada com esta tag.</span>
                </div>

            </div>
        </v-col>
    </v-row>
</template>

<style scoped>
.gap-2 {
    gap: 8px;
}

.object-cover {
    object-fit: cover;
}

.transition-all {
    transition: all 0.2s ease-in-out;
}

/* Nova classe de Borda Indicativa */
.selected-item {
    outline: 3px solid rgb(var(--v-theme-primary));
    outline-offset: -3px;
    /* Joga a borda para dentro do card, evitando quebra do layout Flex */
    transform: scale(0.95);
    /* Dá um pequeno efeito de rebaixamento */
    box-shadow: 0 4px 8px rgba(var(--v-theme-primary), 0.3) !important;
}

.hide-scrollbar::-webkit-scrollbar {
    display: none;
}

.hide-scrollbar {
    -ms-overflow-style: none;
    /* IE e Edge */
    scrollbar-width: none;
    /* Firefox */
}

/* Deixa o botão de upload com aparência de área de drop/ação */
.border-dashed {
    border: 1px dashed rgba(var(--v-theme-on-surface), 0.3) !important;
}
</style>