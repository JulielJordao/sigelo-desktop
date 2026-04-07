import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import routes from '../routes/index';
import type { Event } from '../types/event';
import type { Song } from '../types/song';
import type { SongFile } from '../types/songFile';

export const useEventStore = defineStore('event', () => {
    const isLoading = ref(false);
    const isLoaded = ref(false);

    const eventRoute = routes.event();
    const songsRoute = routes.song();
    const songFile = routes.files()

    const songsByEvent = ref<Song[]>([]);
    const events = ref<Event[]>([]);

    const loadEvents = async () => {
        const isLoading = ref(true)
        try {
            const response = await eventRoute.list();

            if (response?.response) {
                events.value = response.response as Event[];
            }
        } catch (error) {
            console.error("Erro ao carregar eventos:", error);
        } finally {
            isLoading.value = false;
            isLoaded.value = true;
        }
    };

    const getSongsForEvent = async (event: Event) => {
        try {
            console.log(event.songs)
            const response = await songsRoute.getByListId(event.songs || [])
            console.log(response)
            if (response?.response) {
                console.log(response.response)
                songsByEvent.value = response.response as Song[];
                getFilesFromSongs();
            }
        } catch (error) {
            console.error("Erro ao carregar músicas para o evento:", error);
        }
    };

    const getFilesFromSongs = async () => {
        try {
            if(Array.isArray(songsByEvent.value) && songsByEvent.value.length > 0) {
                const listId = songsByEvent.value.map(song => song._id);

                const response = await songFile.getListBySongId(listId);

                if (response?.response) {
                    const files = response.response as SongFile[];
                    songsByEvent.value.forEach(song => {
                        song.files = files.filter(file => file.songIdObj === song._id);
                    });
                }
            } else {
                return Promise.resolve([]);
            }
        } catch (error) {
            console.error("Erro ao carregar arquivos para a música:", error);
        }
    }

    return {
        events,
        songsByEvent,
        isLoading,
        isLoaded,
        getSongsForEvent,
        loadEvents
    }
});
