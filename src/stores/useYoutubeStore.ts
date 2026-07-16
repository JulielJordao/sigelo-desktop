import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { MediaFile, MediaContext } from './mediaStore';

interface RustCachedVideo {
    filename: string;
    path: string;
    size_mb: number;
    modified_at: number;
    duration: number;
    thumbnail_path: string;
}

interface StatusYt {
    downloading: boolean,
    progress: number
}

// Estado do "motor" (yt-dlp + ffmpeg + deno) baixado sob demanda.
interface EngineState {
    isReady: boolean;
    isUpdating: boolean;
    error: string | null;
    progress: number; // componentes já concluídos (0..total)
    total: number;
}

export type YoutubeMediaFile = MediaFile & { thumbnailUrl?: string, size_mb: number };

export const useYoutubeStore = defineStore('youtubeCache', () => {
    const cachedVideos = ref<YoutubeMediaFile[]>([]);
    const isLoading = ref(false);

    const state = ref<StatusYt>({ downloading: false, progress: 0 })

    const actions = {
        start() {
            state.value.downloading = true
            state.value.progress = 0
        },

        setProgress(value: number) {
            state.value.progress = value
        },

        finish() {
            state.value.downloading = false
            state.value.progress = 0
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // MOTOR (binários) — download em paralelo, dirigido por eventos do Rust
    // ─────────────────────────────────────────────────────────────────────
    //
    // Fica aqui (e não numa store separada) para que o header e a modal
    // compartilhem o mesmo estado: o download continua sendo refletido na UI
    // mesmo que a modal feche no meio. Os eventos vêm de `update_binaries`:
    //   engine-update-started / -progress / -finished / -error
    //
    const engine = reactive<EngineState>({
        isReady: false,
        isUpdating: false,
        error: null,
        progress: 0,
        total: 3,
    });

    let engineListenersReady = false;

    // Apenas registra os listeners (não dispara download). Chame no header,
    // para que o indicador funcione mesmo antes de a modal abrir.
    async function initEngineListeners(): Promise<void> {
        if (engineListenersReady) return;
        engineListenersReady = true;

        await listen('engine-update-started', () => {
            engine.isUpdating = true;
            engine.error = null;
            engine.progress = 0;
        });

        await listen('engine-update-progress', () => {
            engine.progress = Math.min(engine.total, engine.progress + 1);
        });

        await listen('engine-update-finished', () => {
            engine.isUpdating = false;
            engine.isReady = true;
            engine.progress = engine.total;
        });

        await listen<string>('engine-update-error', (e) => {
            engine.isUpdating = false;
            engine.error = (e.payload as string) || 'Falha ao atualizar os componentes.';
        });
    }

    // Garante o motor pronto. Se faltar, dispara a atualização em segundo
    // plano (não bloqueia). Chame ao abrir a modal.
    async function ensureEngineReady(): Promise<void> {
        await initEngineListeners();
        if (engine.isReady || engine.isUpdating) return;
        try {
            const exists = await invoke<boolean>('check_ytdlp_status');
            if (exists) {
                engine.isReady = true;
                return;
            }
        } catch (e) {
            console.error('check_ytdlp_status falhou:', e);
        }
        updateEngine();
    }

    // Fire-and-forget: o backend continua mesmo se a modal fechar. O estado
    // é dirigido pelos eventos; o catch cobre só a falha de iniciar o comando.
    function updateEngine(): void {
        if (engine.isUpdating) return;
        engine.isUpdating = true;
        engine.error = null;
        engine.progress = 0;
        void initEngineListeners();
        invoke('update_binaries').catch((e) => {
            engine.isUpdating = false;
            engine.error = String(e);
        });
    }

    const fetchCache = async () => {
        isLoading.value = true;
        try {
            const rawVideos = await invoke<RustCachedVideo[]>('get_cached_videos');

            cachedVideos.value = rawVideos.map(video => {
                return {
                    id: video.filename,
                    name: video.filename.replace('.mp4', ''),
                    path: video.path,
                    url: convertFileSrc(video.path),
                    isVideo: true,
                    modifiedAt: video.modified_at,
                    category: 'YouTube',
                    isFavorite: false,
                    type: 'youtube' as MediaContext,
                    duration: video.duration,
                    size_mb: video.size_mb,
                    // Se o Rust achou uma thumb, a gente converte pra URL legível do Tauri
                    thumbnailUrl: video.thumbnail_path ? convertFileSrc(video.thumbnail_path) : undefined
                };
            });
            cachedVideos.value.sort((a, b) => b.modifiedAt - a.modifiedAt);

        } catch (error) {
            console.error("Erro ao ler cache do YouTube:", error);
        } finally {
            isLoading.value = false;
        }
    };

    const deleteVideo = async (filename: string) => {
        try {
            await invoke('delete_cached_video', { filename });
            await fetchCache();
        } catch (error) {
            console.error("Erro ao deletar vídeo:", error);
        }
    };

    return {
        cachedVideos, isLoading, state, actions,
        engine, initEngineListeners, ensureEngineReady, updateEngine,
        fetchCache, deleteVideo
    };
});