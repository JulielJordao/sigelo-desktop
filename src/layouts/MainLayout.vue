<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import SettingsModal from '../components/config/SettingsModal.vue';
import { emit } from '@tauri-apps/api/event';
import BibleDrawer from '../components/bible/BibleDrawer.vue'; // <-- Importe o novo componente
// import { useConfigStore } from '../stores/useConfigStore';
import MediaSidebar from '../components/media/MediaSidebar.vue';

// Interface igual à do componente filho para manter a tipagem correta
interface MediaFile {
  name: string;
  path: string;
  url: string;
  isVideo: boolean;
}

// Estados locais para a interface de controle saber o que está ativo (opcional)
const currentPlaying = ref<MediaFile | null>(null);
const currentBackground = ref<MediaFile | null>(null);

// 1. Ação: Projetar Imediatamente
const handleProject = async (file: MediaFile) => {
  currentPlaying.value = file;
  
  try {
    // Dispara um evento global que a sua Janela de Projeção vai escutar
    await emit('update-projection', {
      action: 'play_media',
      payload: {
        url: file.url,
        isVideo: file.isVideo
      }
    });
    console.log("Comando de projeção enviado:", file.name);
  } catch (error) {
    console.error("Erro ao emitir projeção:", error);
  }
};

// 2. Ação: Fixar como Fundo
const handleSetFixedBackground = async (file: MediaFile) => {
  currentBackground.value = file;
  
  try {
    // Dispara um evento para a Janela de Projeção alterar o fundo base
    await emit('update-projection', {
      action: 'set_background',
      payload: {
        url: file.url,
        isVideo: file.isVideo
      }
    });
    console.log("Comando de fundo fixo enviado:", file.name);
  } catch (error) {
    console.error("Erro ao emitir fundo:", error);
  }
};

const router = useRouter();

const settingsModalRef = ref<any>(null);
const bibleDrawerRef = ref<any>(null); // <-- Ref para acessar o componente filho
const mediaSidebarRef = ref<any>(null); 

// const configStore = useConfigStore();

// Essa função agora chama o método open() exposto pelo BibleDrawer
const toggleBible = () => {
  bibleDrawerRef.value?.open();
  
  // Exemplo de como você poderia abri-lo já buscando um texto de outro lugar do app:
  // bibleDrawerRef.value?.open({ abbr: 'Rm', chapter: 3, verses: '10-12' });
};

const toogleMediaSidebar = () => {
  mediaSidebarRef.value?.open();
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
          color="primary"
        ></v-list-item>
        
        <v-list-item 
          prepend-icon="mdi-image-multiple" 
          title="Mídia / Imagens" 
          @click="toogleMediaSidebar"
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

    <v-main class="d-flex flex-column h-screen overflow-hidden">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </v-main>
    
    <SettingsModal ref="settingsModalRef" />
    <MediaSidebar 
        ref="mediaSidebarRef"
        @project="(file) => handleProject(file)" 
        @setFixed="(file) => handleSetFixedBackground(file)" 
      />
    
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