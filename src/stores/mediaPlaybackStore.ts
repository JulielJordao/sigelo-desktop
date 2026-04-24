import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * STORE DE PLAYBACK DE MÍDIA
 * ══════════════════════════════════════════════════════════════════════
 * MODELO: A ProjectionWindow (telão) é a ÚNICA fonte de verdade para
 * `currentTime`, `isPlaying`, `duration`. Estes campos NÃO devem ser
 * escritos por nenhum outro lugar além do listener de `projection-time-sync`
 * no LiveMediaController.
 *
 * Campos de controle local (gerenciados pelo LiveMediaController):
 *   - isMuted, isPreviewMode: preferências de UI
 *   - isDragging: flag transitória durante scrubbing
 *   - isPendingStateChange: aguardando confirmação do telão
 * ══════════════════════════════════════════════════════════════════════
 */
export const useMediaPlaybackStore = defineStore('mediaPlayback', () => {
    // ─── Fonte de verdade: espelha o estado da projeção ──────────────
    const currentTime = ref(0);
    const duration = ref(0);
    const isPlaying = ref(false);  // começa false — só vira true quando o telão confirmar

    // ─── Preferências locais de UI ───────────────────────────────────
    const isMuted = ref(false);
    const isPreviewMode = ref(true);

    // ─── Flags transitórias ──────────────────────────────────────────
    const isDragging = ref(false);

    // Comando enviado ao telão, aguardando confirmação via sync.
    // Enquanto true, botões de play/pause/seek mostram loading.
    const isPendingStateChange = ref(false);

    // ─── Reset ───────────────────────────────────────────────────────
    const resetMedia = () => {
        currentTime.value = 0;
        duration.value = 0;
        isPlaying.value = false;
        isMuted.value = false;
        isDragging.value = false;
        isPendingStateChange.value = false;
    };

    return {
        currentTime,
        duration,
        isPlaying,
        isMuted,
        isPreviewMode,
        isDragging,
        isPendingStateChange,
        resetMedia,
    };
});