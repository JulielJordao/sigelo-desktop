import { defineStore } from 'pinia';
import { ref } from 'vue';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
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

export type YoutubeMediaFile = MediaFile & { thumbnailUrl?: string, size_mb: number };

export const useYoutubeStore = defineStore('youtubeCache', () => {
    const cachedVideos = ref<YoutubeMediaFile[]>([]);
    const isLoading = ref(false);

    const state = ref<StatusYt>({downloading: false, progress: 0})

    const actions =  {
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

    return { cachedVideos, isLoading, state, actions, fetchCache, deleteVideo };
});