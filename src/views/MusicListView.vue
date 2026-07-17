<script setup lang="ts">
import { onMounted, watch } from 'vue';
import RepertoireSidebar from '../components/projection/RepertoireSidebar.vue';
import SongSidebar from '../components/projection/SongSidebar.vue';
import PresentationEditor from '../components/projection/PresentationEditor.vue';
import EventSidebar from '../components/event/EventSidebar.vue';
import ProgramSidebar from '../components/program/ProgramSidebar.vue';
import MediaSidebar from '../components/media/MediaSidebar.vue';

import { useMenuStore } from '../stores/menuStore';
import { useMusicPresentationStore } from '../stores/presentationStore';
import { useSongCacheStore } from '../stores/songCacheStore' 

const menuStore = useMenuStore();
const presentationStore = useMusicPresentationStore();
const songCacheStore = useSongCacheStore()

watch(() => songCacheStore.selectedSong, (newValue) => {
  if(newValue.songGroupId !== presentationStore.selectedGroupId){
    presentationStore.selectGroup(newValue.songGroupId)
    presentationStore.selectSong(newValue)
  } else if(newValue.id !== presentationStore.selectedSongId) {
    presentationStore.selectSong(newValue)
  }
},
  { deep: true })

onMounted(async () => {
  await presentationStore.fetchGroups();  
  await songCacheStore.loadData()
}); 
</script>
 
<template>
  <v-container fluid class="fill-height pa-0 bg-surface-light" style="user-select: none;">
    <v-row density="compact" class="fill-height">
      
      <template v-if="presentationStore.showSidebarLists && menuStore.menuOpened === 'Songs'">
        <v-col cols="2" class="border-e bg-white transition-all d-flex flex-column h-100">
          <RepertoireSidebar 
            :groups="songCacheStore.listSongGroups" 
            :selected-id="presentationStore.selectedGroupId" 
            @select="presentationStore.selectGroup" 
          />
        </v-col>

        <v-col cols="3" class="border-e bg-white transition-all d-flex flex-column h-100">
          <SongSidebar 
            :songs="presentationStore.filteredSongs" 
            :selected-id="presentationStore.selectedSongId"
          /> 
        </v-col>
      </template>

      <template v-else-if="presentationStore.showSidebarLists && menuStore.menuOpened === 'Events'">
        <v-col cols="5" class="border-e bg-white transition-all d-flex flex-column h-100">
          <EventSidebar ref="eventSidebarRef" />
        </v-col>
      </template>

      <template v-else-if="presentationStore.showSidebarLists && menuStore.menuOpened === 'Program'">
        <v-col cols="5" class="border-e bg-white transition-all d-flex flex-column h-100">
          <ProgramSidebar ref="programSidebarRef" />
        </v-col>
      </template>

      <template v-else-if="presentationStore.showSidebarLists && menuStore.menuOpened === 'Media'">
        <v-col cols="5" class="border-e bg-white transition-all d-flex flex-column h-100">
          <MediaSidebar ref="mediaSidebarRef" />
        </v-col>
      </template>

      <v-col :cols="presentationStore.showSidebarLists ? 7 : 12" class="d-flex flex-column fill-height bg-grey-lighten-5 transition-all">
        <PresentationEditor />
      </v-col>

    </v-row>
  </v-container>
</template>