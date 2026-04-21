import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useStatusPresentationStore } from './statusPresentationStore';
import { useConfigStore } from './useConfigStore';
import { useMediaStore } from './mediaStore';

export const useTimerStore = defineStore('timer', () => {
    // Persistência
    const durationSecs = ref(300); // 5 min padrão
    const position = ref('center'); // 'top' | 'bottom' | 'center'
    const fontFamily = ref('Roboto');

    const statusStore = useStatusPresentationStore();
    const configStore = useConfigStore()

    const currentClockTime = ref('00:00');

    const timerMode = ref<'countdown' | 'clock'>('countdown');

    // Fundo
    const bgType = ref<'media' | 'gradient'>('gradient');
    const bgMediaUrl = ref('');
    const bgIsVideo = ref(false);
    const gradientColors = ref(['#1a1a1a', '#4a4a4a']);

    // Ações de fim
    const audioUrl = ref('');
    const mediaAfterUrl = ref(''); // Mídia para tocar ao zerar

    // Estado de Execução
    const isActive = ref(false);
    const isPaused = ref(false);
    const timeRemaining = ref(0);
    const isFinished = ref(false)
    let timerInterval: ReturnType<typeof setInterval> | null = null;

    const formattedTime = computed(() => {
        if (timerMode.value === 'clock') {
            return currentClockTime.value;
        }
        const h = Math.floor(timeRemaining.value / 3600);
        const m = Math.floor((timeRemaining.value % 3600) / 60);
        const s = timeRemaining.value % 60;
        const parts = [m, s].map(v => v.toString().padStart(2, '0'));
        if (h > 0) parts.unshift(h.toString().padStart(2, '0'));
        return parts.join(':');
    });

    // Auto-Save (Sincronizado com Rust)
    const enableAutoSave = ref(true);
    watch([timerMode, durationSecs, position, fontFamily, bgType, bgMediaUrl, bgIsVideo, gradientColors], async () => {
        if (!enableAutoSave.value) return;
        await invoke('save_timer_settings', {
            payload: JSON.stringify({
                timerMode: timerMode.value,
                durationSecs: durationSecs.value,
                position: position.value,
                fontFamily: fontFamily.value,
                bgType: bgType.value,
                bgMediaUrl: bgMediaUrl.value,
                gradientColors: gradientColors.value
            })
        });
    }, { deep: true });

    const startTimer = async () => {
        // 3. Avisa o sistema central que a projeção atual agora é o Timer!
        // Ele vai abrir a janela automaticamente no monitor certo se estiver fechada.
        await statusStore.setNewPresentation('Timer', configStore.settings.selectedMonitor);

        isActive.value = true;
        isPaused.value = false;
        timeRemaining.value = durationSecs.value;

        const now = new Date();
        currentClockTime.value = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        await invoke('sync_timer_playback', { action: 'start', timeRemaining: timeRemaining.value });

        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            if (timerMode.value === 'clock') {
                const now = new Date();
                currentClockTime.value = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            } else {
                if (!isPaused.value) {
                    timeRemaining.value--;
                    if (timeRemaining.value <= 0) finishTimer();
                }
            }
        }, 1000);
    };

    const finishTimer = async () => {
        stopTimer();

        if (audioUrl.value) {
            const audio = new Audio(audioUrl.value);
            audio.play();
        }

        if (mediaAfterUrl.value) {
            const mediaStore = useMediaStore();
            const statusStore = useStatusPresentationStore();

            const mediaObject = mediaStore.mediaFiles.find(m => m.url === mediaAfterUrl.value);

            if (mediaObject) {
                // 4. Se for tocar uma mídia final, muda o status da apresentação para 'Media'
                await statusStore.setNewPresentation('Media', configStore.settings.selectedMonitor);
                
                await emit('project-media', mediaObject);

                statusStore.setProjectedMedia(mediaObject);

                isFinished.value = true
            }
        }
    };

    const stopTimer = () => {
        isActive.value = false;
        timeRemaining.value = 0;
        if (timerInterval) clearInterval(timerInterval);
        // Correção: Envia o timeRemaining zerado
        invoke('sync_timer_playback', { action: 'stop', timeRemaining: 0 });

        if (statusStore.status.isPresentation === 'Timer') {
            statusStore.clean();
        }
    };

    return {
        timerMode, durationSecs, position, fontFamily, bgType, bgMediaUrl, bgIsVideo, gradientColors,
        audioUrl, mediaAfterUrl, enableAutoSave, isFinished,
        isActive, isPaused, timeRemaining, currentClockTime, formattedTime,
        startTimer, stopTimer
    };
});