<script setup lang="ts">
defineProps<{
    slides: Array<{ label: string, text: string }>;
    currentSlideIndex: number;
}>();

const emit = defineEmits<{
    (e: 'update:currentSlideIndex', index: number): void
}>();
</script>

<template>
    <div class="slide-grid pa-4 w-100">
        <v-card 
            v-for="(slide, index) in slides" :key="index"
            @click="emit('update:currentSlideIndex', index)"
            :elevation="currentSlideIndex === index ? 3 : 1"
            :class="[
                'cursor-pointer d-flex flex-column transition-swing h-100', /* <-- h-100 VOLTOU AQUI */
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
</template>
<style scoped>
.border-primary { border-color: rgb(var(--v-theme-primary)) !important; }
.text-truncate-multiline {
  display: -webkit-box;
  -webkit-line-clamp: 4; 
  line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.slide-grid {
  display: grid;
  /* Largura responsiva (mínimo de 180px) */
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  
  gap: 16px;
  
  /* O align-items não está mais aqui, então o Grid usa o padrão 'stretch' (esticar) */
  
  /* Garante que o bloco de slides não fique "flutuando" no meio se a tela for muito grande */
  align-content: start; 
}
</style>