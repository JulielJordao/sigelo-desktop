<script setup lang="ts">
defineProps<{
  groups: Array<{ _id: string, name: string }>;
  selectedId: string | null;
}>();

const emit = defineEmits<{
  (e: 'select', id: string): void
}>();
</script>

<template>
  <div class="d-flex flex-column fill-height">
    <v-toolbar density="compact" color="surface" elevation="0" class="border-b">
      <v-toolbar-title class="text-subtitle-2 font-weight-bold">Repertórios</v-toolbar-title>
    </v-toolbar>
    
    <v-list density="compact" class="flex-grow-1 overflow-y-auto" nav>
      <v-list-item
        v-for="group in groups" 
        :key="group._id" 
        :value="group._id"
        :active="selectedId === group._id" 
        color="primary" 
        rounded="lg"
        @click="emit('select', group._id)"
      >
        <template v-slot:prepend>
          <v-icon icon="mdi-folder-music-outline" size="small"></v-icon>
        </template>
        <v-list-item-title class="text-body-2">{{ group.name }}</v-list-item-title>
      </v-list-item>
    </v-list>
  </div>
</template>