import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { load } from '@tauri-apps/plugin-store';
import type { Store } from '@tauri-apps/plugin-store';

export interface SongGroupCache {
    id: string,
    label: string
    songs: SongCache[]
}

export interface SongCache {
    id: string,
    fullName: string
}

export const useSongCacheStore = defineStore('songCache', () => {

    let tauriStore: Store | null = null;
    const listSongGroups = ref<SongGroupCache[]>([])
    const isLoaded = ref(false)
    const selectedSong = ref({songGroupId: '', songId: ''})

    const setSelectedSong = (songGroupId: string, songId: string) =>{
        selectedSong.value = {songGroupId, songId}
    }

    const getSearchResult = (search: string) => {
        const result : SongGroupCache[] = []
        listSongGroups.value.forEach(element => {
           const filter = element.songs.filter(it => it.fullName.toLowerCase().includes(search.toLowerCase()))

           if(filter.length > 0 ) { 
                result.push({label: element.label, id: element.id, songs: filter})
           }
        });

        return result
    }

    const loadData = async () => {
        try {
            
            // Inicia a store do Tauri v2
            tauriStore = await load('cacheSongs.json', { autoSave: false , defaults: { listSongGroups: []}});
            const savedConfig = await tauriStore.get< SongGroupCache[]>('listSongGroups');
            console.log(savedConfig)
            if (savedConfig) {
                listSongGroups.value = [...savedConfig]
            }
        } catch(error) {
            console.log("ocorreu um erro ao obter o cacheSongs")
        } finally {
            isLoaded.value = true
        }
    }

    const changeCacheInfo = async (songGroups : SongGroupCache) => {
        
        const index = listSongGroups.value.findIndex(it => it.id === songGroups.id)

        if(index != -1) {
            listSongGroups.value[index].label = songGroups.label
            listSongGroups.value[index].songs = songGroups.songs
        } else {
            listSongGroups.value.push(songGroups)
        }
    }

    watch(
        listSongGroups, 
        async (newValue) => {
        
          if (!isLoaded.value || !tauriStore) return; 
            
          const pureData = JSON.parse(JSON.stringify(newValue));
          await tauriStore.set('listSongGroups', pureData);
          await tauriStore.save(); 
          
        }, 
        { deep: true }
      );

      return {
        listSongGroups,
        selectedSong,
        isLoaded,
        setSelectedSong,
        loadData,
        changeCacheInfo,
        getSearchResult
      }
})
