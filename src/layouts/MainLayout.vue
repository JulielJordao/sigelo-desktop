<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import SettingsModal from '../components/config/SettingsModal.vue';

import BibleDrawer from '../components/bible/BibleDrawer.vue'; // <-- Importe o novo componente
// import { useConfigStore } from '../stores/useConfigStore';

import { useMenuStore } from '../stores/menuStore';
import { useConfigStore } from '../stores/useConfigStore';

const menuStore = useMenuStore();
const configStore = useConfigStore();

const router = useRouter();

const settingsModalRef = ref<any>(null);
const bibleDrawerRef = ref<any>(null); // <-- Ref para acessar o componente filho

// const configStore = useConfigStore();

// Essa função agora chama o método open() exposto pelo BibleDrawer
const toggleBible = () => {
  bibleDrawerRef.value?.open();
  
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

const openSettingsModal = () =>  {
  settingsModalRef.value.openDialog();
};

const logout = () => {
  localStorage.removeItem('userToken');
  router.push('/');
};

const toogleSongsSidebar = () => {
  menuStore.toggleMenu('Songs');
};

const toggleEventsSidebar = () => {
  menuStore.toggleMenu('Events');
};

onMounted(() => {
  menuStore.toggleMenu('Songs')
  configStore.loadSettings();
});


</script>

<template>
  <v-layout class="fill-height bg-grey-lighten-4 overflow-hidden" style="user-select: none;">
    
    <v-navigation-drawer 
      permanent 
      rail 
      expand-on-hover 
      elevation="2"
      class="bg-grey-darken-4 text-white"
    >
      <v-list density="compact" nav>
        <v-list-item 
          prepend-icon="mdi-music-box-multiple" 
          title="Músicas" 
          value="musicas"
          @click="toogleSongsSidebar"
          :active="menuStore.menuOpened === 'Songs'"
          color="primary"
        ></v-list-item>
        <v-list-item 
          prepend-icon="mdi-calendar-multiselect" 
          title="Eventos" 
          value="event" 
          @click="toggleEventsSidebar"
          :active="menuStore.menuOpened === 'Events'"
          color="primary"
        ></v-list-item>
        
        <v-list-item 
          prepend-icon="mdi-book-open-page-variant" 
          title="Bíblia" 
          value="bible" 
          @click="toggleBible"
          color="primary"
        ></v-list-item>
        
        <v-list-item 
          prepend-icon="mdi-image-multiple" 
          title="Mídia / Imagens" 
          @click="toogleMediaSidebar"
          :active="menuStore.menuOpened === 'Media'"
          value="midia"
        ></v-list-item>
      </v-list>

      <template v-slot:append>
        <v-list density="compact" nav>
          <v-list-item 
            prepend-icon="mdi-cog" 
            title="Configurações" 
            @click="openSettingsModal"
            value="config"
          ></v-list-item>
          <v-list-item 
            prepend-icon="mdi-logout" 
            title="Sair" 
            value="logout" 
            @click="logout"
          ></v-list-item>
        </v-list>
      </template>
    </v-navigation-drawer>

    <BibleDrawer 
      ref="bibleDrawerRef" 
      @project="handleProjection" 
    />

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