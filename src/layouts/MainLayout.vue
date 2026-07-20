<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ask } from '@tauri-apps/plugin-dialog';
import SettingsModal from '../components/config/SettingsModal.vue';

import BibleDrawer from '../components/bible/BibleDrawer.vue'; // <-- Importe o novo componente
// import { useConfigStore } from '../stores/useConfigStore';

import { useMenuStore } from '../stores/menuStore';
import { useUserStore } from '../stores/userStore';
import { useConfigStore } from '../stores/useConfigStore.js';

import { listen, type UnlistenFn } from '@tauri-apps/api/event';


import { BibleRef } from '../types/bibleRef';

const configStore = useConfigStore();
const userStore = useUserStore()
const menuStore = useMenuStore();

const isDark = computed(() => configStore.getTheme() === 'dark');

const router = useRouter();

const settingsModalRef = ref<any>(null);
const bibleDrawerRef = ref<any>(null); // <-- Ref para acessar o componente filho

// const configStore = useConfigStore();

// Essa função agora chama o método open() exposto pelo BibleDrawer
const toggleBible = (hasBibleRef: boolean, bibleRef: BibleRef | undefined, text?: string) => {
    // Sem referência: só abre/alterna o drawer vazio
    if(!bibleRef && bibleDrawerRef.value?.isOpen) {
        bibleDrawerRef.value?.close();
        return;
    }
    if (!hasBibleRef || !bibleRef) {
        bibleDrawerRef.value?.open();
        return;
    }

    const verses = bibleRef.verseStart
        ? (bibleRef.verseEnd ? `${bibleRef.verseStart}-${bibleRef.verseEnd}` : `${bibleRef.verseStart}`)
        : undefined;

    
    bibleDrawerRef.value?.open({
        abbr: bibleRef.book,
        chapter: bibleRef.chapter,
        verses,
        text, // <-- repassa o texto manual quando existir
    });
};

const toogleMediaSidebar = () => {
  menuStore.toggleMenu('Media');
};

const handleProjection = (bibleData: any) => {
  console.log("Enviando para projeção:", bibleData);
  // Aqui você chama a lógica de exibição, WebSocket, ou integração com Holyrics
};

let unlistenBible: UnlistenFn | null = null;

const openSettingsModal = () => {

  settingsModalRef.value.openDialog();
};

const logout = async () => {
  const confirmed = await ask('Deseja realmente sair da conta?', {
    title: 'Sigelo',
    kind: 'warning',
    okLabel: 'Sim, sair',
    cancelLabel: 'Cancelar'
  });

  if (confirmed) {
    await userStore.logout()
    menuStore.toggleMenu('Login')
    router.push('/');
  }

};

const toggleProgramSidebar = () => {
  menuStore.toggleMenu('Program');
}

const toogleSongsSidebar = () => {
  menuStore.toggleMenu('Songs');
};

const toggleEventsSidebar = () => {
  menuStore.toggleMenu('Events');
};

onMounted(async () => {
  menuStore.toggleMenu('Songs')

  unlistenBible = await listen<BibleRef & { text?: string }>('open-bible', async (event) => {
      const { text, ...bibleRef } = event.payload as any;
      toggleBible(true, bibleRef, text);
  });
});

onUnmounted(() => {
  if (unlistenBible) unlistenBible();
})

</script>

<template>
  <v-layout class="fill-height bg-grey-lighten-4 overflow-hidden" style="user-select: none;">

    <v-navigation-drawer permanent rail expand-on-hover elevation="2" class="bg-grey-darken-3 text-white">
      <v-list density="compact" nav>
        <v-list-item prepend-icon="mdi-music-box-multiple" title="Músicas" value="musicas" @click="toogleSongsSidebar"
          :active="menuStore.menuOpened === 'Songs'" :color="isDark ? 'primary' : 'secondary'"></v-list-item>
        <v-list-item prepend-icon="mdi-calendar-multiselect" title="Eventos" value="event" @click="toggleEventsSidebar"
          :active="menuStore.menuOpened === 'Events'" :color="isDark ? 'primary' : 'secondary'"></v-list-item>

        <v-list-item prepend-icon="mdi-playlist-music" title="Programação" value="program" @click="toggleProgramSidebar"
          :active="menuStore.menuOpened === 'Program'" :color="isDark ? 'primary' : 'secondary'"></v-list-item>

        <v-list-item prepend-icon="mdi-book-open-page-variant" title="Bíblia" value="bible"
          @click="toggleBible(false, undefined)" :color="isDark ? 'primary' : 'secondary'"></v-list-item>

        <v-list-item prepend-icon="mdi-image-multiple" title="Mídia / Imagens" @click="toogleMediaSidebar"
          :active="menuStore.menuOpened === 'Media'" value="midia"
          :color="isDark ? 'primary' : 'secondary'"></v-list-item>
      </v-list>

      <template v-slot:append>
        <v-list density="compact" nav>
          <v-list-item prepend-icon="mdi-cog" title="Configurações" @click="openSettingsModal"
            value="config"></v-list-item>
          <v-list-item prepend-icon="mdi-logout" title="Sair" value="logout" @click="logout"></v-list-item>
        </v-list>
      </template>
    </v-navigation-drawer>

    <BibleDrawer ref="bibleDrawerRef" @project="handleProjection" />

    <v-main class="d-flex flex-column h-100 overflow-hidden">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </v-main>

    <SettingsModal ref="settingsModalRef" />

  </v-layout>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>