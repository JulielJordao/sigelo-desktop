import { defineStore } from 'pinia';
import { ref, watch, toRaw } from 'vue';
import { load } from '@tauri-apps/plugin-store';
import type { Store } from '@tauri-apps/plugin-store';
import { api } from '../routes/index';
import CryptoJS from 'crypto-js'; // Importando a lib de criptografia

export interface SongGroupCache {
    id: string,
    label: string
    songs: SongCache[]
}

export interface SongCache {
    songGroupId: string,
    id: string,
    fullName: string,
    lyric: string
}

export const useSongCacheStore = defineStore('songCache', () => {

    let tauriStore: Store | null = null;
    const listSongGroups = ref<SongGroupCache[]>([]);
    const isLoaded = ref(false);
    const selectedSong = ref<SongCache>({songGroupId: '', id: '', fullName: '', lyric: ''});
    
    // Pega a chave do ambiente
    const ENCRYPTION_KEY = import.meta.env.VITE_SIGELO_DECRYPT_KEY || "fallback-key-para-dev";

    const setSelectedSong = (songGroupId: string, songId: string, fullName: string) =>{
        selectedSong.value = {songGroupId, id: songId, lyric: '', fullName};
    }

    const getSearchResult = (search: string) => {
        const result : SongGroupCache[] = [];
        listSongGroups.value.forEach(element => {
           const filter = element.songs.filter(it => it.fullName.toLowerCase().includes(search.toLowerCase()));

           if(filter.length > 0 ) { 
                result.push({label: element.label, id: element.id, songs: filter});
           }
        });
        return result;
    }

    const loadData = async () => {
        try {
            if (!import.meta.env.VITE_SIGELO_DECRYPT_KEY) {
                console.warn("Chave de criptografia não encontrada. Usando chave de fallback.");
            }

            // O store agora só cuida do arquivo em si, sem opção de password
            tauriStore = await load('cacheSongs.bin', { autoSave: false, defaults: {} });
            
            // Tentamos resgatar a string criptografada (salvamos com a chave 'secureData')
            const encryptedString = await tauriStore.get<string>('secureData');
            
            if (encryptedString) {
                // Descriptografa a string
                const bytes = CryptoJS.AES.decrypt(encryptedString, ENCRYPTION_KEY);
                const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
                
                // Se descriptografou com sucesso, converte de volta para o Array
                if (decryptedStr) {
                    listSongGroups.value = JSON.parse(decryptedStr);
                }
            }
        } catch(error) {
            console.error("Erro ao carregar ou descriptografar o cache:", error);
            // Em caso de erro (ex: chave mudou e falhou o decrypt), a lista continua vazia []
        } finally {
            isLoaded.value = true;
        }
    }

    const changeCacheInfo = async (songGroups : SongGroupCache) => {
        const index = listSongGroups.value.findIndex(it => it.id === songGroups.id);

        if(index != -1) {
            listSongGroups.value[index].label = songGroups.label;
            listSongGroups.value[index].songs = songGroups.songs;
        } else {
            listSongGroups.value.push(songGroups);
        }
    }

    const getCacheLyrics = async (songGroupId: string) => {
        try {
            const lyrics = await api.songGroup().getOfflineLyrics(songGroupId) as Record<string, string>;
            const songGroupCache = listSongGroups.value.find(it => it.id === songGroupId);

            if(songGroupCache?.songs) {
                songGroupCache.songs.forEach(it => {
                    if(lyrics[it.id]) {
                        it.lyric = lyrics[it.id];
                        it.songGroupId = songGroupId;
                    }
                });
            }
        } catch (error) {
            console.error("Erro ao sincronizar letras:", error);
        }
    }

    watch(
        listSongGroups, 
        async (newValue) => {
          if (!isLoaded.value || !tauriStore) return; 
            
          try {
              // 1. Pega os dados puros sem a reatividade do Vue
              const pureData = Array.from(toRaw(newValue));
              
              // 2. Transforma em JSON string
              const jsonString = JSON.stringify(pureData);
              
              // 3. Criptografa a string com AES
              const encryptedString = CryptoJS.AES.encrypt(jsonString, ENCRYPTION_KEY).toString();
              
              // 4. Salva apenas a string criptografada no Tauri Store
              await tauriStore.set('secureData', encryptedString);
              await tauriStore.save(); 
              
          } catch (error) {
              console.error("Erro ao criptografar e salvar o cache:", error);
          }
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
        getCacheLyrics,
        getSearchResult
      }
});