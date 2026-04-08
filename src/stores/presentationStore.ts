import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import routes from '../routes/index';
import { getLinkFiles } from '../utils/convertData';
import type { Song } from '../types/song';
import type { SongFile } from '../types/songFile';

export interface Slide {
  label: string;
  text: string;
}

export const useMusicPresentationStore = defineStore('musicPresentation', () => {
  // --- ESTADOS ---
  const showSidebarLists = ref(true);
  const isLoading = ref(false);
  const selectedGroupId = ref<string>("68f8be456569689b456edd83");
  const selectedSongId = ref<string>("");
  
  const rawGroups = ref<any[]>([]);
  const songs = ref<Song[]>([]);
  const rawLyric = ref<string>(""); // Substitui a chamada da ref updateLyric
  const customSong = ref<Song | null>(null); 

  // --- COMPUTED ---
  const filteredSongs = computed(() => songs.value);
  const activeSong = computed(() => {
    if (customSong.value) {
      return customSong.value;
    }
    return songs.value.find(s => s._id === selectedSongId.value) || null;
  });

  const currentSlide = ref<Slide>({ label: '', text: '' });

  const setCurrentSlide = (slide: Slide ) => {
    if (!slide || !slide.label) { return }
    currentSlide.value = slide;
  }

  const getCurrentSlideType = computed(() => {
    const label = currentSlide.value.label.toLowerCase();
    if (label.includes('refrão')) {
        return 'refrao';
    } else if (label.includes('verso')) {
        return 'verso';
    } else if (label.includes('título') || label.includes('titulo')) {
        return 'titulo';
    } else if (label.includes('geral')) {
        return 'geral';
    } else {
        return 'geral';
    }
  }) 

  // --- AÇÕES ---
  const toggleSidebar = () => {
    showSidebarLists.value = !showSidebarLists.value;
  };

  const fetchGroups = async () => {
    const response = await routes.songGroup().get();
    rawGroups.value = [];
    if (Array.isArray(response?.response)) {
      rawGroups.value = response.response;
    }
  };

  const selectGroup = async (id: string) => {
    if (!isLoading.value) { // Corrigido o bug da condicional
      isLoading.value = true;
      selectedGroupId.value = id;
      selectedSongId.value = ''; 
      rawLyric.value = '';
      await fetchSongs();
      isLoading.value = false;
    }
  };

  const fetchSongs = async () => {
    const response = await routes.song().list(selectedGroupId.value);
    
    if (Array.isArray(response?.search)) {
      const list = response.search as Song[];
      
      const sortedSongs = [...list].sort((a, b) => {
        return a.fullName.localeCompare(b.fullName, 'pt-BR', { sensitivity: 'base' });
      });

      songs.value = sortedSongs
    }
  };

  const selectSong = async (id: string) => {
    customSong.value = null
    selectedSongId.value = id;
    await fetchLyric();
    console.log("Música selecionada:", activeSong.value);
  };

  const setCustomSong = async(song: Song) => {
    customSong.value = song;
    if (Array.isArray(song.files)) {
      const list: SongFile[] = song.files;
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
    showSidebarLists, isLoading, selectedGroupId, selectedSongId, rawGroups, songs, rawLyric,
    // Getters
    filteredSongs, activeSong, setCustomSong, setCurrentSlide, currentSlide, getCurrentSlideType,
    // Ações
    toggleSidebar, fetchGroups, selectGroup, fetchSongs, selectSong, fetchLyric
  };
});