<script setup lang="ts">
import { ref, computed } from 'vue';
import RepertoireSidebar from '../components/projection/RepertoireSidebar.vue';
import SongSidebar from '../components/projection/SongSidebar.vue';
import PresentationEditor from '../components/projection/PresentationEditor.vue';

// --- ESTADOS DA TELA ---
const showSidebarLists = ref(true);
const selectedGroupId = ref<string | null>("68f8be456569689b456edd83");
const selectedSongId = ref<string | null>(null);

// --- MOCK DATA ---
const rawGroups = [{ "_id": "68f8be456569689b456edd83", "name": "Composições Luteranas" }];
const rawSongs = [
  { "_id": "68f9246b6569689b456edf30", "fullName": "Nossa esperança em Deus está", "songGroupId": "68f8be456569689b456edd83" },
  { "_id": "68f94eaf6569689b456edf88", "fullName": "Guiados", "songGroupId": "68f8be456569689b456edd83" }
];

const generateLyrics = (title: string) => `[Verso 1]\nSenhor, nós te louvamos\nEm espírito e em verdade\n\n[Refrão]\n${title}\nÉ o nosso clamor`;
const songs = rawSongs.map(song => ({ ...song, lyrics: generateLyrics(song.fullName) }));

// --- COMPUTED ---
const filteredSongs = computed(() => songs.filter(s => s.songGroupId === selectedGroupId.value));
const activeSong = computed(() => songs.find(s => s._id === selectedSongId.value) || null);

// --- AÇÕES ---
const onSelectGroup = (id: string) => {
  selectedGroupId.value = id;
  selectedSongId.value = null; // Reseta a música ao trocar de repertório
};

const onSelectSong = (id: string) => {
  selectedSongId.value = id;
};
</script>

<template>
  <v-container fluid class="fill-height pa-0 bg-grey-lighten-4" style="user-select: none;">
    <v-row no-gutters class="fill-height">
      
      <template v-if="showSidebarLists">
        <v-col cols="2" class="border-e bg-white transition-all">
          <RepertoireSidebar 
            :groups="rawGroups" 
            :selected-id="selectedGroupId" 
            @select="onSelectGroup" 
          />
        </v-col>

        <v-col cols="3" class="border-e bg-white transition-all">
          <SongSidebar 
            :songs="filteredSongs" 
            :selected-id="selectedSongId" 
            @select="onSelectSong" 
          />
        </v-col>
      </template>

      <v-col :cols="showSidebarLists ? 7 : 12" class="d-flex flex-column fill-height bg-grey-lighten-5 transition-all">
        <PresentationEditor 
          :active-song="activeSong"
          :show-sidebar="showSidebarLists"
          @toggle-sidebar="showSidebarLists = !showSidebarLists"
        />
      </v-col>

    </v-row>
  </v-container>
</template>

<style scoped>
.transition-all {
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}
</style>