<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ask } from '@tauri-apps/plugin-dialog';
import SettingsModal from '../components/config/SettingsModal.vue';

import BibleDrawer from '../components/bible/BibleDrawer.vue'; // <-- Importe o novo componente
// import { useConfigStore } from '../stores/useConfigStore';

import { useMenuStore } from '../stores/menuStore';
import { useConfigStore } from '../stores/useConfigStore';
import { useUserStore } from '../stores/userStore';

import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { useTheme } from 'vuetify';
import { BibleRef } from 'types/bibleRef';

const theme = useTheme();

const userStore = useUserStore()
const menuStore = useMenuStore();
const configStore = useConfigStore();

const router = useRouter();

const settingsModalRef = ref<any>(null);
const bibleDrawerRef = ref<any>(null); // <-- Ref para acessar o componente filho

// const configStore = useConfigStore();

// Essa função agora chama o método open() exposto pelo BibleDrawer
const toggleBible = (hasBibleRef: boolean, bibleRef: BibleRef | undefined) => {
  bibleDrawerRef.value?.open();

  if (hasBibleRef && bibleRef) {
    console.log("bibleRef", bibleRef)
    const verses = bibleRef.verseStart ? (
      bibleRef.verseEnd ? `${bibleRef.verseStart}-${bibleRef.verseEnd}` : bibleRef.verseStart) :
      undefined
    bibleDrawerRef.value?.open({abbr: bibleRef.book, chapter: bibleRef.chapter, verses})
  }

  // Exemplo de como você poderia abri-lo já buscando um texto de outro lugar do app:
  // bibleDrawerRef.value?.open({ abbr: 'Rm', chapter: 3, verses: '10-12' });
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

const toogleSongsSidebar = () => {
  menuStore.toggleMenu('Songs');
};

const toggleEventsSidebar = () => {
  menuStore.toggleMenu('Events');
};

onMounted(async () => {
  menuStore.toggleMenu('Songs')
  await configStore.loadSettings();
  theme.change(configStore.getTheme())

  unlistenBible = await listen<BibleRef>('open-bible', async (event) => {
      console.log("aq")
      toggleBible(true, event.payload)
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
          :active="menuStore.menuOpened === 'Songs'" color="primary"></v-list-item>
        <v-list-item prepend-icon="mdi-calendar-multiselect" title="Eventos" value="event" @click="toggleEventsSidebar"
          :active="menuStore.menuOpened === 'Events'" color="primary"></v-list-item>

        <v-list-item prepend-icon="mdi-book-open-page-variant" title="Bíblia" value="bible"
          @click="toggleBible(false, undefined)" color="primary"></v-list-item>

        <v-list-item prepend-icon="mdi-image-multiple" title="Mídia / Imagens" @click="toogleMediaSidebar"
          :active="menuStore.menuOpened === 'Media'" value="midia"></v-list-item>
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