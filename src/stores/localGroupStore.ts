import { defineStore } from 'pinia';
import { ref, toRaw } from 'vue';
import { load } from '@tauri-apps/plugin-store';
import type { Store } from '@tauri-apps/plugin-store';
import type { SongCache } from './songCacheStore';

export interface LocalSongGroup {
    id: string;
    label: string;
    songs: SongCache[];
    createdAt: string;
}

const LOCAL_PREFIX = 'local-';

export const useLocalGroupStore = defineStore('localGroup', () => {
    let store: Store | null = null;
    let loadingPromise: Promise<void> | null = null;
    const groups = ref<LocalSongGroup[]>([]);
    const isLoaded = ref(false);

    // Prefixo no id permite identificar um item local em QUALQUER lugar do app
    const isLocalId = (id?: string | null) => !!id && id.startsWith(LOCAL_PREFIX);

    const newId = () =>
        `${LOCAL_PREFIX}${crypto.randomUUID?.() ?? Date.now() + '-' + Math.random().toString(16).slice(2)}`;

    const ensureStore = async () => {
        if (store) return store;
        store = await load('localGroups.json', { autoSave: false, defaults: { groups: [] } });
        return store;
    };

    const loadData = async () => {
        if (loadingPromise) return loadingPromise;   // evita corrida se chamarem 2x
        loadingPromise = (async () => {
            try {
                const s = await ensureStore();
                const saved = await s.get<LocalSongGroup[]>('groups');
                if (Array.isArray(saved)) groups.value = saved;
            } catch (error) {
                console.error('Erro ao carregar repertórios locais:', error);
            } finally {
                isLoaded.value = true;
            }
        })();
        return loadingPromise;
    };

    const persist = async () => {
        try {
            const s = await ensureStore();
            await s.set('groups', JSON.parse(JSON.stringify(toRaw(groups.value))));
            await s.save();
        } catch (error) {
            console.error('Erro ao salvar repertórios locais:', error);
        }
    };

    const getGroup = (id: string) => groups.value.find(g => g.id === id);

    const sortSongs = (group: LocalSongGroup) => {
        group.songs.sort((a, b) =>
            a.fullName.localeCompare(b.fullName, 'pt-BR', { sensitivity: 'base' })
        );
    };

    // --- GRUPOS ---
    const createGroup = async (label: string) => {
        const group: LocalSongGroup = {
            id: newId(),
            label: label.trim() || 'Novo repertório',
            songs: [],
            createdAt: new Date().toISOString(),
        };
        groups.value.push(group);
        await persist();
        return group;
    };

    const renameGroup = async (id: string, label: string) => {
        const group = getGroup(id);
        if (!group) return;
        group.label = label.trim() || group.label;
        await persist();
    };

    const deleteGroup = async (id: string) => {
        groups.value = groups.value.filter(g => g.id !== id);
        await persist();
    };

    // --- MÚSICAS ---
    const addSong = async (groupId: string, data: Partial<SongCache> & { fullName: string }) => {
        const group = getGroup(groupId);
        if (!group) return null;

        const song: SongCache = {
            songGroupId: groupId,
            id: newId(),
            fullName: data.fullName.trim(),
            lyric: data.lyric ?? '',
            writerBy: data.writerBy,
            melodyBy: data.melodyBy,
            tone: data.tone,
        };
        group.songs.push(song);
        sortSongs(group);
        await persist();
        return song;
    };

    const updateSong = async (groupId: string, songId: string, data: Partial<SongCache>) => {
        const group = getGroup(groupId);
        const song = group?.songs.find(s => s.id === songId);
        if (!group || !song) return null;
        Object.assign(song, data);
        sortSongs(group);
        await persist();
        return song;
    };

    const removeSong = async (groupId: string, songId: string) => {
        const group = getGroup(groupId);
        if (!group) return;

        const idx = group.songs.findIndex(s => s.id === songId);
        if (idx === -1) return;

        group.songs.splice(idx, 1);   // ← muta o array, mantém a referência
        await persist();
    };

    return {
        groups, isLoaded, isLocalId, loadData, getGroup,
        createGroup, renameGroup, deleteGroup,
        addSong, updateSong, removeSong,
    };
});