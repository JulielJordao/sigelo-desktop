// src/stores/remoteControlStore.ts
// ═════════════════════════════════════════════════════════════════════════
// CONTROLE REMOTO PELO CELULAR
// ─────────────────────────────────────────────────────────────────────────
// O servidor (src-tauri/src/remote) recebe os comandos do celular e os
// entrega aqui pelo evento "remote-command". Este store:
//   • liga/desliga o servidor e guarda o pareamento (token/código)
//   • executa os comandos (slides, Bíblia, vídeo, músicas, programações)
//   • publica o estado atual para os celulares (invoke publish_remote_message)
//
// Os slides da música vivem no PresentationEditor; ele se registra aqui
// (registerSlideController / setSongSlides) para poder ser comandado.
// ═════════════════════════════════════════════════════════════════════════
import { defineStore } from 'pinia';
import { ref, computed, watch, nextTick } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit as tauriEmit, type UnlistenFn } from '@tauri-apps/api/event';

import { useStatusPresentationStore } from './statusPresentationStore';
import { useBibleStore } from './useBibleStore';
import { useMediaPlaybackStore } from './mediaPlaybackStore';
import { useMusicPresentationStore } from './presentationStore';
import { usePresentationStore } from './usePresentationStore';
import { useProgramStore, type ProgramItem } from './programStore';
import { useSongCacheStore } from './songCacheStore';
import { useConfigStore } from './useConfigStore';
import { useUserStore } from './userStore';
import { api } from '../routes/index';
import { hostname } from '@tauri-apps/plugin-os';
import { getVersion } from '@tauri-apps/api/app';

export interface RemoteInfo {
  isRunning: boolean;
  url: string;
  pairingUrl: string;
  pin: string;
  token: string;
  qrSvg: string;
  port: number;
  localIp: string;
  connectedClients: number;
}

export interface SlideController {
  next: () => void;
  prev: () => void;
  goto: (index: number) => void;
  start: () => void;
  stop: () => void;
}

export interface PdfController {
  next: () => void;
  prev: () => void;
  goto: (page: number) => void;
  start: () => void;
  stop: () => void;
  /** Abre um PDF enviado pelo celular (e projeta, se `project`). */
  openData: (data: Uint8Array, name: string, project: boolean) => Promise<boolean>;
}

export interface PdfRemoteState {
  isOpen: boolean;
  isLoading: boolean;
  fileName: string;
  page: number;
  total: number;
  /** Imagens das páginas (data URL) — só para gerar as miniaturas do celular. */
  pages: string[];
}

interface RemoteCommand {
  type: 'command';
  action: string;
  [key: string]: any;
}

const PREFS_KEY = 'sigelo.remoteControl';

interface RemotePrefs {
  enabled: boolean;
  token?: string;
  pin?: string;
}

function loadPrefs(): RemotePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { enabled: false, ...JSON.parse(raw) } : { enabled: false };
  } catch {
    return { enabled: false };
  }
}

function savePrefs(prefs: RemotePrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignora */ }
}

const DEVICE_KEY = 'sigelo.remoteControl.deviceId';

/** Identificador fixo deste computador (para o app do celular achar o programa na conta). */
function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto as any).randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_KEY, id!);
    }
    return id!;
  } catch {
    return 'sigelo-desktop';
  }
}

/** Texto curto (sem HTML) para a lista do celular. */
function preview(text: string | undefined, max = 90): string {
  const clean = (text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

/** Reduz a imagem da página para mandar ao celular (leve, mas legível). */
function makeThumb(dataUrl: string, width = 480): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, width / (img.width || width));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round((img.width || width) * scale);
      canvas.height = Math.round((img.height || width) * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve('');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

/** Texto completo do slide (para o modo retorno), mantendo as quebras de linha. */
function fullText(text: string | undefined): string {
  return (text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Espera uma condição ficar verdadeira (ou desiste após `timeout` ms). */
function waitFor(cond: () => boolean, timeout = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    if (cond()) return resolve(true);
    const started = Date.now();
    const timer = setInterval(() => {
      if (cond()) { clearInterval(timer); resolve(true); }
      else if (Date.now() - started > timeout) { clearInterval(timer); resolve(false); }
    }, 100);
  });
}

export const useRemoteControlStore = defineStore('remoteControl', () => {
  const statusStore = useStatusPresentationStore();
  const bibleStore = useBibleStore();
  const playbackStore = useMediaPlaybackStore();
  const musicStore = useMusicPresentationStore();
  const presetStore = usePresentationStore();
  const programStore = useProgramStore();
  const songCacheStore = useSongCacheStore();
  const configStore = useConfigStore();

  // ─── Servidor ──────────────────────────────────────────────────────────
  const info = ref<RemoteInfo | null>(null);
  const isStarting = ref(false);
  const error = ref<string | null>(null);
  const connectedClients = ref(0);
  const isRunning = computed(() => !!info.value?.isRunning);

  // ─── Slides da música (registrados pelo PresentationEditor) ───────────
  let slideController: SlideController | null = null;
  const songTitle = ref('');
  const songSlides = ref<{ label: string; text: string }[]>([]);
  const songSlideIndex = ref(0);

  const registerSlideController = (controller: SlideController | null) => {
    slideController = controller;
  };

  const setSongSlides = (title: string, slides: { label: string; text: string }[], index: number) => {
    songTitle.value = title;
    songSlides.value = slides;
    songSlideIndex.value = index;
  };

  // ─── PDF (registrado pelo PdfPresenter) ────────────────────────────────
  let pdfController: PdfController | null = null;
  const pdf = ref({ isOpen: false, isLoading: false, fileName: '', page: 1, total: 0 });
  let pdfPages: string[] = [];
  let pdfThumbs: { key: string; pages: string[] } | null = null;

  const pdfKey = computed(() => `${pdf.value.fileName}#${pdf.value.total}`);

  const registerPdfController = (controller: PdfController | null) => {
    pdfController = controller;
  };

  const setPdfState = (s: PdfRemoteState) => {
    pdf.value = { isOpen: s.isOpen, isLoading: s.isLoading, fileName: s.fileName, page: s.page, total: s.total };
    pdfPages = s.pages;
  };

  /** Miniaturas das páginas (geradas uma vez por arquivo). */
  const getPdfThumbs = async (): Promise<string[]> => {
    if (pdfThumbs?.key === pdfKey.value) return pdfThumbs.pages;
    const key = pdfKey.value;
    const pages: string[] = [];
    for (const page of pdfPages) pages.push(await makeThumb(page));
    pdfThumbs = { key, pages };
    return pages;
  };

  // ─── Estado publicado para os celulares ───────────────────────────────
  const remoteState = computed(() => {
    const mode = statusStore.status.isPresentation;
    const program = programStore.currentProgram;
    const programList = [...programStore.futurePrograms];
    // Mantém a programação aberta na lista mesmo se for de dia anterior.
    if (program && !programList.some((p) => p._id === program._id)) programList.unshift(program);

    return {
      type: 'state',
      mode, // 'Slides' | 'Biblia' | 'Media' | 'Pdf' | 'Timer' | 'none'
      isRunning: !!statusStore.status.isRunning,
      windowHidden: statusStore.isWindowHidden,
      song: {
        title: songTitle.value,
        index: songSlideIndex.value,
        // Modo retorno: texto completo do slide atual e do próximo.
        currentText: fullText(songSlides.value[songSlideIndex.value]?.text),
        nextText: fullText(songSlides.value[songSlideIndex.value + 1]?.text),
        slides: songSlides.value.map((s) => ({ label: s.label, preview: preview(s.text) })),
      },
      bible: {
        active: bibleStore.step === 'projecting',
        index: bibleStore.currentSlideIndex,
        currentText: fullText(bibleStore.bibleSlides?.[bibleStore.currentSlideIndex]?.htmlContent),
        nextText: fullText(bibleStore.bibleSlides?.[bibleStore.currentSlideIndex + 1]?.htmlContent),
        slides: (bibleStore.bibleSlides || []).map((s: any) => ({
          reference: s.reference,
          preview: preview(s.htmlContent),
        })),
      },
      media: {
        name: statusStore.projectedFile?.name || '',
        isVideo: !!statusStore.projectedFile?.isVideo,
        isPlaying: playbackStore.isPlaying,
        isMuted: playbackStore.isMuted,
        currentTime: Math.round(playbackStore.currentTime || 0),
        duration: Math.round(playbackStore.duration || 0),
      },
      pdf: {
        isOpen: pdf.value.isOpen,
        isLoading: pdf.value.isLoading,
        fileName: pdf.value.fileName,
        page: pdf.value.page,
        total: pdf.value.total,
        key: pdfKey.value,
      },
      settings: {
        // Filtro Escurecedor de Fundo (0–100%), o mesmo das Configurações.
        bgOpacity: Number(configStore.settings.bgOpacity ?? 0),
      },
      program: {
        currentId: programStore.currentProgramId,
        list: programList.map((p) => ({
          _id: p._id,
          name: p.name,
          date: p.date,
          items: p.items.map((it) => ({
            id: it.id,
            type: it.type,
            title: it.title,
            subtitle: it.subtitle || '',
            tone: it.tone || '',
          })),
        })),
      },
    };
  });

  const publish = async (message: object) => {
    if (!isRunning.value) return;
    try {
      await invoke('publish_remote_message', { message });
    } catch (e) {
      console.error('[remote] Erro ao publicar:', e);
    }
  };

  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePublish = () => {
    if (!isRunning.value || publishTimer) return;
    publishTimer = setTimeout(() => {
      publishTimer = null;
      publish(remoteState.value);
    }, 150);
  };

  watch(remoteState, schedulePublish, { deep: true });

  // ─── Execução dos comandos ─────────────────────────────────────────────
  const projectMedia = async (media: any) => {
    await statusStore.setNewPresentation('Media', configStore.settings.selectedMonitor);
    await tauriEmit('project-media', media);
    statusStore.setProjectedMedia(media);
  };

  const presentProgramItem = async (item: ProgramItem, project: boolean) => {
    if (item.type === 'song') {
      if (!item.payload?._id) item.payload._id = item.payload?.id;
      await songCacheStore.getFilesFromSongs([item.payload]);
      await musicStore.setCustomSong(item.payload);
      if (item.presetId) presetStore.applyPreset(item.presetId);
      if (project) {
        await waitFor(() => songSlides.value.length > 0, 4000);
        await nextTick();
        slideController?.goto(0);
        slideController?.start();
      }
    } else if (item.type === 'media') {
      // No celular não há prévia: projeta direto.
      await projectMedia(item.payload);
    } else if (item.type === 'bible') {
      const r = item.payload?.ref || {};
      await tauriEmit('open-bible', {
        book: r.book,
        chapter: r.chapter,
        verseStart: r.verseStart,
        verseEnd: r.verseEnd,
        text: item.payload?.text?.trim() || undefined,
      });
      if (project) {
        const ready = await waitFor(
          () => bibleStore.step === 'view' && (bibleStore.bibleSlides?.length || 0) > 0
        );
        if (ready) await bibleStore.startProjection();
      }
    }
  };

  const selectSong = async (groupId: string, songId: string, project: boolean) => {
    if (musicStore.selectedGroupId !== groupId) {
      await musicStore.selectGroup(groupId);
      await waitFor(() => !musicStore.isLoading, 8000);
    }
    const song = musicStore.songs.find((s: any) => s.id === songId);
    if (!song) return;
    await musicStore.selectSong(song);
    if (project) {
      await waitFor(() => songSlides.value.length > 0, 4000);
      await nextTick();
      slideController?.goto(0);
      slideController?.start();
    }
  };

  const handleCommand = async (cmd: RemoteCommand) => {
    try {
      switch (cmd.action) {
        case 'sync':
          await publish(remoteState.value);
          break;

        // ── Slides da música ──
        case 'slide.next': slideController?.next(); break;
        case 'slide.prev': slideController?.prev(); break;
        case 'slide.goto': slideController?.goto(Number(cmd.index) || 0); break;
        case 'slide.start': slideController?.start(); break;
        case 'slide.stop': slideController?.stop(); break;

        // ── Bíblia ──
        case 'bible.next': bibleStore.nextSlide(); break;
        case 'bible.prev': bibleStore.prevSlide(); break;
        case 'bible.goto': {
          const index = Number(cmd.index) || 0;
          if (index >= 0 && index < (bibleStore.bibleSlides?.length || 0)) {
            bibleStore.currentSlideIndex = index;
            if (bibleStore.step === 'projecting') await bibleStore.projectCurrentSlide();
          }
          break;
        }
        case 'bible.start':
          if ((bibleStore.bibleSlides?.length || 0) > 0) await bibleStore.startProjection();
          break;
        case 'bible.stop':
          await bibleStore.stopProjection();
          await statusStore.clean();
          break;

        // ── PDF ──
        case 'pdf.next': pdfController?.next(); break;
        case 'pdf.prev': pdfController?.prev(); break;
        case 'pdf.goto': pdfController?.goto(Number(cmd.page) || 1); break;
        case 'pdf.start': pdfController?.start(); break;
        case 'pdf.stop': pdfController?.stop(); break;
        case 'settings.bgOpacity': {
          const value = Math.round(Number(cmd.value));
          if (Number.isFinite(value)) {
            configStore.settings.bgOpacity = Math.min(100, Math.max(0, value));
          }
          break;
        }

        case 'pdf.pages':
          if (pdf.value.total > 0 && !pdf.value.isLoading) {
            await publish({ type: 'pdfPages', key: pdfKey.value, pages: await getPdfThumbs() });
          }
          break;

        // ── Vídeo / mídia ──
        case 'media.play':
        case 'media.pause':
        case 'media.restart':
        case 'media.mute':
        case 'media.unmute': {
          const action = cmd.action.split('.')[1];
          if (action === 'mute' || action === 'unmute') playbackStore.isMuted = action === 'mute';
          await tauriEmit('media-control', {
            action,
            time: action === 'restart' ? 0 : playbackStore.currentTime || 0,
          });
          break;
        }

        // ── Tela de projeção ──
        case 'projection.clear':
          if (bibleStore.step === 'projecting') await bibleStore.stopProjection();
          await statusStore.clean();
          break;
        case 'projection.toggleWindow':
          await statusStore.toggleProjectionWindow();
          break;

        // ── Músicas ──
        case 'groups.list':
          await publish({
            type: 'groups',
            groups: musicStore.displayGroups.map((g: any) => ({
              id: g.id,
              label: g.label,
              count: g.songs?.length || 0,
              isLocal: !!g.isLocal,
            })),
          });
          break;
        case 'songs.list': {
          const group = musicStore.displayGroups.find((g: any) => g.id === cmd.groupId);
          await publish({
            type: 'songs',
            groupId: cmd.groupId,
            songs: (group?.songs || []).map((s: any) => ({
              id: s.id,
              fullName: s.fullName,
              tone: s.tone || '',
            })),
          });
          break;
        }
        // Mesma busca da pesquisa rápida do desktop (nome ou trecho da letra).
        case 'songs.search': {
          const mode = cmd.mode === 'lyric' ? 'lyric' : 'name';
          const query = String(cmd.query || '');
          const results = songCacheStore.getSearchResult(query, mode);
          let budget = 120; // limita o tamanho da resposta
          const groups = results.map((g) => {
            const songs = g.songs.slice(0, Math.max(0, budget));
            budget -= songs.length;
            return {
              id: g.id,
              label: g.label,
              isLocal: !!g.isLocal,
              songs: songs.map((s) => ({
                id: s.id,
                fullName: s.fullName,
                tone: s.tone || '',
                snippet: s.snippet || null,
              })),
            };
          }).filter((g) => g.songs.length > 0);
          await publish({
            type: 'searchResults',
            query,
            mode,
            total: results.reduce((acc, g) => acc + g.songs.length, 0),
            groups,
          });
          break;
        }
        case 'song.select':
          await selectSong(String(cmd.groupId), String(cmd.songId), !!cmd.project);
          break;

        // ── Programações ──
        case 'program.open':
          programStore.openProgram(String(cmd.programId));
          break;
        case 'program.present': {
          const program = programStore.programs.find((p) => p._id === cmd.programId);
          const item = program?.items.find((it) => it.id === cmd.itemId);
          if (program && item) {
            programStore.openProgram(program._id);
            await presentProgramItem(item, !!cmd.project);
          }
          break;
        }
      }
    } catch (e) {
      console.error('[remote] Erro ao executar comando', cmd.action, e);
      await publish({ type: 'error', message: 'Não foi possível executar o comando no computador.' });
    }
    schedulePublish();
  };

  // ─── Publicação na conta (pareamento automático pelo app) ─────────────
  // Com o controle ligado, o endereço e o token ficam registrados na conta do
  // usuário. O app Sigelo logado na mesma conta busca em /remoteDesktop/mine
  // e pareia sem QR code. O registro expira sozinho no back-end (TTL).
  const userStore = useUserStore();
  const HEARTBEAT_MS = 60_000;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let deviceName: string | null = null;
  let appVersion: string | null = null;

  const registerOnAccount = async () => {
    const current = info.value;
    if (!current?.isRunning || !current.url || !current.token || !userStore.userId) return;
    try {
      if (deviceName === null) {
        try { deviceName = (await hostname()) || ''; } catch { deviceName = ''; }
      }
      if (appVersion === null) {
        try { appVersion = await getVersion(); } catch { appVersion = ''; }
      }
      await api.apiFetch('remoteDesktop/register', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: getDeviceId(),
          deviceName: deviceName || 'Sigelo Desktop',
          urls: [current.url],
          token: current.token,
          appVersion,
        }),
      });
    } catch (e) {
      // Sem internet ou sessão expirada: o celular ainda pode parear pelo QR code.
      console.warn('[remote] Não foi possível publicar na conta:', e);
    }
  };

  const unregisterFromAccount = async () => {
    if (!userStore.userId) return;
    try {
      await api.apiFetch(`remoteDesktop/unregister/${encodeURIComponent(getDeviceId())}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('[remote] Não foi possível remover da conta:', e);
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    registerOnAccount();
    heartbeat = setInterval(async () => {
      // Atualiza o endereço (o IP pode mudar se a rede mudar).
      try {
        const current = await invoke<RemoteInfo>('get_remote_info');
        if (current.isRunning) info.value = current;
      } catch { /* mantém o anterior */ }
      registerOnAccount();
    }, HEARTBEAT_MS);
  };

  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  // Login/logout com o controle ligado.
  watch(() => userStore.userId, (id, old) => {
    if (id && id !== old && isRunning.value) registerOnAccount();
  });

  // ─── PDF enviado pelo celular ──────────────────────────────────────────
  // O servidor guarda o arquivo e avisa; aqui buscamos os bytes e abrimos
  // no apresentador de PDF, já projetando a primeira página.
  const handlePdfReceived = async (name: string) => {
    try {
      const buffer = await invoke<ArrayBuffer>('take_remote_pdf');
      if (!pdfController) throw new Error('Apresentador de PDF indisponível');
      const ok = await pdfController.openData(new Uint8Array(buffer), name, true);
      if (!ok) await publish({ type: 'error', message: 'Não foi possível abrir este PDF no computador.' });
    } catch (e) {
      console.error('[remote] Erro ao abrir PDF do celular:', e);
      await publish({ type: 'error', message: 'Não foi possível abrir este PDF no computador.' });
    }
    schedulePublish();
  };

  // ─── Ciclo de vida ─────────────────────────────────────────────────────
  let unlisteners: UnlistenFn[] = [];
  let initialized = false;

  const init = async () => {
    if (initialized) return;
    initialized = true;

    unlisteners.push(
      await listen<RemoteCommand>('remote-command', (event) => handleCommand(event.payload)),
      await listen<{ name: string; size: number }>('remote-pdf-received', (event) =>
        handlePdfReceived(event.payload?.name || 'PDF do celular.pdf')),
      await listen<number>('remote-clients-changed', (event) => {
        connectedClients.value = event.payload;
        if (info.value) info.value.connectedClients = event.payload;
      }),
    );

    try {
      const current = await invoke<RemoteInfo>('get_remote_info');
      if (current.isRunning) {
        info.value = current;
        connectedClients.value = current.connectedClients;
        startHeartbeat();
      } else if (loadPrefs().enabled) {
        await start();
      }
    } catch (e) {
      console.error('[remote] Erro ao consultar servidor:', e);
    }
  };

  const start = async () => {
    if (isStarting.value) return;
    isStarting.value = true;
    error.value = null;
    try {
      if (!programStore.isLoaded) await programStore.loadPrograms();
      const prefs = loadPrefs();
      const result = await invoke<RemoteInfo>('start_remote_server', {
        port: null,
        token: prefs.token ?? null,
        pin: prefs.pin ?? null,
      });
      info.value = result;
      connectedClients.value = result.connectedClients;
      savePrefs({ enabled: true, token: result.token, pin: result.pin });
      await publish(remoteState.value);
      startHeartbeat();
    } catch (e: any) {
      error.value = typeof e === 'string' ? e : e?.message || 'Não foi possível ligar o controle remoto.';
    } finally {
      isStarting.value = false;
    }
  };

  const stop = async () => {
    stopHeartbeat();
    unregisterFromAccount();
    try {
      await invoke('stop_remote_server');
    } catch (e) {
      console.error('[remote] Erro ao desligar:', e);
    }
    info.value = null;
    connectedClients.value = 0;
    savePrefs({ ...loadPrefs(), enabled: false });
  };

  /** Novo QR/código: desconecta todos os celulares pareados. */
  const regeneratePairing = async () => {
    try {
      const result = await invoke<RemoteInfo>('regenerate_remote_pairing');
      info.value = result;
      connectedClients.value = 0;
      savePrefs({ enabled: true, token: result.token, pin: result.pin });
      registerOnAccount();
    } catch (e: any) {
      error.value = typeof e === 'string' ? e : 'Não foi possível gerar um novo código.';
    }
  };

  const dispose = () => {
    stopHeartbeat();
    unlisteners.forEach((u) => u());
    unlisteners = [];
    initialized = false;
  };

  return {
    info,
    isRunning,
    isStarting,
    error,
    connectedClients,
    init,
    start,
    stop,
    regeneratePairing,
    dispose,
    registerSlideController,
    setSongSlides,
    registerPdfController,
    setPdfState,
  };
});
