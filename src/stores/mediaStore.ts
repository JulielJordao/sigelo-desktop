// src/stores/mediaStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { readDir, stat, copyFile, remove } from '@tauri-apps/plugin-fs';
import { appDataDir, join, basename, extname } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';

export type MediaContext = 'Media' | 'Theme' | 'YouTube';

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
  size_mb?: number;
}

export const useMediaStore = defineStore('media', () => {
  const mediaFiles = ref<MediaFile[]>([]);

  const fixedMedia = ref<MediaFile | null>(null);

  const isLoading = ref(false);

  const themeFiles = computed(() => mediaFiles.value.filter(m => m.type === 'Theme'));
  const reproductionFiles = computed(() => mediaFiles.value.filter(m => m.type === 'Media'));

  const loadMedia = async () => {
    try {
      isLoading.value = true;
      const baseDir = await appDataDir();
      const repFolder = await join(baseDir, 'media', 'reproducao');
      const themeFolder = await join(baseDir, 'media', 'slides');
      const youtubeFolder = await join(baseDir, 'media', 'reproducao', 'YouTube');

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

      try {
        const ytEntries = await readDir(youtubeFolder);
        // Atenção: Certifique-se de que a sua função 'getJsonFiles' saiba lidar com 
        // a leitura desses arquivos. Como o yt-dlp não gera o mesmo JSON que o seu app,
        // você pode precisar criar uma lógica separada para montar o objeto MediaFile
        // dos vídeos do YouTube, caso o getJsonFiles ignore vídeos sem JSON próprio.
        
        // Exemplo simplificado de como ler direto sem depender do getJsonFiles:
        for (const entry of ytEntries) {
            if (entry.isFile && entry.name.endsWith('.mp4')) {
                const filePath = await join(youtubeFolder, entry.name);
                const fileStat = await stat(filePath);
                
                files.push({
                    id: entry.name,
                    name: entry.name.replace('.mp4', ''),
                    path: filePath,
                    url: convertFileSrc(filePath),
                    isVideo: true,
                    modifiedAt: fileStat.mtime ? fileStat.mtime.getTime() : Date.now(),
                    category: 'YouTube',
                    isFavorite: false,
                    type: 'Media'
                });
            }
        }
      } catch (e) { console.warn("Pasta YouTube ausente", e) }

      mediaFiles.value = files;
    } catch (error) {
      console.error("Erro ao carregar mídias do Pinia:", error);
    } finally {
      isLoading.value = false;
    }
  };

  const getJsonFiles = async (type: MediaContext, entries: any[], folder: string) => {
    const files: MediaFile[] = []
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

  const addDroppedFiles = async (filePaths: string[], context: MediaContext) => {
    isLoading.value = true;
    try {
      const baseDir = await appDataDir();
      const targetFolder = context === 'Media'
        ? await join(baseDir, 'media', 'reproducao')
        : await join(baseDir, 'media', 'slides');

      for (const sourcePath of filePaths) {
        // 1. Extrair o nome e a extensão do caminho (ex: "video", "mp4")
        const fileName = await basename(sourcePath);

        // Proteção para caso não haja extensão:
        let extension = '';
        try {
          extension = (await extname(sourcePath)).toLowerCase();
        } catch {
          continue; // Pula se for uma pasta ou não tiver extensão
        }

        // 2. Validar se é imagem ou vídeo (substituindo o file.type antigo)
        const validImageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
        const validVideoExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi'];

        if (!validImageExts.includes(extension) && !validVideoExts.includes(extension)) {
          console.warn(`Arquivo ignorado (formato não suportado): ${fileName}`);
          continue;
        }

        // 3. Montar o caminho final de destino
        const destPath = await join(targetFolder, fileName);

        // 4. Copiar o arquivo nativamente
        await copyFile(sourcePath, destPath);
      }

      await loadMedia();
    } catch (e) {
      console.error("Erro ao salvar arquivos arrastados:", e);
    } finally {
      isLoading.value = false;
    }
  };

  const setFixedMedia = async (media: MediaFile | null) => {
    fixedMedia.value = media;
  }

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
    fixedMedia,
    themeFiles,
    reproductionFiles,
    isLoading,
    setFixedMedia,
    loadMedia,
    toggleFavorite,
    updateDuration,
    addDroppedFiles,
    deleteFile
  };
});