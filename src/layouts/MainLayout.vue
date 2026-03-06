<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import SettingsModal from '../components/config/SettingsModal.vue'
import { useConfigStore } from '../stores/useConfigStore';

const router = useRouter();

const settingsModalRef = ref<any>(null)

// Estado da aba lateral da Bíblia
const bibleDrawer = ref(false);

const configStore = useConfigStore();

const toggleBible = () => {
  bibleDrawer.value = !bibleDrawer.value;
};

const openSettingsModal = () =>  {
  settingsModalRef.value.openDialog()
}

const logout = () => {
  // Limpa o token e volta para a tela de login
  localStorage.removeItem('userToken');
  router.push('/');
};
</script>

<template>
  <v-layout class="fill-height bg-grey-lighten-4" style="user-select: none;">
    
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
          to="/app/musicas"
          color="primary"
        ></v-list-item>
        
        <v-list-item 
          prepend-icon="mdi-book-open-page-variant" 
          title="Bíblia" 
          value="bible" 
          @click="toggleBible"
          :active="bibleDrawer"
          color="primary"
        ></v-list-item>
        
        <v-list-item 
          prepend-icon="mdi-image-multiple" 
          title="Mídia / Imagens" 
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

    <v-navigation-drawer 
      v-model="bibleDrawer" 
      location="right" 
      temporary 
      width="380"
      elevation="6"
    >
      <v-toolbar color="primary" density="compact" class="text-white border-b">
        <v-icon class="ml-4">mdi-book-cross</v-icon>
        <v-toolbar-title class="text-subtitle-1 font-weight-bold ml-2">Bíblia Sagrada</v-toolbar-title>
        <v-spacer></v-spacer>
        <v-btn icon="mdi-close" variant="text" size="small" @click="toggleBible"></v-btn>
      </v-toolbar>
      
      <v-container class="pa-4 d-flex flex-column fill-height">
        <v-text-field
          prepend-inner-icon="mdi-magnify"
          label="Buscar livro, capítulo..."
          variant="outlined"
          density="compact"
          color="primary"
          hide-details
          class="mb-4 flex-grow-0"
        ></v-text-field>
        
        <div class="flex-grow-1 d-flex flex-column align-center justify-center text-grey text-caption">
          <v-icon icon="mdi-bookshelf" size="48" class="mb-2 text-grey-lighten-2"></v-icon>
          <p class="font-weight-medium">Módulo em desenvolvimento</p>
          <p class="text-center px-4 mt-2">A pesquisa instantânea em JSON será integrada aqui para projeção rápida de versículos.</p>
        </div>
      </v-container>
    </v-navigation-drawer>

    <v-main class="d-flex flex-column h-screen overflow-hidden">
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
/* Transição suave ao trocar de telas no menu principal */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>