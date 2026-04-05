// src/stores/mediaStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { readDir, stat, writeFile, remove } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';

export type MediaContext = 'Media' | 'Theme';

export interface MediaFile {
  id: string;
  name: string;
  path: string;
  url: string;
  isVideo: boolean;
  modifiedAt: number;
  category: string;
  isFavorite: boolean;
  type: MediaContext;
  duration?: number;
}

export const useMediaStore = defineStore('media', () => {
  const mediaFiles = ref<MediaFile[]>([]);
  const isLoading = ref(false);

  const themeFiles = computed(() => mediaFiles.value.filter(m => m.type === 'Theme'));
  const reproductionFiles = computed(() => mediaFiles.value.filter(m => m.type === 'Media'));

  const loadMedia = async () => {
    try {
      isLoading.value = true;
      const baseDir = await appDataDir();
      const repFolder = await join(baseDir, 'media', 'reproducao');
      const themeFolder = await join(baseDir, 'media', 'slides');
      
      const files: MediaFile[] = [];
      
      try {
        const entries = await readDir(repFolder);
        const mediaFilesFromRep = await getJsonFiles('Media', entries, repFolder);
        files.push(...mediaFilesFromRep);
      } catch (e) { console.warn("Pasta reproducao ausente", e) }

      try {
        const themeEntries = await readDir(themeFolder);
        const mediaFilesFromTheme = await getJsonFiles('Theme', themeEntries, themeFolder);
        files.push(...mediaFilesFromTheme);
      } catch (e) { console.warn("Pasta slides ausente", e) }
      
      mediaFiles.value = files;
    } catch (error) {
      console.error("Erro ao carregar mídias do Pinia:", error);
    } finally {
      isLoading.value = false;
    }
  };

  const getJsonFiles = async (type: MediaContext, entries: any[], folder: string) => {
    const files : MediaFile[] = []
    for (const entry of entries) {
        if (entry.isFile) {
          const ext = entry.name.split('.').pop()?.toLowerCase();
          const isVideo = ['mp4', 'webm', 'mov'].includes(ext || '');
          const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '');
          
          if (isImage || isVideo) {
            const fullPath = await join(folder, entry.name);
            const fileStat = await stat(fullPath);
            
            const existingFile = mediaFiles.value.find(f => f.id === `${entry.name}-${type}`);
            
            files.push({
              id: `${entry.name}-${type}`, 
              name: entry.name,
              path: fullPath,
              url: convertFileSrc(fullPath),
              isVideo,
              modifiedAt: fileStat.mtime?.getTime() || 0,
              category: existingFile ? existingFile.category : 'Geral',
              isFavorite: existingFile ? existingFile.isFavorite : false,
              type: type,
              duration: existingFile?.duration
            });
          }
        }
      }
      return files;
  }

  const addDroppedFiles = async (filesList: FileList | File[], context: MediaContext) => {
    isLoading.value = true;
    try {
      const baseDir = await appDataDir();
      const targetFolder = context === 'Media' 
        ? await join(baseDir, 'media', 'reproducao') 
        : await join(baseDir, 'media', 'slides');

      for (let i = 0; i < filesList.length; i++) {
        const file = filesList[i];
        
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;

        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const filePath = await join(targetFolder, file.name);

        await writeFile(filePath, bytes);
      }
      
      await loadMedia();
    } catch (e) {
      console.error("Erro ao salvar arquivos arrastados:", e);
    } finally {
      isLoading.value = false;
    }
  };

  // NOVA FUNÇÃO: Deletar arquivo
  const deleteFile = async (fileId: string, completely: boolean) => {
    const index = mediaFiles.value.findIndex(f => f.id === fileId);
    if (index === -1) return;

    const file = mediaFiles.value[index];

    if (completely) {
      try {
        await remove(file.path); // Remove fisicamente do HD
      } catch (e) {
        console.error("Erro ao deletar arquivo do disco:", e);
        return; // Retorna para não remover da interface caso o Tauri falhe
      }
    }
    
    // Remove da interface Vue (tanto no soft delete quanto no hard delete)
    mediaFiles.value.splice(index, 1);
  };

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
    themeFiles,
    reproductionFiles,
    isLoading, 
    loadMedia, 
    toggleFavorite,
    updateDuration,
    addDroppedFiles,
    deleteFile
  };
});