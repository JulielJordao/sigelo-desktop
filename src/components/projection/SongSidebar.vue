<script setup lang="ts">
defineProps<{
  songs: Array<{ _id: string, fullName: string }>;
  selectedId: string | null;
}>();

const emit = defineEmits<{
  (e: 'select', id: string): void
}>();
</script>

<template>
  <div class="d-flex flex-column fill-height">
    <v-toolbar density="compact" color="white" elevation="0" class="border-b">
      <v-toolbar-title class="text-subtitle-2 font-weight-bold">
        Músicas ({{ songs.length }})
      </v-toolbar-title>
    </v-toolbar>
    
    <v-list density="compact" class="flex-grow-1 overflow-y-auto pa-2" nav>
      <v-list-item
        v-for="song in songs" 
        :key="song._id" 
        :value="song._id"
        :active="selectedId === song._id" 
        color="primary" 
        rounded="lg" 
        class="mb-1 border"
        @click="emit('select', song._id)"
      >
        <v-list-item-title class="text-body-2 font-weight-medium">{{ song.fullName }}</v-list-item-title>
      </v-list-item>
      
      <div v-if="songs.length === 0" class="text-center pa-4 text-caption text-grey">
        Nenhuma música neste grupo.
      </div>
    </v-list>
  </div>
</template>