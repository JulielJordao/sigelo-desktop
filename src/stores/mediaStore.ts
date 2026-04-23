// src/stores/mediaStore.ts
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { readDir, stat, copyFile, remove, mkdir, exists, rename } from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join, basename, extname, dirname } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Store } from "@tauri-apps/plugin-store";
import { load } from '@tauri-apps/plugin-store';
import { usePresentationStore } from './usePresentationStore';

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

export type TagsByFile = Record<string, string[]>;

export const useMediaStore = defineStore('media', () => {

  const presentationStore = usePresentationStore()

  const mediaFiles = ref<MediaFile[]>([]);

  const favoriteFiles = ref<string[]>([])
  
  const tagsByFiles = ref<TagsByFile>({})
  
  const allTags = ref<string[]>([])

  let tauriStore: Store | null = null;

  const fixedMedia = ref<MediaFile | null>(null);

  const isLoading = ref(false);
  const isLoaded = ref(false)

  const themeFiles = computed(() => mediaFiles.value.filter(m => m.type === 'Theme'));
  const reproductionFiles = computed(() => mediaFiles.value.filter(m => m.type === 'Media'));

  // 2. Salva no disco nativo toda vez que algo em settings mudar
  watch(
    favoriteFiles,
    async (newFavorites) => {
      if (!isLoaded.value || !tauriStore) return; // Só tenta salvar se o tauriStore já foi instanciado

      await tauriStore.set('favorite_files', newFavorites);
      await tauriStore.save();
    },
    { deep: true }
  );

  watch(
    tagsByFiles,
    async (newListTagsByFiles) => {
      console.log(newListTagsByFiles)
      if (!isLoaded.value || !tauriStore) return; // Só tenta salvar se o tauriStore já foi instanciado
      const tags = <string[]>[]

      Object.entries(tagsByFiles.value).forEach(([_, listTags]) => {
        listTags.forEach((it) => {
          if(!tags.includes(it)) tags.push(it)
        }) 
      });

      allTags.value = tags;

      const data = JSON.parse(JSON.stringify(newListTagsByFiles));

      await tauriStore.set('list_tags_by_files', data);
      await tauriStore.save();
    },
    { deep: true }
  );

  const applyNewTagsByFiles = (id: string, tags: string[]) => {
    tagsByFiles.value[id] = tags
  }

  const loadMedia = async () => {
    try {
      isLoading.value = true;
      const baseDir = await appLocalDataDir()
      const repFolder = await join(baseDir, 'media', 'reproducao');
      const themeFolder = await join(baseDir, 'media', 'slides');
      const youtubeFolder = await join(baseDir, 'media', 'reproducao', 'YouTube');

      if (!(await exists(repFolder))) await mkdir(repFolder, { recursive: true });
      if (!(await exists(themeFolder))) await mkdir(themeFolder, { recursive: true });
      if (!(await exists(youtubeFolder))) await mkdir(youtubeFolder, { recursive: true });

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

        for (const entry of ytEntries) {
          // 1. PROTEÇÃO: Ignora se for arquivo oculto sem nome (evita quebrar no Windows)
          if (!entry.isFile || !entry.name) continue;

          // 2. EXTENSÕES ABRANGENTES: O yt-dlp no Windows adora baixar .webm e .mkv
          const lowerName = entry.name.toLowerCase();
          const isSupportedVideo = lowerName.endsWith('.mp4') ||
            lowerName.endsWith('.webm') ||
            lowerName.endsWith('.mkv');

          if (isSupportedVideo) {
            const filePath = await join(youtubeFolder, entry.name);
            const fileStat = await stat(filePath);

            files.push({
              id: entry.name,
              // Remove qualquer uma das extensões suportadas para o nome de exibição ficar limpo
              name: entry.name.replace(/\.(mp4|webm|mkv)$/i, ''),
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
      } catch (e) {
        // Dica: Imprima o erro real temporariamente para debugar se a pasta realmente não existe
        console.warn("Pasta YouTube ausente ou erro ao ler:", e);
      }

      mediaFiles.value = files;

      tauriStore = await load('files.json', { autoSave: false, defaults: { favorite_files: [], list_tags_by_files: {}}});

      const savedFavorites = await tauriStore.get<string[]>('favorite_files');
 
      const listTagsByFiles = await tauriStore.get<TagsByFile>('list_tags_by_files');

      if(listTagsByFiles){
        tagsByFiles.value = listTagsByFiles 
      }

      if (Array.isArray(savedFavorites)) {
        const newFavorites = savedFavorites.filter(it => {
          return mediaFiles.value.find(file => {
            if (file.id === it) {
              file.isFavorite = true
              return true
            } else { return false }
          })
        })
        favoriteFiles.value = newFavorites
      }

      isLoaded.value = true
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
      console.log(context)
      const baseDir = await appLocalDataDir();
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
    const isYoutubeVideo = file.category === 'YouTube';

    if (completely) {
      try {
        // 1. Remove o arquivo principal primeiro
        await remove(file.path);

        if (isYoutubeVideo) {
          console.log("Removendo dependências de:", file.path);

          // Separa o diretório e o nome do arquivo lidando com / (Mac/Linux) e \ (Windows)
          // match[1] = "C:\Pasta\" ou "/home/pasta/"
          // match[2] = "meu.video.mp4"
          const match = file.path.match(/(.*[\\/])(.*)$/);

          if (match) {
            const dirPath = match[1];
            const fullFileName = match[2];

            // Remove apenas a última extensão (lida bem com "meu.video.legal.mp4")
            const lastDotIndex = fullFileName.lastIndexOf(".");
            const baseNameFile = lastDotIndex !== -1
              ? fullFileName.substring(0, lastDotIndex)
              : fullFileName;

            const jsonPath = `${dirPath}${baseNameFile}.info.json`;
            const imagePath = `${dirPath}${baseNameFile}.webp`;

            // Usamos .catch(() => {}) aqui para que, se o .json ou .webp já 
            // não existirem por algum motivo, a função não quebre e continue rodando
            await remove(jsonPath).catch(() => console.warn(`Não foi possível remover: ${jsonPath}`));
            await remove(imagePath).catch(() => console.warn(`Não foi possível remover: ${imagePath}`));
          }
        }

        // 2. Só remove da interface se tudo der certo
        mediaFiles.value.splice(index, 1);

      } catch (e) {
        console.error("Erro ao deletar arquivo principal do disco:", e);
        return;
      }
    }
  };

  const toggleFavorite = (fileId: string) => {
    const file = mediaFiles.value.find(f => f.id === fileId);
    if (file) {
      file.isFavorite = !file.isFavorite;

      if (file.isFavorite) {
        favoriteFiles.value.push(fileId)
      } else {
        const index = favoriteFiles.value.indexOf(fileId)

        if (index !== -1) {
          favoriteFiles.value.splice(index, 1)
        }
      }

    }
  };

  const updateDuration = (fileId: string, duration: number) => {
    const file = mediaFiles.value.find(f => f.id === fileId);
    if (file) {
      file.duration = duration;
    }
  };

  const renameMedia = async (file: MediaFile, newBaseName: string) => {
    try {
      const oldUrl = file.url;
      const oldPath = file.path;
      const dir = await dirname(oldPath);
      const ext = await extname(oldPath); // ex: 'mp4' ou 'mkv'

      // Nome base antigo sem a extensão (ex: "video_aula")
      const oldBaseName = await basename(oldPath, `.${ext}`);

      const newFileName = `${newBaseName}.${ext}`;
      const newPath = await join(dir, newFileName);

      if (await exists(newPath)) {
        return { success: false, error: `Já existe um arquivo chamado "${newFileName}" nesta pasta. Escolha um nome diferente.`}; // Interrompe a execução aqui
      }

      // 1. Renomeia o arquivo de mídia principal (.mp4, .mkv, etc)
      await rename(oldPath, newPath);

      // 2. Lógica para arquivos vinculados (YouTube / Webm / Info)
      // Procuramos por: nome.info.json e nome.webp
      const extraExtensions = ['info.json', 'webp'];

      for (const extraExt of extraExtensions) {
        const oldExtraPath = await join(dir, `${oldBaseName}.${extraExt}`);

        if (await exists(oldExtraPath)) {
          const newExtraPath = await join(dir, `${newBaseName}.${extraExt}`);
          await rename(oldExtraPath, newExtraPath);
        }
      }

      // 3. Atualiza o estado local do objeto MediaFile
      file.name = newFileName;
      file.path = newPath;
      file.url = convertFileSrc(newPath); // Nova URL do Asset Protocol v2

      // 4. Atualiza os Presets na PresentationStore
      // Dica: Se o seu preset salva a URL, comparamos com a antiga
      if (presentationStore.presets && presentationStore.presets.length > 0) {
        presentationStore.presets.forEach(preset => {
          if (preset.design.bgMedia === oldUrl) {
            preset.design.bgMedia = file.url;
          }
        });
      }

      // 5. Se o arquivo renomeado for o atual "Fixed Media", atualiza a ref
      if (fixedMedia.value?.id === file.id) {
        fixedMedia.value.path = newPath;
        fixedMedia.value.url = file.url;
      }
      return {success: true, error: ''}
    } catch (error) {
      return { success: false, error: "Erro crítico ao renomear arquivos de mídia:" + error }
    }
  };


  return {
    mediaFiles,
    fixedMedia,
    themeFiles,
    reproductionFiles,
    isLoading,
    tagsByFiles,
    allTags,
    applyNewTagsByFiles,
    setFixedMedia,
    loadMedia,
    toggleFavorite,
    renameMedia,
    updateDuration,
    addDroppedFiles,
    deleteFile
  };
});