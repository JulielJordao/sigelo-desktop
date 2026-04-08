<script setup lang="ts">
import { onMounted } from 'vue';
import RepertoireSidebar from '../components/projection/RepertoireSidebar.vue';
import SongSidebar from '../components/projection/SongSidebar.vue';
import PresentationEditor from '../components/projection/PresentationEditor.vue';
import EventSidebar from '../components/event/EventSidebar.vue';
import MediaSidebar from '../components/media/MediaSidebar.vue';

import { useMenuStore } from '../stores/menuStore';
import { useMusicPresentationStore } from '../stores/presentationStore';

const menuStore = useMenuStore();
const presentationStore = useMusicPresentationStore();

onMounted(async () => {
  await presentationStore.fetchGroups();
}); 
</script>
 
<template>
  <v-container fluid class="fill-height pa-0 bg-grey-lighten-4" style="user-select: none;">
    <v-row density="compact" class="fill-height">
      
      <template v-if="presentationStore.showSidebarLists && menuStore.menuOpened === 'Songs'">
        <v-col cols="2" class="border-e bg-white transition-all d-flex flex-column h-100">
          <RepertoireSidebar 
            :groups="presentationStore.rawGroups" 
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