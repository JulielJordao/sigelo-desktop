<script setup lang="ts">
import iconTheme from '../assets/icon_theme.svg';
import { ref, onMounted, computed, watch } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-shell';
import { useMenuStore } from '../stores/menuStore';
import { useUpdaterStore } from '../stores/updaterStore';

const menuStore = useMenuStore();
const updaterStore = useUpdaterStore();

const appVersion = ref('Carregando...');

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
});

const emit = defineEmits(['update:modelValue']);

const showAboutDialog = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

// Estados locais para feedback do botão
const checkingUpdate = ref(false);
const checkResultMessage = ref<string | null>(null);
const checkResultColor = ref<'success' | 'info' | 'error'>('info');
const showSnackbar = ref(false);

onMounted(async () => {
  try {
    appVersion.value = await getVersion();
  } catch (e) {
    appVersion.value = '0.9.1';
  }
});

const openContactPage = async () => {
  await open('https://sigelo.cloud/contact');
};

const checkForUpdates = async () => {
  if (checkingUpdate.value) return;

  checkingUpdate.value = true;
  checkResultMessage.value = null;

  // Reseta o "dismissed" para o aviso voltar a aparecer no header se houver update
  updaterStore.dismissed = false;

  try {
    await updaterStore.check();

    if (updaterStore.state === 'available' && updaterStore.update) {
      checkResultMessage.value = `Versão ${updaterStore.update.version} disponível!`;
      checkResultColor.value = 'success';
      showSnackbar.value = true;

      // Fecha o modal "Sobre" após 1s para dar destaque ao aviso no header
      setTimeout(() => {
        showAboutDialog.value = false;
      }, 1500);
    } else if (updaterStore.state === 'up-to-date') {
      checkResultMessage.value = 'Você já está na versão mais recente.';
      checkResultColor.value = 'info';
      showSnackbar.value = true;
    } else if (updaterStore.state === 'error') {
      checkResultMessage.value =
        updaterStore.error || 'Erro ao verificar atualização.';
      checkResultColor.value = 'error';
      showSnackbar.value = true;
    }
  } catch (e) {
    checkResultMessage.value =
      e instanceof Error ? e.message : 'Falha ao verificar atualização.';
    checkResultColor.value = 'error';
    showSnackbar.value = true;
  } finally {
    checkingUpdate.value = false;
  }
};

watch(showAboutDialog, () => {
  menuStore.setShiftShortcutLocked(showAboutDialog.value);
});
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
        <br /><br />
        <span class="text-caption text-grey-darken-1">
          <strong>Créditos de Terceiros:</strong><br>
          Processamento de mídia com tecnologia 
          <a href="#" @click.prevent="open('https://ffmpeg.org/')" 
          class="text-decoration-none text-primary font-weight-bold">FFmpeg</a>.
        </span>
      </div>

      <!-- Feedback inline opcional (alternativa ao snackbar) -->
      <v-alert
        v-if="checkResultMessage && !showSnackbar"
        :type="checkResultColor"
        variant="tonal"
        density="compact"
        class="mb-3 text-caption"
      >
        {{ checkResultMessage }}
      </v-alert>

      <div class="d-flex flex-column gap-3">
        <v-btn
          color="primary"
          variant="flat"
          block
          rounded="lg"
          :prepend-icon="checkingUpdate ? undefined : 'mdi-update'"
          :loading="checkingUpdate"
          :disabled="checkingUpdate"
          @click="checkForUpdates"
        >
          {{ checkingUpdate ? 'Verificando...' : 'Verificar Atualização' }}
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

    <!-- Snackbar global de resultado -->
    <v-snackbar
      v-model="showSnackbar"
      :color="checkResultColor"
      location="bottom"
      timeout="3500"
    >
      <div class="d-flex align-center">
        <v-icon class="mr-2">
          {{
            checkResultColor === 'success'
              ? 'mdi-check-circle'
              : checkResultColor === 'error'
              ? 'mdi-alert-circle'
              : 'mdi-information'
          }}
        </v-icon>
        {{ checkResultMessage }}
      </div>

      <template v-slot:actions>
        <v-btn variant="text" @click="showSnackbar = false">Fechar</v-btn>
      </template>
    </v-snackbar>
  </v-dialog>
</template>