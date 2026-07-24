// src/stores/mediaStore.ts
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import {
  readDir,
  stat,
  copyFile,
  remove,
  mkdir,
  exists,
  rename,
} from "@tauri-apps/plugin-fs";
import {
  appLocalDataDir,
  join,
  basename,
  extname,
  dirname,
} from "@tauri-apps/api/path";
import { convertFileSrc, invoke } from "@tauri-apps/api/core"; // <-- Importei o invoke aqui
import { Store } from "@tauri-apps/plugin-store";
import { load } from "@tauri-apps/plugin-store";
import { usePresentationStore } from "./usePresentationStore";

export type MediaContext = "Media" | "Theme" | "YouTube";

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

export interface MediaViewPrefs {
  viewMode: 'list' | 'grid';
  activeFilter: 'all' | 'images' | 'videos' | 'favorites';
  sortBy: 'name' | 'date' | 'type';
  sortDesc: boolean;
  currentContext: 'Media' | 'Theme';
}

export const useMediaStore = defineStore("media", () => {
  const presentationStore = usePresentationStore();

  const mediaFiles = ref<MediaFile[]>([]);
  const favoriteFiles = ref<string[]>([]);
  const tagsByFiles = ref<TagsByFile>({});
  const allTags = ref<string[]>([]);

  let tauriStore: Store | null = null;

  const fixedMedia = ref<MediaFile | null>(null);

  const isLoading = ref(false);
  const isLoaded = ref(false);

  // Controle para evitar concorrência na fila de extração
  const isExtractingAudio = ref(false);

  const themeFiles = computed(() =>
    mediaFiles.value.filter((m) => m.type === "Theme"),
  );
  const reproductionFiles = computed(() =>
    mediaFiles.value.filter((m) => m.type === "Media"),
  );

  watch(
    favoriteFiles,
    async (newFavorites) => {
      if (!isLoaded.value || !tauriStore) return;
      await tauriStore.set("favorite_files", newFavorites);
      await tauriStore.save();
    },
    { deep: true },
  );

  watch(
    tagsByFiles,
    async (newListTagsByFiles) => {
      if (!isLoaded.value || !tauriStore) return;
      const tags = <string[]>[];

      Object.entries(tagsByFiles.value).forEach(([_, listTags]) => {
        listTags.forEach((it) => {
          if (!tags.includes(it)) tags.push(it);
        });
      });

      allTags.value = tags;
      const data = JSON.parse(JSON.stringify(newListTagsByFiles));
      await tauriStore.set("list_tags_by_files", data);
      await tauriStore.save();
    },
    { deep: true },
  );

  const DEFAULT_PREFS: MediaViewPrefs = {
    viewMode: 'grid',
    activeFilter: 'all',
    sortBy: 'name',
    sortDesc: false,
    currentContext: 'Media',
  };

  const viewPrefs = ref<MediaViewPrefs>({ ...DEFAULT_PREFS });
  const prefsLoaded = ref(false);
  let prefsStore: Store | null = null;

  const loadViewPrefs = async () => {
    if (prefsLoaded.value) return;
    try {
      prefsStore = await load('ui_prefs.json', {
        autoSave: false,
        defaults: { media_view_prefs: DEFAULT_PREFS },
      });
      const saved = await prefsStore.get<Partial<MediaViewPrefs>>('media_view_prefs');
      if (saved) viewPrefs.value = { ...DEFAULT_PREFS, ...saved };
    } catch (e) {
      console.warn('Falha ao carregar preferências de visualização:', e);
    } finally {
      prefsLoaded.value = true;
    }
  };

  watch(viewPrefs, async (value) => {
    if (!prefsLoaded.value || !prefsStore) return;
    await prefsStore.set('media_view_prefs', JSON.parse(JSON.stringify(value)));
    await prefsStore.save();
  }, { deep: true });

  const applyNewTagsByFiles = (id: string, tags: string[]) => {
    tagsByFiles.value[id] = tags;
  };

  // --- 🎧 FILA SILENCIOSA DE EXTRAÇÃO DE ÁUDIO ---
  const processAudioExtractionQueue = async () => {
    if (isExtractingAudio.value) return; // Já tem uma fila rodando
    isExtractingAudio.value = true;

    try {
      const videos = mediaFiles.value.filter((f) => f.isVideo);

      for (const video of videos) {
        const dir = await dirname(video.path);
        const ext = await extname(video.path);
        const base = await basename(video.path, `.${ext}`);

        // Ex: C:/.../Deathstroke.m4a
        const audioPath = await join(dir, `${base}.m4a`);

        // Verifica se o áudio já foi extraído antes
        if (!(await exists(audioPath))) {
          console.log(`[Audio Queue] Extraindo áudio para: ${video.name}`);
          try {
            // Chama o Rust enviando o caminho do vídeo e onde salvar o áudio
            await invoke("extract_audio_local", {
              videoPath: video.path,
              audioPath: audioPath,
            });
          } catch (e) {
            console.warn(
              `[Audio Queue] Falha ao extrair áudio de ${video.name}:`,
              e,
            );
          }
        }
      }
    } finally {
      isExtractingAudio.value = false;
      console.log(`[Audio Queue] Fila concluída.`);
    }
  };

  const loadMedia = async () => {
    try {
      isLoading.value = true;
      const baseDir = await appLocalDataDir();
      const repFolder = await join(baseDir, "media", "reproducao");
      const themeFolder = await join(baseDir, "media", "slides");
      const youtubeFolder = await join(
        baseDir,
        "media",
        "reproducao",
        "YouTube",
      );

      if (!(await exists(repFolder)))
        await mkdir(repFolder, { recursive: true });
      if (!(await exists(themeFolder)))
        await mkdir(themeFolder, { recursive: true });
      if (!(await exists(youtubeFolder)))
        await mkdir(youtubeFolder, { recursive: true });

      const files: MediaFile[] = [];

      try {
        const entries = await readDir(repFolder);
        const mediaFilesFromRep = await getJsonFiles(
          "Media",
          entries,
          repFolder,
        );
        files.push(...mediaFilesFromRep);
      } catch (e) {
        console.warn("Pasta reproducao ausente", e);
      }

      try {
        const themeEntries = await readDir(themeFolder);
        const mediaFilesFromTheme = await getJsonFiles(
          "Theme",
          themeEntries,
          themeFolder,
        );
        files.push(...mediaFilesFromTheme);
      } catch (e) {
        console.warn("Pasta slides ausente", e);
      }

      try {
        const ytEntries = await readDir(youtubeFolder);

        for (const entry of ytEntries) {
          if (!entry.isFile || !entry.name) continue;

          const lowerName = entry.name.toLowerCase();
          const isSupportedVideo =
            lowerName.endsWith(".mp4") ||
            lowerName.endsWith(".webm") ||
            lowerName.endsWith(".mkv");

          if (isSupportedVideo) {
            const filePath = await join(youtubeFolder, entry.name);
            const fileStat = await stat(filePath);

            files.push({
              id: entry.name,
              name: entry.name.replace(/\.(mp4|webm|mkv)$/i, ""),
              path: filePath,
              url: convertFileSrc(filePath),
              isVideo: true,
              modifiedAt: fileStat.mtime
                ? fileStat.mtime.getTime()
                : Date.now(),
              category: "YouTube",
              isFavorite: false,
              type: "Media",
            });
          }
        }
      } catch (e) {
        console.warn("Pasta YouTube ausente ou erro ao ler:", e);
      }

      mediaFiles.value = files;

      tauriStore = await load("files.json", {
        autoSave: false,
        defaults: { favorite_files: [], list_tags_by_files: {} },
      });
      const savedFavorites = await tauriStore.get<string[]>("favorite_files");
      const listTagsByFiles =
        await tauriStore.get<TagsByFile>("list_tags_by_files");

      if (listTagsByFiles) tagsByFiles.value = listTagsByFiles;

      if (Array.isArray(savedFavorites)) {
        favoriteFiles.value = savedFavorites.filter((it) => {
          const found = mediaFiles.value.find((file) => file.id === it);
          if (found) {
            found.isFavorite = true;
            return true;
          }
          return false;
        });
      }

      isLoaded.value = true;

      // Lança o processamento em background (sem await para não travar a UI)
      processAudioExtractionQueue();
    } catch (error) {
      console.error("Erro ao carregar mídias do Pinia:", error);
    } finally {
      isLoading.value = false;
    }
  };

  const getJsonFiles = async (
    type: MediaContext,
    entries: any[],
    folder: string,
  ) => {
    const files: MediaFile[] = [];
    for (const entry of entries) {
      if (entry.isFile) {
        const ext = entry.name.split(".").pop()?.toLowerCase();
        const isVideo = ["mp4", "webm", "mov"].includes(ext || "");
        const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(
          ext || "",
        );

        if (isImage || isVideo) {
          const fullPath = await join(folder, entry.name);
          const fileStat = await stat(fullPath);
          const existingFile = mediaFiles.value.find(
            (f) => f.id === `${entry.name}-${type}`,
          );

          files.push({
            id: `${entry.name}-${type}`,
            name: entry.name,
            path: fullPath,
            url: convertFileSrc(fullPath),
            isVideo,
            modifiedAt: fileStat.mtime?.getTime() || 0,
            category: existingFile ? existingFile.category : "Geral",
            isFavorite: existingFile ? existingFile.isFavorite : false,
            type: type,
            duration: existingFile?.duration,
          });
        }
      }
    }
    return files;
  };

  const moveFile = async (fileId: string, destination: 'Media' | 'Theme') => {
    const file = mediaFiles.value.find((f) => f.id === fileId);
    if (!file) return { success: false, error: 'Arquivo não encontrado.' };
    if (file.type === destination) return { success: true, error: '' };

    if (file.category === 'YouTube') {
      return {
        success: false,
        error: 'Vídeos baixados do YouTube ficam numa pasta própria e não podem ser movidos entre as abas.',
      };
    }

    try {
      const baseDir = await appLocalDataDir();
      const targetFolder = destination === 'Media'
        ? await join(baseDir, 'media', 'reproducao')
        : await join(baseDir, 'media', 'slides');

      const fileName = await basename(file.path);
      const newPath = await join(targetFolder, fileName);

      if (await exists(newPath)) {
        return { success: false, error: `Já existe um arquivo "${fileName}" na aba de destino.` };
      }

      const dir = await dirname(file.path);
      const ext = await extname(file.path);
      const base = await basename(file.path, `.${ext}`);

      await rename(file.path, newPath);

      // Leva junto o áudio extraído e os artefatos do YouTube
      for (const extra of ['m4a', 'info.json', 'webp']) {
        const oldExtra = await join(dir, `${base}.${extra}`);
        if (await exists(oldExtra)) {
          await rename(oldExtra, await join(targetFolder, `${base}.${extra}`));
        }
      }

      const oldId = file.id;
      file.id = `${fileName}-${destination}`;
      file.type = destination;
      file.path = newPath;
      file.url = convertFileSrc(newPath);

      // Migra favorito e tags para o novo id
      const favIndex = favoriteFiles.value.indexOf(oldId);
      if (favIndex !== -1) favoriteFiles.value.splice(favIndex, 1, file.id);

      if (tagsByFiles.value[oldId]) {
        tagsByFiles.value[file.id] = tagsByFiles.value[oldId];
        delete tagsByFiles.value[oldId];
      }

      // Se era o fundo fixo ou estava projetando, o caminho antigo morreu
      if (fixedMedia.value?.id === oldId) fixedMedia.value = null;

      return { success: true, error: '' };
    } catch (error) {
      console.error('[moveFile] Falha ao mover:', error);
      return { success: false, error: 'Erro ao mover o arquivo: ' + error };
    }
  };

  const addDroppedFiles = async (
    filePaths: string[],
    context: MediaContext,
  ) => {
    isLoading.value = true;
    try {
      const baseDir = await appLocalDataDir();
      const targetFolder =
        context === "Media"
          ? await join(baseDir, "media", "reproducao")
          : await join(baseDir, "media", "slides");

      for (const sourcePath of filePaths) {
        const fileName = await basename(sourcePath);
        let extension = "";
        try {
          extension = (await extname(sourcePath)).toLowerCase();
        } catch {
          continue;
        }

        const validImageExts = [
          "jpg",
          "jpeg",
          "png",
          "gif",
          "webp",
          "bmp",
          "svg",
        ];
        const validVideoExts = ["mp4", "webm", "ogg", "mov", "mkv", "avi"];

        if (
          !validImageExts.includes(extension) &&
          !validVideoExts.includes(extension)
        )
          continue;

        const destPath = await join(targetFolder, fileName);
        await copyFile(sourcePath, destPath);
      }

      await loadMedia(); // loadMedia já dispara a fila de áudio no final!
    } catch (e) {
      console.error("Erro ao salvar arquivos arrastados:", e);
    } finally {
      isLoading.value = false;
    }
  };

  const setFixedMedia = async (media: MediaFile | null) => {
    fixedMedia.value = media;
  };

  const deleteFile = async (fileId: string, completely: boolean) => {
    const index = mediaFiles.value.findIndex((f) => f.id === fileId);
    if (index === -1) return;

    const file = mediaFiles.value[index];
    const isYoutubeVideo = file.category === "YouTube";

    if (completely) {
      try {
        await remove(file.path);

        const dirPath = await dirname(file.path);
        const ext = await extname(file.path);
        const baseNameFile = await basename(file.path, `.${ext}`);

        // --- TAMBÉM DELETA O ARQUIVO DE ÁUDIO (.m4a) ---
        if (file.isVideo) {
          const audioPath = await join(dirPath, `${baseNameFile}.m4a`);
          await remove(audioPath).catch(() => { });
        }

        if (isYoutubeVideo) {
          const jsonPath = await join(dirPath, `${baseNameFile}.info.json`);
          const imagePath = await join(dirPath, `${baseNameFile}.webp`);
          await remove(jsonPath).catch(() => { });
          await remove(imagePath).catch(() => { });
        }

        mediaFiles.value.splice(index, 1);
      } catch (e) {
        console.error("Erro ao deletar arquivo principal do disco:", e);
      }
    }
  };

  const toggleFavorite = (fileId: string) => {
    const file = mediaFiles.value.find((f) => f.id === fileId);
    if (file) {
      file.isFavorite = !file.isFavorite;
      if (file.isFavorite) {
        favoriteFiles.value.push(fileId);
      } else {
        const index = favoriteFiles.value.indexOf(fileId);
        if (index !== -1) favoriteFiles.value.splice(index, 1);
      }
    }
  };

  const updateDuration = (fileId: string, duration: number) => {
    const file = mediaFiles.value.find((f) => f.id === fileId);
    if (file) file.duration = duration;
  };

  const renameMedia = async (file: MediaFile, newBaseName: string) => {
    try {
      const oldUrl = file.url;
      const oldPath = file.path;
      const dir = await dirname(oldPath);
      const ext = await extname(oldPath);

      const oldBaseName = await basename(oldPath, `.${ext}`);
      const newFileName = `${newBaseName}.${ext}`;
      const newPath = await join(dir, newFileName);

      if (await exists(newPath)) {
        return {
          success: false,
          error: `Já existe um arquivo chamado "${newFileName}" nesta pasta.`,
        };
      }

      await rename(oldPath, newPath);

      // --- AGORA RENOMEIA O ÁUDIO E OUTRAS DEPENDÊNCIAS JUNTOS ---
      const extraExtensions = ["info.json", "webp", "m4a"]; // Adicionei 'm4a' aqui!

      for (const extraExt of extraExtensions) {
        const oldExtraPath = await join(dir, `${oldBaseName}.${extraExt}`);
        if (await exists(oldExtraPath)) {
          const newExtraPath = await join(dir, `${newBaseName}.${extraExt}`);
          await rename(oldExtraPath, newExtraPath);
        }
      }

      file.name = newFileName;
      file.path = newPath;
      file.url = convertFileSrc(newPath);

      if (presentationStore.presets && presentationStore.presets.length > 0) {
        presentationStore.presets.forEach((preset) => {
          if (preset.design.bgMedia === oldUrl)
            preset.design.bgMedia = file.url;
        });
      }

      if (fixedMedia.value?.id === file.id) {
        fixedMedia.value.path = newPath;
        fixedMedia.value.url = file.url;
      }
      return { success: true, error: "" };
    } catch (error) {
      return {
        success: false,
        error: "Erro crítico ao renomear arquivos de mídia:" + error,
      };
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
    viewPrefs,
    loadViewPrefs,
    moveFile,
    applyNewTagsByFiles,
    setFixedMedia,
    loadMedia,
    toggleFavorite,
    renameMedia,
    updateDuration,
    addDroppedFiles,
    deleteFile,
  };
});
