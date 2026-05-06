<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useUpdaterStore } from '../stores/updaterStore';
import UpdateModal from './UpdateModal.vue';

const updaterStore = useUpdaterStore();
const showModal = ref(false);

onMounted(() => {
  setTimeout(() => {
    updaterStore.check();
  }, 3000);
});

const openModal = () => {
  showModal.value = true;
};
</script>

<template>
  <div v-show="updaterStore.hasUpdate" class="d-inline-flex align-center">
    <v-tooltip text="Nova atualização disponível!" location="bottom">
      <template v-slot:activator="{ props }">
        <v-btn
          v-bind="props"
          variant="tonal"
          color="success"
          size="small"
          density="comfortable"
          class="ml-2 update-btn rounded-pill"
          prepend-icon="mdi-download"
          @click="openModal"
        >
          <span class="text-caption font-weight-bold">Atualizar</span>
        </v-btn>
      </template>
    </v-tooltip>

    <UpdateModal v-model="showModal" />
  </div>
</template>

<style scoped>
.update-btn {
  animation: pulse-glow 2s ease-in-out infinite;
  position: relative;
}

.update-btn::after {
  content: '';
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 0 rgba(var(--v-theme-success), 0.7);
  animation: dot-pulse 1.5s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-success), 0.4);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(var(--v-theme-success), 0);
  }
}

@keyframes dot-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-success), 0.7);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(var(--v-theme-success), 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-success), 0);
  }
}
</style>