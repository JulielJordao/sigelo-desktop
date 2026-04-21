import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useMediaPlaybackStore = defineStore('mediaPlayback', () => {
    // ==========================================
    // ESTADO GLOBAL DA MÍDIA
    // ==========================================
    const currentTime = ref(0);
    const duration = ref(0);
    const isPlaying = ref(true);
    const isMuted = ref(false);
    const isPreviewMode = ref(true);
    const isDragging = ref(false);

    // ==========================================
    // REGISTRO DE VÍDEOS RENDERIZADOS
    // ==========================================
    // Conta quantos componentes <video> estão abertos no momento
    const activeVideos = ref(0);
    const hasActiveVideo = computed(() => activeVideos.value > 0);

    const registerVideo = () => activeVideos.value++;
    const unregisterVideo = () => {
        if (activeVideos.value > 0) activeVideos.value--;
    };

    // ==========================================
    // RELÓGIO FANTASMA GLOBAL
    // ==========================================
    let ghostTimer: ReturnType<typeof setInterval> | null = null;

    const startGhostTimer = () => {
        if (ghostTimer) return; // Garante que só existe UM timer no app inteiro
        
        ghostTimer = setInterval(() => {
            // A mágica: Só anda se estiver tocando, não estivermos arrastando a barra, 
            // e NENHUMA tag <video> estiver ativa na tela.
            if (isPlaying.value && !isDragging.value && !hasActiveVideo.value) {
                
                if (duration.value > 0 && currentTime.value >= duration.value) return;

                let nextTime = currentTime.value + 1;
                
                if (duration.value > 0 && nextTime >= duration.value) {
                    nextTime = duration.value;
                }
                
                currentTime.value = nextTime;
            }
        }, 1000);
    };

    const resetMedia = () => {
        currentTime.value = 0;
        duration.value = 0;
        isPlaying.value = true;
        isMuted.value = false;
        isDragging.value = false;
    };

    return {
        currentTime, duration, isPlaying, isMuted, isPreviewMode, isDragging,
        hasActiveVideo, registerVideo, unregisterVideo, startGhostTimer, resetMedia
    };
});