<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import RepertoireSidebar from '../components/projection/RepertoireSidebar.vue';
import SongSidebar from '../components/projection/SongSidebar.vue';
import PresentationEditor from '../components/projection/PresentationEditor.vue';
import routes from '../routes/index' 
import { getLinkFiles } from '../utils/convertData';
import EventSidebar from '../components/event/EventSidebar.vue';

import { useMenuStore } from '../stores/menuStore';

import MediaSidebar from '../components/media/MediaSidebar.vue';

const menuStore = useMenuStore();

interface Song {
  _id: string

  audioLink: Array<string>
  bibleRef: Array<any>

  createdAt: string

  fullName: string

  songGroupId: string

  songGroupName: string

  tags: Array<string>

  tone: string

  updatedAt: string
}

interface SongFiles {
   _id: string
    originalName: string
    fileName: string
    type: string
    songId: string
    createdAt: string
    updatedAt: string
    __v: number
    songIdObj: string
}

const refPresentationEditor = ref({updateLyric : (newLyric: string) => { console.log(newLyric)}})

const isLoading = ref(false)

const songGroupRoutes =  routes.songGroup()
const songRoutes = routes.song()
const filesRoutes = routes.files()
// --- ESTADOS DA TELA ---
const showSidebarLists = ref(true);
const selectedGroupId = ref<string>("68f8be456569689b456edd83");
const selectedSongId = ref<string>("");

// --- MOCK DATA ---
const rawGroups = ref([{ "_id": "68f8be456569689b456edd83", "name": "Composições Luteranas" }]);
const rawSongs = ref([
  { "_id": "68f9246b6569689b456edf30", "fullName": "Nossa esperança em Deus está", "songGroupId": "68f8be456569689b456edd83" },
  { "_id": "68f94eaf6569689b456edf88", "fullName": "Guiados", "songGroupId": "68f8be456569689b456edd83" }
]);
rawSongs.value.splice(0, rawGroups.value.length+1)

// const files = ref<Array<SongFiles>>([])

const generateLyrics = (title: string) => `[Verso 1]\nSenhor, nós te louvamos\nEm espírito e em verdade\n\n[Refrão]\n${title}\nÉ o nosso clamor`;
const songs = ref(rawSongs.value.map(song => ({ ...song, lyrics: generateLyrics(song.fullName) })));

// --- COMPUTED ---
const filteredSongs = computed(() => songs.value);
const activeSong = computed(() => songs.value.find(s => s._id === selectedSongId.value) || null);

// --- AÇÕES ---
const onSelectGroup = (id: string) => {
  if(isLoading) {
    isLoading.value = true
    selectedGroupId.value = id;
    getListMusic()
    selectedSongId.value = ''; 
  }
};

const onSelectSong = (id: string) => {
  selectedSongId.value = id;
  getLyric()
};

const getLyric = async() => {
  const songId: string[] = [selectedSongId.value]
  const files = await filesRoutes.getListBySongId(songId)
  
  if(Array.isArray(files?.response)){
    const list = files.response
    files.value = list

    const lyricFile = files.value.find((it: SongFiles) => it.type == "Letra")

    if(lyricFile?._id) {
      const url = getLinkFiles(lyricFile.fileName)
      const rawLyric = await routes.proxy(url)

      refPresentationEditor.value.updateLyric(rawLyric.content)
    } else {
      refPresentationEditor.value.updateLyric("")
    }
  }
}

const getData = async () => {
  const response = await songGroupRoutes.get()

  rawGroups.value.splice(0, rawGroups.value.length)

  if(Array.isArray(response?.response)) {
    const list = response.response
    list.forEach((it: any) => {
      rawGroups.value.push(it)
    });
  }
}

const getListMusic = async () => { 
  const response = await songRoutes.list(selectedGroupId.value)

  if(Array.isArray(response?.search)){
    const list = response.search
    songs.value.splice(0, songs.value.length)

    const sortedSongs = [...list].sort((a, b) => {
      return a.fullName.localeCompare(b.fullName, 'pt-BR', { sensitivity: 'base' });
    });

    sortedSongs.forEach((it: Song) => {
      songs.value.push({ _id: it._id, fullName: it.fullName, songGroupId: it.songGroupId, lyrics: "" })
    });
    isLoading.value = false
  }
}

onMounted(async() => {
  await getData()
}) 
</script>
 
<template>
  <v-container fluid class="fill-height pa-0 bg-grey-lighten-4" style="user-select: none;">
    <v-row density="compact" class="fill-height">
      
      <template v-if="showSidebarLists && menuStore.menuOpened === 'Songs'">
        <v-col cols="2" class="border-e bg-white transition-all d-flex flex-column h-100">
          <RepertoireSidebar 
            :groups="rawGroups" 
            :selected-id="selectedGroupId" 
            @select="onSelectGroup" 
          />
        </v-col>

        <v-col cols="3" class="border-e bg-white transition-all d-flex flex-column h-100">
          <SongSidebar 
            :songs="filteredSongs" 
            :selected-id="selectedSongId" 
            @select="onSelectSong" 
          /> 
        </v-col>
      </template>

      <template v-else-if="showSidebarLists && menuStore.menuOpened === 'Events'">
        <v-col cols="5" class="border-e bg-white transition-all d-flex flex-column h-100">
          <EventSidebar ref="eventSidebarRef" />
        </v-col>
      </template>

      <template v-else-if="showSidebarLists && menuStore.menuOpened === 'Media'">
        <v-col cols="5" class="border-e bg-white transition-all d-flex flex-column h-100">
          <MediaSidebar ref="mediaSidebarRef" />
        </v-col>
      </template>

      <v-col :cols="showSidebarLists ? 7 : 12" class="d-flex flex-column fill-height bg-grey-lighten-5 transition-all">
        <PresentationEditor 
          ref="refPresentationEditor"
          :active-song="activeSong"
          :show-sidebar="showSidebarLists"
          @toggle-sidebar="showSidebarLists = !showSidebarLists"
        />
      </v-col>

    </v-row>
  </v-container>
</template>