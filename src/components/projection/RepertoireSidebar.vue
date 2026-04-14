<script setup lang="ts">
import { ref } from 'vue'
import SearchSongModal from '../songs/SearchSongModal.vue';
import type { SongGroupCache } from '../../stores/songCacheStore';

defineProps<{
  groups: Array<SongGroupCache>;
  selectedId: string | null;
}>();

const selectGroup = (groupId: string) => {
  currentGroupId.value = groupId; emit('select', groupId)
}

const emit = defineEmits<{
  (e: 'select', id: string): void
}>();

const isSearchModalOpen = ref(false)
const currentGroupId = ref('')

</script>

<template>
  <div class="d-flex flex-column fill-height">
    <v-toolbar density="compact" color="surface" elevation="0" class="border-b">
      <v-toolbar-title class="text-subtitle-2 font-weight-bold">Repertórios</v-toolbar-title>
      <v-btn icon density="comfortable" @click="isSearchModalOpen = true">
        <v-icon>{{ 'mdi-magnify' }}</v-icon>
      </v-btn>
    </v-toolbar>

    <v-list density="compact" class="flex-grow-1 overflow-y-auto" nav>
      <v-list-item v-for="group in groups" :key="group.id" :value="group.id" :active="selectedId === group.id"
        color="primary" rounded="lg" @click="selectGroup(group.id)">
        <template v-slot:prepend>
          <v-icon icon="mdi-folder-music-outline" size="small"></v-icon>
        </template>

        <v-list-item-title class="text-body-2">
          {{ group.label }}
        </v-list-item-title>

        <template v-slot:append>
          <v-icon v-if="group.songs.length > 0" icon="mdi-cloud-check-outline" size="small" color="success">
            <v-tooltip activator="parent" location="top" open-delay="200">
              Repertório disponível offline
            </v-tooltip>
          </v-icon>
 <!--
          <v-icon v-else-if="group.isSyncing" icon="mdi-cloud-sync" size="small" color="grey">
            <v-tooltip activator="parent" location="top">
              Sincronizando...
            </v-tooltip>
          </v-icon> -->
        </template>

      </v-list-item>
    </v-list>
    <SearchSongModal v-model="isSearchModalOpen" />
  </div>
</template>