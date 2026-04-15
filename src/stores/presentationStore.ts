import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import routes from '../routes/index';
import { getLinkFiles } from '../utils/convertData';
import type { Song } from '../types/song';
import type { SongFile } from '../types/songFile';
import { useSongCacheStore } from './songCacheStore';
import type { SongCache } from './songCacheStore';

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
    const response = await routes.songGroup().get();
    rawGroups.value = [];
    if (Array.isArray(response?.response)) {
      rawGroups.value = response.response;

      if (songCacheStore.listSongGroups.length === 0) {
        response.response.forEach((it: SongGroup) => {
          songCacheStore.listSongGroups.push({ id: it._id, label: it.name, songs: [] })
        })
      }
      else {
        response.response.forEach((it: SongGroup) => {
          const indexOf = songCacheStore.listSongGroups.findIndex(group => group.id === it._id)
          if (indexOf == -1) {
            songCacheStore.listSongGroups.push({ id: it._id, label: it.name, songs: [] })
          } else {
            songCacheStore.listSongGroups[indexOf].label = it.name
          }
        })
      }
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
    let isListLoaded = false
    const indexOf = songCacheStore.listSongGroups.findIndex(it => selectedGroupId.value === it.id)

    const loadSongs = async (listSongs: SongCache[]) => {
      if (!isListLoaded) {
        songs.value = listSongs.map((it) => {
          return {
            id: it.id,
            songGroupId: it.songGroupId,
            fullName: it.fullName,
            lyric: it.lyric
          }
        })
        isListLoaded = true
      }
    }

    let isCacheEmpty = false

    if (songCacheStore.listSongGroups[indexOf].songs.length > 0) {
      loadSongs(songCacheStore.listSongGroups[indexOf].songs)
    } else {
      // caso o usuário limpe o arquivo de cache do sistema
      isCacheEmpty = true
    }

    const response = await routes.song().list(selectedGroupId.value, isCacheEmpty ? undefined : songCacheStore.listLastDataUpdated[selectedGroupId.value]);

    if (Array.isArray(response?.songs) && (!response?.isUpdated || songCacheStore.listSongGroups[indexOf].songs.length === 0)) {
      console.log("hasToReload")
      const list = response.songs as Song[];

      const sortedSongs = [...list].sort((a, b) => {
        return a.fullName.localeCompare(b.fullName, 'pt-BR', { sensitivity: 'base' });
      });

      console.log(list)

      const fullName = rawGroups.value.find(it => it._id == selectedGroupId.value)?.name ?? ''
      songCacheStore.changeCacheInfo({
        id: selectedGroupId.value, label: fullName, songs: sortedSongs.map(it => {
          return {
            songGroupId: selectedGroupId.value,
            id: it._id,
            fullName: it.fullName,
            lyric: ""
          }
        })
      })

      await songCacheStore.getCacheLyrics(selectedGroupId.value)

      await loadSongs(songCacheStore.listSongGroups[indexOf].songs)

      songCacheStore.setLastUpdate(selectedGroupId.value, response.songsUpdatedAt)

    } else {
       console.log("notReload")
      // songCacheStore.setLastUpdate(selectedGroupId.value, response.songsUpdatedAt)
      loadSongs(songCacheStore.listSongGroups[indexOf].songs)
    }
    

  };

  const selectSong = async (song: SongCache) => {
    customSong.value = null
    selectedSongId.value = song.id;
    if (song.lyric === "" || !song.lyric) {
      await fetchLyric();
    } else {
      songCacheStore.selectedSong = song;
      rawLyric.value = song.lyric === "" ? " " : song.lyric;
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
    const songId = [selectedSongId.value];
    const filesResponse = await routes.files().getListBySongId(songId);

    if (Array.isArray(filesResponse?.response)) {
      const list: SongFile[] = filesResponse.response;
      const lyricFile = list.find(it => it.type == "Letra");

      if (lyricFile?._id) {
        const url = getLinkFiles(lyricFile.fileName);
        const fetchedLyric = await routes.proxy(url);
        rawLyric.value = fetchedLyric.content;
      } else {
        rawLyric.value = "";
      }
    } else {
      rawLyric.value = "";
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