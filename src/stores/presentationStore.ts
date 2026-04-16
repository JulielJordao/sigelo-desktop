import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import routes from '../routes/index';
import { getLinkFiles } from '../utils/convertData';
import type { Song } from '../types/song';
import type { SongFile } from '../types/songFile';
import { useSongCacheStore } from './songCacheStore';
import type { SongCache } from './songCacheStore';
import { useConnectionStore } from './statusConnectionStore';

export interface Slide {
  label: string;
  text: string;
}

export interface SongGroup {
  _id: string; // ID gerado pelo MongoDB
  name: string;

  // Lista de IDs de grupos ou usuários que têm acesso
  vinculatedTo?: string[];

  groupUserId: string;
  isGlobal: boolean;

  // Dados de propriedade
  hasOwner: boolean;
  owner?: string;
  ownerName?: string;

  // Filtros aplicados a este grupo (ex: ['Cifra', 'Letra'])
  filterTypes?: string[];

  createdBy: string;

  // Datas - No JSON vindo da API elas chegam como string (ISO), 
  // mas no JS podemos tratá-las como Date ou string.
  createdAt: Date | string;
  songsUpdatedAt: Date | string;
}

export const useMusicPresentationStore = defineStore('musicPresentation', () => {
  // --- ESTADOS ---
  const connectionStore = useConnectionStore()
  const songCacheStore = useSongCacheStore()
  const showSidebarLists = ref(true);
  const isLoading = ref(false);
  const selectedGroupId = ref<string>("68f8be456569689b456edd83");
  const selectedSongId = ref<string>("");
  const listSlides = ref<Slide[]>([])

  const rawGroups = ref<any[]>([]);
  const songs = ref<SongCache[]>([]);
  const rawLyric = ref<string>(""); // Substitui a chamada da ref updateLyric
  const customSong = ref<SongCache | null>(null);

  // --- COMPUTED ---
  const filteredSongs = computed(() => songs.value);
  const activeSong = computed(() => {
    if (customSong.value) {
      return customSong.value;
    }
    return songs.value.find(s => s.id === selectedSongId.value) || null;
  });

  const currentSlide = ref<Slide>({ label: '', text: '' });

  const setCurrentSlide = (slide: Slide) => {
    if (!slide || !slide.label) { return }
    currentSlide.value = slide;
  }

  const getCurrentSlideType = computed(() => {
    const label = getSlideTypeByLabel(currentSlide.value.label.toLowerCase());

    return label
  })

  const getSlideTypeByLabel = (label: string) => {
    if (!label) return "geral"
    const lowerCaseLabel = label.toLowerCase()
    if (lowerCaseLabel.includes('refrão')) {
      return 'refrao';
    } else if (lowerCaseLabel.includes('verso')) {
      return 'verso';
    } else if (lowerCaseLabel.includes('título') || lowerCaseLabel.includes('titulo')) {
      return 'titulo';
    } else if (lowerCaseLabel.includes('geral')) {
      return 'geral';
    } else {
      return 'geral';
    }
  }

  // --- AÇÕES ---
  const toggleSidebar = () => {
    showSidebarLists.value = !showSidebarLists.value;
  };

  const fetchGroups = async () => {
    // 1. OFFLINE-FIRST: Preenche a interface imediatamente usando o cache
    if (songCacheStore.listSongGroups.length > 0) {
      // Mapeamos para manter a mesma estrutura de variável que a API entrega (_id e name)
      rawGroups.value = songCacheStore.listSongGroups.map(it => ({
        _id: it.id,
        name: it.label
      }));
    }

    // 2. Se não tem internet confirmada, paramos por aqui (a UI já tem o cache)
    // OBS: Use a variável correta da sua connectionStore (hasInternet ou isNetworkConnected)
    if (!connectionStore.isNetworkConnected) return;

    // 3. Sincronização em Background: Tenta atualizar com a API
    try {
      const response = await routes.songGroup().get();

      if (Array.isArray(response?.response)) {
        // Atualiza a tela com os dados fresquinhos do servidor
        rawGroups.value = response.response;

        // Sincroniza o Cache silenciosamente
        response.response.forEach((it: any) => { // Ajuste o 'any' para 'SongGroup'
          const groupInCache = songCacheStore.listSongGroups.find(g => g.id === it._id);
          if (!groupInCache) {
            songCacheStore.listSongGroups.push({ id: it._id, label: it.name, songs: [] });
          } else {
            groupInCache.label = it.name;
          }
        });
        // NOTA: Se o songCacheStore precisar de um .save() no Tauri, chame-o aqui.
      }
    } catch (error) {
      console.warn("API de grupos falhou (Offline ou erro de rede). Usando apenas cache.");
    }
  };

  const selectGroup = async (id: string) => {
    if (!isLoading.value) {
      isLoading.value = true;
      selectedGroupId.value = id;
      rawLyric.value = '';
      await fetchSongs();

      isLoading.value = false;
    }
  };

  const fetchSongs = async () => {
    if (!selectedGroupId.value) return;

    const groupIndex = songCacheStore.listSongGroups.findIndex(it => selectedGroupId.value === it.id);
    if (groupIndex === -1) return;

    const groupCache = songCacheStore.listSongGroups[groupIndex];

    // Função local para atualizar a reatividade da tela de forma limpa
    const updateUI = (listSongs: any[]) => {
      songs.value = listSongs.map((it) => ({
        id: it.id,
        songGroupId: it.songGroupId,
        fullName: it.fullName,
        lyric: it.lyric
      }));
    };

    // 1. OFFLINE-FIRST: Carrega as músicas do cache instantaneamente
    const hasCache = groupCache.songs && groupCache.songs.length > 0;
    if (hasCache) {
      updateUI(groupCache.songs);
    }

    // 2. Validação de internet
    if (!connectionStore.isNetworkConnected) return;

    // 3. Atualização em background via API
    try {
      // Se já temos cache, passamos a data para a API não devolver tudo atoa
      const lastUpdate = hasCache ? songCacheStore.listLastDataUpdated[selectedGroupId.value] : undefined;
      const response = await routes.song().list(selectedGroupId.value, lastUpdate);

      // Se a API diz que atualizou OU se não tínhamos nada no cache
      if (response && Array.isArray(response.songs) && (!response.isUpdated || !hasCache)) {
        const list = response.songs; // Ajuste para list = response.songs as Song[] se necessário

        const sortedSongs = [...list].sort((a, b) => {
          return a.fullName.localeCompare(b.fullName, 'pt-BR', { sensitivity: 'base' });
        });

        const groupName = rawGroups.value.find(it => it._id === selectedGroupId.value)?.name ?? '';

        // Atualiza os metadados no cache
        songCacheStore.changeCacheInfo({
          id: selectedGroupId.value,
          label: groupName,
          songs: sortedSongs.map(it => ({
            songGroupId: selectedGroupId.value,
            id: it._id,
            fullName: it.fullName,
            lyric: "" // O getCacheLyrics preencherá isso
          }))
        });

        // Baixa as letras atualizadas
        await songCacheStore.getCacheLyrics(selectedGroupId.value);
        songCacheStore.setLastUpdate(selectedGroupId.value, response.songsUpdatedAt);

        // Agora que o cache está 100% atualizado com a API, atualizamos a tela
        updateUI(songCacheStore.listSongGroups[groupIndex].songs);
      }
    } catch (error) {
      console.warn("Falha ao sincronizar músicas com a API. Mantendo cache.");
    }
  };

  const selectSong = async (song: SongCache) => {
    customSong.value = null
    selectedSongId.value = song.id;
    if (song.lyric === "" || !song.lyric) {
      await fetchLyric();
    } else {
      songCacheStore.selectedSong = song;
      rawLyric.value = song.lyric === "" ? "" : song.lyric;
    }
  };

  const setCustomSong = async (song: Song) => {

    if (Array.isArray(song.files)) {
      const list: SongFile[] = song.files;
      const lyricFile = list.find(it => it.type == "Letra");

      if (lyricFile?._id) {
        const url = getLinkFiles(lyricFile.fileName);
        const fetchedLyric = await routes.proxy(url);
        rawLyric.value = fetchedLyric.content;
        customSong.value = {
          songGroupId: song.songGroupId,
          id: song._id,
          fullName: song.fullName,
          lyric: fetchedLyric.content
        };

        songCacheStore.selectedSong.lyric = rawLyric.value
      } else {
        customSong.value = {
          songGroupId: song.songGroupId,
          id: song._id,
          fullName: song.fullName,
          lyric: ''
        };
        rawLyric.value = "";
      }
    } else {
      rawLyric.value = "";
    }
  }

  const fetchLyric = async () => {
    if (!selectedSongId.value || !selectedGroupId.value) {
      rawLyric.value = "";
      return;
    }

    // 1. OFFLINE-FIRST: Verifica se a letra já existe no cache e devolve na hora
    const groupCache = songCacheStore.listSongGroups.find(g => g.id === selectedGroupId.value);
    const songInCache = groupCache?.songs.find(s => s.id === selectedSongId.value);

    if (songInCache && songInCache.lyric && songInCache.lyric.trim() !== "") {
      rawLyric.value = songInCache.lyric;
      return; // Retorna cedo. Letra em cache não precisa bater na API novamente!
    }

    // 2. Se não tem no cache e não tem internet, avisa o usuário
    if (!connectionStore.isNetworkConnected) {
      rawLyric.value = "";
      return;
    }

    // 3. Fallback: Se por acaso a letra sumiu do cache, tenta baixar via API
    try {
      const songId = [selectedSongId.value];
      const filesResponse = await routes.files().getListBySongId(songId);

      if (Array.isArray(filesResponse?.response)) {
        const lyricFile = filesResponse.response.find((it: any) => it.type === "Letra");

        if (lyricFile?._id) {
          const url = getLinkFiles(lyricFile.fileName);
          const fetchedLyric = await routes.proxy(url);
          rawLyric.value = fetchedLyric.content;

          // Salva a letra recém-baixada no cache para a próxima vez!
          if (songInCache) {
            songInCache.lyric = fetchedLyric.content;
          }
        } else {
          rawLyric.value = "";
        }
      }
    } catch (error) {
      console.error("Erro ao baixar letra da API:", error);
      rawLyric.value = "Falha ao carregar a letra.";
    }
  };

  return {
    // Estados
    listSlides, showSidebarLists, isLoading, selectedGroupId, selectedSongId, rawGroups, songs, rawLyric,
    // Getters
    filteredSongs, activeSong, setCustomSong, setCurrentSlide, currentSlide, getCurrentSlideType,
    // Ações
    getSlideTypeByLabel, toggleSidebar, fetchGroups, selectGroup, fetchSongs, selectSong, fetchLyric
  };
});