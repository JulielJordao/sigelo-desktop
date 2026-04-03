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
    <v-row density="comfortable">
        <v-col cols="6" sm="4" md="3" lg="2" v-for="(slide, index) in slides" :key="index">
            <v-card 
                @click="emit('update:currentSlideIndex', index)"
                :elevation="currentSlideIndex === index ? 3 : 1"
                :class="[
                    'cursor-pointer d-flex flex-column transition-swing',
                    currentSlideIndex === index ? 'border-primary' : 'border'
                ]"
                style="aspect-ratio: 16/9; border-width: 2px !important;"
            >
                <div class="px-2 py-1 border-b d-flex justify-space-between align-center" style="background-color: rgba(0,0,0,0.04);">
                    <span class="text-caption font-weight-bold text-truncate">
                        {{ slide.label || `Slide ${index + 1}` }}
                    </span>
                    <v-icon v-if="currentSlideIndex === index" color="primary" size="small">
                        mdi-check-circle
                    </v-icon>
                </div>
                <div class="flex-grow-1 d-flex align-start justify-center pa-2 overflow-hidden bg-white">
                    <span class="text-caption text-grey-darken-3 text-truncate-multiline">
                        {{ slide.text }}
                    </span>
                </div>
            </v-card>
        </v-col>
    </v-row>
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
</style>