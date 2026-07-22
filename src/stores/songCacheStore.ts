import { defineStore } from 'pinia';
import { ref, watch, toRaw } from 'vue';
import { load } from '@tauri-apps/plugin-store';
import type { Store } from '@tauri-apps/plugin-store';
import { api } from '../routes/index';
import CryptoJS from 'crypto-js'; // Importando a lib de criptografia
import type { SongFile } from '../types/songFile';
import type { BibleRef } from "../types/bibleRef";
import { useConnectionStore } from './statusConnectionStore';
import type { Song } from '../types/song';
import { useLocalGroupStore } from './localGroupStore';

export interface SongGroupCache {
    id: string,
    label: string
    songs: SongCache[],
    songsUpdatedAt?: Date
}

export interface SongCache {
    songGroupId: string,
    id: string,
    fullName: string,
    lyric: string,
    files?: SongFile[]
    writerBy?: string;
    melodyBy?: string;
    versionBy?: string;
    tone?: string;
    youtubeLink?: string;
    audioLink?: string[];
    bibleRefs?: BibleRef[];
    tags?: string[];
}

export type LastUpdateMap = Record<string, Date | string>;

export type SearchMode = 'name' | 'lyric';

export interface SongSearchMatch extends SongCache {
    /** Só no modo letra: trecho ao redor do termo, já fatiado para destaque */
    snippet?: { before: string; match: string; after: string };
}

export interface SearchResultGroup {
    id: string;
    label: string;
    isLocal: boolean;
    songs: SongSearchMatch[];
}

export const useSongCacheStore = defineStore('songCache', () => {

    const connectionStore = useConnectionStore()

    let tauriStore: Store | null = null;
    let tauriStoreConfig: Store | null;
    const listSongGroups = ref<SongGroupCache[]>([]);
    const isLoaded = ref(false);
    const selectedSong = ref<SongCache>({
        songGroupId: '',
        id: '',
        fullName: '',
        lyric: '',
        writerBy: undefined,
        melodyBy: undefined
    });
    const listLastDataUpdated = ref<LastUpdateMap>({});

    // Pega a chave do ambiente
    const ENCRYPTION_KEY = import.meta.env.VITE_SIGELO_DECRYPT_KEY || "fallback-key-para-dev";

    const setSelectedSong = (songCache: SongCache) => {
        selectedSong.value = songCache
    }

    const loadData = async () => {
        try {
            if (!import.meta.env.VITE_SIGELO_DECRYPT_KEY) {
                console.warn("Chave de criptografia não encontrada. Usando chave de fallback.");
            }

            let cacheSongsIsClean = false

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
                    console.log("list", listSongGroups.value)
                }
            } else {
                cacheSongsIsClean = false
            }

            tauriStoreConfig = await load('updateGroupSong.json', { autoSave: false, defaults: { data: [] } });

            const savedData = await tauriStoreConfig.get<LastUpdateMap>('data');

            if (savedData) {
                // Opcional: Converter strings ISO de volta para objetos Date
                const parsedMap: LastUpdateMap = {};
                for (const [groupId, dateVal] of Object.entries(savedData)) {
                    parsedMap[groupId] = dateVal ? new Date(dateVal) : '';
                }
                listLastDataUpdated.value = parsedMap;

                if (cacheSongsIsClean) listLastDataUpdated.value = {}
            }

        } catch (error) {
            console.error("Erro ao carregar ou descriptografar o cache:", error);
            // Em caso de erro (ex: chave mudou e falhou o decrypt), a lista continua vazia []
        } finally {
            isLoaded.value = true;
        }
    }

    const syncSongGroups = async (serverGroups: SongGroupCache[]) => {
        const serverIds = new Set(serverGroups.map(g => g.id));

        // 1. Remove grupos que não vieram na listagem atual
        listSongGroups.value = listSongGroups.value.filter(g => serverIds.has(g.id));

        // 2. Upsert dos grupos da conta atual
        serverGroups.forEach(group => {
            const index = listSongGroups.value.findIndex(it => it.id === group.id);
            if (index !== -1) {
                listSongGroups.value[index].label = group.label;
                if (group.songs?.length) {
                    listSongGroups.value[index].songs = group.songs;
                }
            } else {
                listSongGroups.value.push(group);
            }
        });

        // 3. Limpa o mapa de última atualização dos grupos removidos
        Object.keys(listLastDataUpdated.value).forEach(id => {
            if (!serverIds.has(id)) delete listLastDataUpdated.value[id];
        });

        // 4. Persiste o cache reconciliado
        await saveInfo(listSongGroups.value);
    };
    
    const changeCacheInfo = async (songGroups: SongGroupCache) => {
        const index = listSongGroups.value.findIndex(it => it.id === songGroups.id);

        if (index != -1) {
            listSongGroups.value[index].label = songGroups.label;
            listSongGroups.value[index].songs = songGroups.songs;
        } else {
            listSongGroups.value.push(songGroups);
        }
    }

    const getCacheLyrics = async (songGroupId: string) => {
        try {
            const lyrics = await api.songGroup().getOfflineLyrics(songGroupId) as Record<string, string>;


            if (!lyrics) {
                console.warn("Nenhuma letra retornada da API.");
                return;
            }

            const indexOf = listSongGroups.value.findIndex(it => it.id === songGroupId);

            if (indexOf != -1 && listSongGroups.value[indexOf].songs) {
                listSongGroups.value[indexOf].songs.forEach(it => {
                    if (lyrics[it.id]) {
                        it.lyric = lyrics[it.id];
                        it.songGroupId = songGroupId;
                    }
                });


                await saveInfo(listSongGroups.value)
            }

        } catch (error) {
            console.error("Erro ao sincronizar letras:", error);
        }
    }

    const saveInfo = async (newValue: Array<SongGroupCache>) => {
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

            listSongGroups.value.forEach(it => {
                setLastUpdate(it.id, it.songsUpdatedAt ?? new Date())
            })

        } catch (error) {
            console.error("Erro ao criptografar e salvar o cache:", error);
        }
    }

    const setLastUpdate = (songGroupId: string, newDate: string | Date) => {
        listLastDataUpdated.value[songGroupId] = newDate;
    }

    watch(
        listLastDataUpdated,
        async (newValue) => {
            if (!isLoaded.value || !tauriStoreConfig) return;

            // toRaw funciona perfeitamente com objetos simples
            await tauriStoreConfig.set('data', toRaw(newValue));
            await tauriStoreConfig.save();
        },
        { deep: true }
    );

    const getFilesFromSongs = async (songs: Song[]) => {

        if (!Array.isArray(songs) || songs.length === 0) return songs;

        // ONLINE: busca os arquivos reais pela API
        if (connectionStore.isNetworkConnected) {
            try {
                const listId = songs.map(s => s._id);
                console.log(listId)
                const response = await api.files().getListBySongId(listId);

                if (response?.response) {
                    const files = response.response as SongFile[];
                    songs.forEach(song => {
                        song.files = files.filter((f: any) => f.songIdObj === song._id);
                    });
                }
            } catch (error) {
                console.error("Erro ao carregar arquivos (online):", error);
            }
            return songs;
        }

        // OFFLINE: puxa os files do próprio cache
        songs.forEach(song => {
            for (const group of listSongGroups.value) {
                const cached = group.songs.find(s => s.id === song._id);
                if (cached?.files) {
                    song.files = cached.files;
                    break;
                }
            }
        });

        return songs;
    };

    // Normaliza acento/caixa MANTENDO o alinhamento de índices com a string
    // original — necessário para recortar o snippet no lugar certo.
    const normalize = (value: string) => {
        let out = '';
        for (let i = 0; i < value.length; i++) {
            const ch = value[i];
            const n = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            out += n.length === 1 ? n : ch; // fallback preserva o 1-para-1
        }
        return out;
    };

    const SNIPPET_WINDOW = 80;

    const buildSnippet = (lyric: string, q: string) => {
        if (!lyric) return null;

        const idx = normalize(lyric).indexOf(q);
        if (idx === -1) return null;

        const half = Math.floor(SNIPPET_WINDOW / 2);
        const start = Math.max(0, idx - half);
        const end = Math.min(lyric.length, idx + q.length + half);

        // Quebras de linha viram espaço para o trecho caber em uma linha
        const flat = (s: string) => s.replace(/\s+/g, ' ');

        return {
            before: (start > 0 ? '…' : '') + flat(lyric.substring(start, idx)).replace(/^ /, ''),
            match: lyric.substring(idx, idx + q.length),
            after: flat(lyric.substring(idx + q.length, end)).replace(/ $/, '') + (end < lyric.length ? '…' : ''),
        };
    };

    const getSearchResult = (search: string, mode: SearchMode = 'name'): SearchResultGroup[] => {
        const q = normalize((search ?? '').trim());
        if (!q) return [];

        const localGroupStore = useLocalGroupStore();

        // Locais primeiro, igual à listagem de repertórios
        const sources = [
            ...localGroupStore.groups.map(g => ({ id: g.id, label: g.label, songs: g.songs, isLocal: true })),
            ...listSongGroups.value.map(g => ({ id: g.id, label: g.label, songs: g.songs, isLocal: false })),
        ];

        const result: SearchResultGroup[] = [];

        sources.forEach(group => {
            const matches: SongSearchMatch[] = [];

            (group.songs ?? []).forEach(song => {
                if (mode === 'name') {
                    if (normalize(song.fullName ?? '').includes(q)) matches.push({ ...song });
                    return;
                }
                const snippet = buildSnippet(song.lyric ?? '', q);
                if (snippet) matches.push({ ...song, snippet });
            });

            if (matches.length > 0) {
                matches.sort((a, b) =>
                    a.fullName.localeCompare(b.fullName, 'pt-BR', { sensitivity: 'base' })
                );
                result.push({ id: group.id, label: group.label, isLocal: group.isLocal, songs: matches });
            }
        });

        return result;
    };

    return {
        listSongGroups,
        selectedSong,
        isLoaded,
        listLastDataUpdated,
        syncSongGroups,
        getFilesFromSongs,
        setSelectedSong,
        setLastUpdate,
        loadData,
        changeCacheInfo,
        getCacheLyrics,
        getSearchResult
    }
});