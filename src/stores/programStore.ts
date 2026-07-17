// src/stores/programStore.ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import {
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
} from "@tauri-apps/plugin-fs";
import type { Event } from "../types/event";

export type ProgramItemType = "song" | "media" | "bible";

export interface ProgramItem {
  id: string; // id único da instância dentro da programação
  type: ProgramItemType;
  title: string;
  subtitle?: string;
  tone?: string; // tom da música (quando type === 'song')
  source?: string; // versão da bíblia (quando type === 'bible')
  icon: string;
  payload: any; // snapshot completo (música / mídia / { ref, source }) p/ apresentar depois
}

export interface Program {
  _id: string;
  name: string;
  date: string; // ISO com data E horário
  items: ProgramItem[];
  createdAt: number;
  updatedAt: number;
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const startOfToday = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
};

const dayTime = (d: string | Date) => {
  const o = new Date(d);
  return new Date(o.getFullYear(), o.getMonth(), o.getDate()).getTime();
};

export const useProgramStore = defineStore("program", () => {
  const programs = ref<Program[]>([]);
  const currentProgramId = ref<string | null>(null);
  const showPast = ref(false);

  const isLoaded = ref(false);

  // --- GETTERS ---
  const currentProgram = computed(
    () => programs.value.find((p) => p._id === currentProgramId.value) || null,
  );

  const sortedAsc = computed(() =>
    [...programs.value].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    ),
  );

  const futurePrograms = computed(() =>
    sortedAsc.value.filter((p) => dayTime(p.date) >= startOfToday()),
  );

  // Anteriores: mais recente primeiro
  const pastPrograms = computed(() =>
    sortedAsc.value.filter((p) => dayTime(p.date) < startOfToday()).reverse(),
  );

  // ==========================================================
  // PERSISTÊNCIA EM ARQUIVO JSON (appLocalDataDir/programacoes.json)
  // ==========================================================
  let filePath = "";

  const getFilePath = async () => {
    if (filePath) return filePath;
    const baseDir = await appLocalDataDir();
    if (!(await exists(baseDir))) await mkdir(baseDir, { recursive: true });
    filePath = await join(baseDir, "programacoes.json");
    return filePath;
  };

  const persist = async () => {
    if (!isLoaded.value) return;
    try {
      const path = await getFilePath();
      const data = {
        programs: JSON.parse(JSON.stringify(programs.value)),
        current_program_id: currentProgramId.value,
      };
      // Pretty-print para ficar legível/editável no disco
      await writeTextFile(path, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error("Erro ao salvar programações:", e);
    }
  };

  const loadPrograms = async () => {
    if (isLoaded.value) return;
    try {
      const path = await getFilePath();
      if (await exists(path)) {
        const raw = await readTextFile(path);
        const parsed = JSON.parse(raw || "{}");
        if (Array.isArray(parsed.programs)) programs.value = parsed.programs;
        currentProgramId.value = parsed.current_program_id ?? null;
      }
    } catch (e) {
      console.warn("Falha ao carregar programações:", e);
    } finally {
      isLoaded.value = true;
    }
  };

  // --- NAVEGAÇÃO (mantém a programação aberta ao voltar) ---
  const openProgram = (id: string) => {
    currentProgramId.value = id;
    persist();
  };

  const closeProgram = () => {
    currentProgramId.value = null;
    persist();
  };

  // ==========================================================
  // CRIAÇÃO / EDIÇÃO / IMPORTAÇÃO
  // ==========================================================
  const createProgram = (name?: string, date?: Date | string) => {
    const p: Program = {
      _id: uid(),
      name: name?.trim() || "Nova Programação",
      // Mantém data + horário informados (ou agora)
      date: (date ? new Date(date) : new Date()).toISOString(),
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    programs.value.push(p);
    currentProgramId.value = p._id;
    persist();
    return p;
  };

  // Atualiza nome + data/horário
  const updateProgramMeta = (
    id: string,
    name: string,
    date: Date | string,
  ) => {
    const p = programs.value.find((p) => p._id === id);
    if (!p) return;
    p.name = name?.trim() || p.name;
    p.date = new Date(date).toISOString();
    p.updatedAt = Date.now();
    persist();
  };

  const importFromEvent = (event: Event, songs: any[] = []) => {
    const items: ProgramItem[] = (songs || []).map((s) => songToItem(s));
    const p: Program = {
      _id: uid(),
      name: event.name,
      date: new Date(event.date).toISOString(), // herda data/horário do evento
      items,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    programs.value.push(p);
    currentProgramId.value = p._id;
    persist();
    return p;
  };

  const deleteProgram = (id: string) => {
    const i = programs.value.findIndex((p) => p._id === id);
    if (i !== -1) programs.value.splice(i, 1);
    if (currentProgramId.value === id) currentProgramId.value = null;
    persist();
  };

  // ==========================================================
  // BUILDERS DE ITEM
  // ==========================================================
  const songToItem = (song: any): ProgramItem => ({
    id: uid(),
    type: "song",
    title: song.fullName || song.name || "Música",
    subtitle: song.writerBy || "",
    tone: song.tone || "",
    icon: "mdi-music-note",
    payload: song,
  });

  const mediaToItem = (media: any): ProgramItem => ({
    id: uid(),
    type: "media",
    title: media.name || "Mídia",
    subtitle: media.isVideo ? "Vídeo" : "Imagem",
    icon: media.isVideo ? "mdi-play-box" : "mdi-image",
    payload: media,
  });

  const bibleToItem = (
    ref: any,
    source: string,
    extra: any = {},
  ): ProgramItem => ({
    id: uid(),
    type: "bible",
    title: extra.reference || ref?.label || ref?.reference || "Passagem bíblica",
    subtitle: source,
    source,
    icon: "mdi-book-open-page-variant",
    payload: {
      ref,
      version: source,
      provider: extra.provider ?? "manual", // 'bibliaonline' | 'manual'
      text: extra.text ?? "",
      verses: extra.verses ?? [],
      // origem: { url, label, donationUrl, extractedAt } | null (aviso da fonte)
      origin: extra.origin ?? null,
    },
  });

  // ==========================================================
  // ITENS DA PROGRAMAÇÃO ATUAL
  // ==========================================================
  const addItem = (item: ProgramItem) => {
    const p = currentProgram.value;
    if (!p) return;
    p.items.push(item);
    p.updatedAt = Date.now();
    persist();
  };

  const addSong = (song: any) => addItem(songToItem(song));
  const addMedia = (media: any) => addItem(mediaToItem(media));
  const addBible = (ref: any, source: string, extra: any = {}) =>
    addItem(bibleToItem(ref, source, extra));

  const removeItem = (itemId: string) => {
    const p = currentProgram.value;
    if (!p) return;
    const i = p.items.findIndex((it) => it.id === itemId);
    if (i !== -1) p.items.splice(i, 1);
    p.updatedAt = Date.now();
    persist();
  };

  const moveItem = (from: number, to: number) => {
    const p = currentProgram.value;
    if (!p || from === to) return;
    if (to < 0 || to >= p.items.length) return;
    const [moved] = p.items.splice(from, 1);
    p.items.splice(to, 0, moved);
    p.updatedAt = Date.now();
    persist();
  };

  const reorderItems = (newItems: ProgramItem[]) => {
    const p = currentProgram.value;
    if (!p) return;
    p.items = newItems;
    p.updatedAt = Date.now();
    persist();
  };

  return {
    // state
    programs,
    currentProgramId,
    showPast,
    isLoaded,
    // getters
    currentProgram,
    futurePrograms,
    pastPrograms,
    // actions
    loadPrograms,
    openProgram,
    closeProgram,
    createProgram,
    updateProgramMeta,
    importFromEvent,
    deleteProgram,
    addSong,
    addMedia,
    addBible,
    addItem,
    removeItem,
    moveItem,
    reorderItems,
    songToItem,
    mediaToItem,
    bibleToItem,
  };
});