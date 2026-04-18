<script setup lang="ts">
import iconTheme from '../assets/icon_theme.svg'
import { ref, onMounted, computed, watch } from 'vue';
// Importe as dependências que você já tem (menuStore, youtubeStore, etc...)

// APIs Nativas do Tauri para versão e links externos
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-shell';
// import { check } from '@tauri-apps/plugin-updater'; // Caso use o plugin de auto-update do Tauri no futuro

import { useMenuStore } from '../stores/menuStore';

const menuStore = useMenuStore()
const appVersion = ref('Carregando...');

const props = defineProps({
    modelValue: {
        type: Boolean,
        required: true
    }
})

const showAboutDialog = computed({
    get: () => props.modelValue,
    set: (value) => emit('update:modelValue', value)
})

const emit = defineEmits(['update:modelValue'])

// Pega a versão real configurada no tauri.conf.json
onMounted(async () => {
  try {
    appVersion.value = await getVersion();
  } catch (e) {
    appVersion.value = '0.8.17';
  }
});

const openContactPage = async () => {
  // O Tauri abre o link no navegador padrão do usuário (Chrome/Safari)
  await open('https://sigelo.cloud/contact');
};

const checkForUpdates = async () => {
  // Lógica de update. Se usar o plugin oficial do Tauri, seria algo como:
  // const update = await check();
  // if (update) await update.downloadAndInstall();
  
  // Por enquanto, você pode redirecionar para a página de downloads:
  //await open('https://sigelo.cloud/downloads');
};

watch(showAboutDialog, () => {
  menuStore.setShiftShortcutLocked(showAboutDialog.value)
})
</script>

<template>
  <v-dialog v-model="showAboutDialog" max-width="360" transition="dialog-bottom-transition">
    <v-card class="rounded-xl pa-6 border text-center" elevation="24">
      
      <v-avatar size="100" class="mx-auto border bg-grey-lighten-4">
        <v-img :src="iconTheme" alt="Sigelo Logo" class="pa-2"></v-img>
      </v-avatar>
      <h2 class="text-h5 font-weight-black tracking-tight">Sigelo</h2>
      <v-chip size="small" color="primary" variant="flat" class="mb-2 font-weight-bold">
        Versão {{ appVersion }}
      </v-chip>

      <v-divider class="mb-4 opacity-50"></v-divider>

      <div class="text-body-2 text-grey-darken-2 mb-6 px-4">
        Sistema de Projeção Multimídia.
        <br><br>
        <span class="text-caption text-grey-darken-1">
          <strong>Créditos de Terceiros:</strong><br>
          Processamento de mídia com tecnologia <a href="#" @click.prevent="open('https://ffmpeg.org/')" class="text-decoration-none text-primary font-weight-bold">FFmpeg</a>.
        </span>
      </div>

      <div class="d-flex flex-column gap-3">
        <v-btn 
          color="primary" 
          variant="flat" 
          block 
          rounded="lg" 
          prepend-icon="mdi-update"
          @click="checkForUpdates"
        >
          Verificar Atualização
        </v-btn>
        
        <v-btn 
          color="grey-darken-3 mt-2" 
          variant="tonal" 
          block 
          rounded="lg" 
          prepend-icon="mdi-message-outline"
          @click="openContactPage"
        >
          Página de Contato
        </v-btn>
      </div>

    </v-card>
  </v-dialog>

</template>