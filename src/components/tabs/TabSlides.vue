<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';

const props = defineProps<{
    slides: Array<{ label: string, text: string }>;
    currentSlideIndex: number;
}>();

const emit = defineEmits<{
    (e: 'update:currentSlideIndex', index: number): void
}>();

// Referência para o container com scroll
const scrollContainer = ref<HTMLElement | null>(null);

// Função para rolar até o slide selecionado
const scrollToSelectedSlide = async (index: number) => {
    await nextTick();
    
    // Procura o card pelo id
    const element = document.getElementById(`slide-item-${index}`);
    
    if (element && scrollContainer.value) {
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'center'   // centraliza o card na área visível
        });
    }
};

// Observa mudanças no currentSlideIndex (vindo do pai)
watch(() => props.currentSlideIndex, (newIndex) => {
    if (newIndex !== undefined && newIndex !== null) {
        scrollToSelectedSlide(newIndex);
    }
}, { immediate: true });  // immediate: true para rolar já no carregamento inicial
</script>

<template>
    <div 
        ref="scrollContainer"
        class="h-100 overflow-y-auto" 
        style="min-height: 0;"
    >
        <div class="slide-grid">
            <v-card 
                v-for="(slide, index) in slides" 
                :key="index"
                :id="'slide-item-' + index"
                @click="emit('update:currentSlideIndex', index)"
                :elevation="currentSlideIndex === index ? 3 : 1"
                :class="[
                    'cursor-pointer d-flex flex-column transition-swing h-100',
                    currentSlideIndex === index ? 'border-primary' : 'border'
                ]"
                style="border-width: 2px !important;"
            >
                <div class='px-2 py-1 border-b d-flex justify-space-between align-center flex-shrink-0'>
                    <span class="text-caption font-weight-bold text-truncate">
                        {{ slide.label || `Slide ${index + 1}` }}
                    </span>
                    <v-icon v-if="currentSlideIndex === index" color="primary" size="small">
                        mdi-check-circle
                    </v-icon>
                </div>
                
                <div class="flex-grow-1 d-flex align-start justify-center pa-2 py-3 overflow-hidden bg-surface-light">
                    <span class="text-caption text-center">
                        {{ slide.text }}
                    </span>
                </div>
            </v-card>
        </div>
    </div>
</template>

<style scoped>
.slide-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
  padding-bottom: 24px;
  padding-right: 8px;
}

.slide-grid::-webkit-scrollbar {
  width: 8px;
}
.slide-grid::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
}

.border-primary { 
  border-color: rgb(var(--v-theme-primary)) !important; 
}
</style>