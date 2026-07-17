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
  id: string;
  type: ProgramItemType;
  title: string;
  subtitle?: string;
  tone?: string;
  source?: string;
  icon: string;
  presetId?: string | null; // tema (preset) escolhido para a música
  payload: any;
}

export interface Program {
  _id: string;
  name: string;
  date: string; // ISO com data E horário
  items: ProgramItem[];
  createdAt: number;
  updatedAt: number;
  // Vínculo com evento (para comparar/sincronizar músicas)
  eventId?: string | null;
  eventSnapshot?: string[]; // ids das músicas do evento (na ordem) da última sincronização
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

const songIdOf = (s: any): string => s?._id ?? s?.id ?? "";

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

  const pastPrograms = computed(() =>
    sortedAsc.value.filter((p) => dayTime(p.date) < startOfToday()).reverse(),
  );

  // --- PERSISTÊNCIA (arquivo JSON) ---
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

  // --- NAVEGAÇÃO ---
  const openProgram = (id: string) => {
    currentProgramId.value = id;
    persist();
  };
  const closeProgram = () => {
    currentProgramId.value = null;
    persist();
  };

  // --- CRIAÇÃO / EDIÇÃO / IMPORTAÇÃO ---
  const createProgram = (name?: string, date?: Date | string) => {
    const p: Program = {
      _id: uid(),
      name: name?.trim() || "Nova Programação",
      date: (date ? new Date(date) : new Date()).toISOString(),
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      eventId: null,
    };
    programs.value.push(p);
    currentProgramId.value = p._id;
    persist();
    return p;
  };

  const updateProgramMeta = (id: string, name: string, date: Date | string) => {
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
      date: new Date(event.date).toISOString(),
      items,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      eventId: (event as any)._id ?? null,
      eventSnapshot: (songs || []).map(songIdOf),
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

  // --- BUILDERS DE ITEM ---
  const songToItem = (song: any): ProgramItem => ({
    id: uid(),
    type: "song",
    title: song.fullName || song.name || "Música",
    subtitle: song.writerBy || "",
    tone: song.tone || "",
    icon: "mdi-music-note",
    presetId: song.presetId ?? null,
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
      provider: extra.provider ?? "manual",
      text: extra.text ?? "",
      verses: extra.verses ?? [],
      origin: extra.origin ?? null,
    },
  });

  // --- ITENS DA PROGRAMAÇÃO ATUAL ---
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

  // --- EDIÇÃO DE ITENS (item 2 e 3) ---
  const findItem = (itemId: string) =>
    currentProgram.value?.items.find((i) => i.id === itemId) || null;

  const touch = () => {
    if (currentProgram.value) currentProgram.value.updatedAt = Date.now();
    persist();
  };

  // Tema (preset) por música — item 3
  const setItemPreset = (itemId: string, presetId: string | null) => {
    const it = findItem(itemId);
    if (!it) return;
    it.presetId = presetId ?? null;
    touch();
  };

  // Substituir a música do item (mantém o preset escolhido)
  const replaceSong = (itemId: string, song: any) => {
    const it = findItem(itemId);
    if (!it) return;
    it.title = song.fullName || song.name || "Música";
    it.subtitle = song.writerBy || "";
    it.tone = song.tone || "";
    it.payload = song;
    touch();
  };

  // Substituir a mídia do item
  const replaceMedia = (itemId: string, media: any) => {
    const it = findItem(itemId);
    if (!it) return;
    it.title = media.name || "Mídia";
    it.subtitle = media.isVideo ? "Vídeo" : "Imagem";
    it.icon = media.isVideo ? "mdi-play-box" : "mdi-image";
    it.payload = media;
    touch();
  };

  // Editar o texto da passagem bíblica
  const updateBibleText = (itemId: string, text: string) => {
    const it = findItem(itemId);
    if (!it || it.type !== "bible") return;
    it.payload = { ...it.payload, text };
    touch();
  };


  // ==========================================================
  // SINCRONIZAÇÃO COM O EVENTO (item 6)
  // ==========================================================
  const programSongIds = (p: Program) =>
    p.items.filter((i) => i.type === "song").map((i) => songIdOf(i.payload));

  // O evento mudou desde a última sincronização deste programa?
  const eventChangedSince = (programId: string, currentSongs: any[]) => {
    const p = programs.value.find((x) => x._id === programId);
    if (!p) return false;
    const snap = p.eventSnapshot || [];
    const cur = currentSongs.map(songIdOf);
    if (snap.length !== cur.length) return true;
    return snap.some((id, i) => id !== cur[i]);
  };

  // Diferenças entre as músicas do programa e as músicas atuais do evento.
  const diffProgramWithEvent = (programId: string, currentSongs: any[]) => {
    const p = programs.value.find((x) => x._id === programId);
    const progIds = p ? programSongIds(p) : [];
    const curIds = currentSongs.map(songIdOf);

    const added = currentSongs
      .filter((s) => !progIds.includes(songIdOf(s)))
      .map((s) => ({ id: songIdOf(s), name: s.fullName || s.name || "Música" }));

    const removed = (p?.items || [])
      .filter((i) => i.type === "song" && !curIds.includes(songIdOf(i.payload)))
      .map((i) => ({ name: i.title }));

    const commonProg = progIds.filter((id) => curIds.includes(id));
    const commonCur = curIds.filter((id) => progIds.includes(id));
    const reordered =
      commonProg.length > 0 && commonProg.some((id, i) => id !== commonCur[i]);

    return {
      added,
      removed,
      reordered,
      changed: added.length > 0 || removed.length > 0 || reordered,
    };
  };

  // Marca o estado atual do evento como "conhecido" (sem alterar itens).
  const acknowledgeEvent = (programId: string, currentSongs: any[]) => {
    const p = programs.value.find((x) => x._id === programId);
    if (!p) return;
    p.eventSnapshot = currentSongs.map(songIdOf);
    persist();
  };

  // Aplica as músicas do evento: reordena/atualiza as músicas mantendo mídias/bíblia no lugar.
  const applyEventSync = (programId: string, currentSongs: any[]) => {
    const p = programs.value.find((x) => x._id === programId);
    if (!p) return;

    const bySongId = new Map<string, ProgramItem>();
    p.items.forEach((i) => {
      if (i.type === "song") bySongId.set(songIdOf(i.payload), i);
    });

    // Sequência de músicas desejada (na ordem do evento), reaproveitando itens existentes.
    const desired = currentSongs.map(
      (s) => bySongId.get(songIdOf(s)) ?? songToItem(s),
    );

    // Preenche os "slots" de música na ordem do evento; mídias/bíblia ficam onde estão.
    const result: ProgramItem[] = [];
    let di = 0;
    for (const it of p.items) {
      if (it.type === "song") {
        if (di < desired.length) {
          result.push(desired[di]);
          di++;
        }
        // se sobraram menos músicas que slots → música removida (slot some)
      } else {
        result.push(it);
      }
    }
    // músicas novas que sobraram entram no fim
    while (di < desired.length) {
      result.push(desired[di]);
      di++;
    }

    p.items = result;
    p.eventSnapshot = currentSongs.map(songIdOf);
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
    setItemPreset,
    replaceSong,
    replaceMedia,
    updateBibleText,
    songToItem,
    mediaToItem,
    bibleToItem,
    // sincronização com evento
    eventChangedSince,
    diffProgramWithEvent,
    acknowledgeEvent,
    applyEventSync,
  };
});