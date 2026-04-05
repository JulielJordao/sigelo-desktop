<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { usePresentationStore } from '../../stores/usePresentationStore';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore'; 

const store = usePresentationStore();
const mediaStore = useMediaStore();

const fileInput = ref<HTMLInputElement | null>(null);

onMounted(() => {
    if (mediaStore.themeFiles?.length === 0) {
        mediaStore.loadMedia();
    }
});

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
</script>

<template>
    <v-row class="fill-height">
        <v-col cols="12" md="4" class="border-e">
            <p class="text-caption font-weight-bold mb-2">Cores Sólidas</p>
            <div class="d-flex gap-2 mb-6">
                <v-tooltip text="Fundo Preto" location="bottom">
                    <template v-slot:activator="{ props }">
                        <v-card 
                            v-bind="props" 
                            width="60" height="60" color="#000000"
                            class="cursor-pointer transition-all"
                            :class="[store.design.bgType === 'color' && store.design.bgColor === '#000000' ? 'selected-item' : 'border']"
                            @click="selectColor('#000000')"
                        >
                            <div class="w-100 h-100 d-flex align-center justify-center">
                                <v-icon v-if="store.design.bgType === 'color' && store.design.bgColor === '#000000'" color="white" size="small">mdi-check</v-icon>
                            </div>
                        </v-card>
                    </template>
                </v-tooltip>

                <v-tooltip text="Fundo Branco" location="bottom">
                    <template v-slot:activator="{ props }">
                        <v-card 
                            v-bind="props" 
                            width="60" height="60" color="#FFFFFF"
                            class="cursor-pointer transition-all"
                            :class="[store.design.bgType === 'color' && store.design.bgColor === '#FFFFFF' ? 'selected-item' : 'border']"
                            @click="selectColor('#FFFFFF')"
                        >
                            <div class="w-100 h-100 d-flex align-center justify-center">
                                <v-icon v-if="store.design.bgType === 'color' && store.design.bgColor === '#FFFFFF'" color="black" size="small">mdi-check</v-icon>
                            </div>
                        </v-card>
                    </template>
                </v-tooltip>

                <v-tooltip text="Cor Personalizada" location="bottom">
                    <template v-slot:activator="{ props }">
                        <v-card 
                            v-bind="props" 
                            width="60" height="60"
                            :color="isCustomColor ? store.design.bgColor : 'surface-variant'"
                            class="cursor-pointer position-relative d-flex align-center justify-center transition-all"
                            :class="[isCustomColor ? 'selected-item' : 'border']"
                        >
                            <v-icon :color="isCustomColor ? 'white' : 'primary'">mdi-palette</v-icon>
                            
                            <input 
                                type="color" 
                                v-model="store.design.bgColor" 
                                @input="store.design.bgType = 'color'; store.design.bgMedia = ''"
                                class="position-absolute top-0 left-0 w-100 h-100 cursor-pointer" 
                                style="opacity: 0;"
                            >
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

        <v-col cols="12" md="8" class="d-flex flex-column">
            <p class="text-caption font-weight-bold mb-2">Galeria de Mídia</p>
            
            <div class="d-flex flex-wrap gap-2 overflow-y-auto pb-2" style="max-height: 100%;">
                
                <v-tooltip text="Usar imagem ou vídeo externo" location="top">
                    <template v-slot:activator="{ props }">
                        <v-card 
                            v-bind="props"
                            width="100" height="70" color="surface-variant" 
                            class="d-flex flex-column align-center justify-center cursor-pointer transition-all" 
                            :class="[store.design.bgType === 'upload' ? 'selected-item' : 'border']"
                            @click="fileInput?.click()"
                        >
                            <v-icon>mdi-upload</v-icon>
                            <input type="file" ref="fileInput" class="d-none" accept="image/*,video/*" @change="handleFileUpload">
                        </v-card>
                    </template>
                </v-tooltip>

                <v-card v-if="mediaStore.isLoading" width="100" height="70" class="d-flex align-center justify-center bg-grey-lighten-3 border">
                    <v-progress-circular indeterminate size="24" color="primary"></v-progress-circular>
                </v-card>

                <v-card 
                    v-for="file in mediaStore.themeFiles" 
                    :key="file.id" 
                    width="100" height="70" 
                    class="cursor-pointer position-relative overflow-hidden transition-all" 
                    :class="[store.design.bgType === 'saved' && store.design.bgMedia === file.url ? 'selected-item' : 'border']"
                    @click="selectLocalMedia(file)"
                >
                    <video v-if="file.isVideo" :src="`${file.url}#t=0.5`" class="w-100 h-100 object-cover" muted preload="metadata"></video>
                    <v-img v-else :src="file.url" cover height="100%"></v-img>

                    <div v-if="file.isVideo" class="position-absolute top-0 left-0 w-100 h-100 d-flex align-center justify-center" style="background: rgba(0,0,0,0.3);">
                        <v-icon color="white" size="small">mdi-video</v-icon>
                    </div>

                    <div v-if="store.design.bgType === 'saved' && store.design.bgMedia === file.url" class="position-absolute top-0 right-0 ma-1 bg-primary rounded-circle d-flex align-center justify-center" style="width: 18px; height: 18px; z-index: 10;">
                        <v-icon color="white" size="10">mdi-check</v-icon>
                    </div>
                </v-card>

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
    outline-offset: -3px; /* Joga a borda para dentro do card, evitando quebra do layout Flex */
    transform: scale(0.95); /* Dá um pequeno efeito de rebaixamento */
    box-shadow: 0 4px 8px rgba(var(--v-theme-primary), 0.3) !important;
}
</style>