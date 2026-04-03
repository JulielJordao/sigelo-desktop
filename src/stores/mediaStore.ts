// src/stores/mediaStore.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { readDir, stat } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';

// Exportamos a interface para poder usá-la nos componentes
export interface MediaFile {
  id: string;
  name: string;
  path: string;
  url: string;
  isVideo: boolean;
  modifiedAt: number;
  category: string;
  isFavorite: boolean;
  duration?: number;
}

export const useMediaStore = defineStore('media', () => {
  const mediaFiles = ref<MediaFile[]>([]);
  const isLoading = ref(false);

  // Carrega os arquivos do Tauri (Agora centralizado!)
  const loadMedia = async () => {
    // Se já tiver carregado e não quisermos forçar um refresh, podemos pular
    // Mas se quiser forçar o refresh (botão de recarregar), deixamos executar.
    try {
      isLoading.value = true;
      const baseDir = await appDataDir();
      const repFolder = await join(baseDir, 'media', 'reproducao');
      
      const entries = await readDir(repFolder);
      const files: MediaFile[] = [];
      
      for (const entry of entries) {
        if (entry.isFile) {
          const ext = entry.name.split('.').pop()?.toLowerCase();
          const isVideo = ['mp4', 'webm', 'mov'].includes(ext || '');
          const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '');
          
          if (isImage || isVideo) {
            const fullPath = await join(repFolder, entry.name);
            const fileStat = await stat(fullPath);
            
            // Tenta manter o estado de favoritos/duração antigo se o arquivo já existia na lista
            const existingFile = mediaFiles.value.find(f => f.id === entry.name);
            
            files.push({
              id: entry.name,
              name: entry.name,
              path: fullPath,
              url: convertFileSrc(fullPath),
              isVideo,
              modifiedAt: fileStat.mtime?.getTime() || 0,
              category: existingFile ? existingFile.category : 'Geral',
              isFavorite: existingFile ? existingFile.isFavorite : false,
              duration: existingFile?.duration
            });
          }
        }
      }
      mediaFiles.value = files;
    } catch (error) {
      console.error("Erro ao carregar mídias do Pinia:", error);
    } finally {
      isLoading.value = false;
    }
  };

  // Ações globais
  const toggleFavorite = (fileId: string) => {
    const file = mediaFiles.value.find(f => f.id === fileId);
    if (file) {
      file.isFavorite = !file.isFavorite;
    }
  };

  const updateDuration = (fileId: string, duration: number) => {
    const file = mediaFiles.value.find(f => f.id === fileId);
    if (file) {
      file.duration = duration;
    }
  };

  return { 
    mediaFiles, 
    isLoading, 
    loadMedia, 
    toggleFavorite,
    updateDuration
  };
});