// src/stores/useConfigStore.ts
import { defineStore } from 'pinia';
import { ref, watch, computed } from 'vue';
import { load } from '@tauri-apps/plugin-store';
import { emit } from '@tauri-apps/api/event';
import { ask } from '@tauri-apps/plugin-dialog';
import type { Store } from '@tauri-apps/plugin-store';

export const useConfigStore = defineStore('config', () => {
  // Estado que controla se o Modal está aberto
  const isDialogOpen = ref(false);
  const isLoaded = ref(false);

  let tauriStore: Store | null = null;

  const defaultSettings = {
    isDarkMode: false,
    // Telas e Mídia
    selectedMonitor: "",
    aspectRatio: '16:9',
    bgOpacity: 70,
    transitionType: 'none',
    width: 1920,
    height: 1080,

    customAspectW: 1920,
    customAspectH: 1080,


    // Palco e Transmissão
    stageMonitor: null,
    stageLayout: 'full',
    stageHighContrast: true,
    lowerThirds: false,
    chromaKey: 'none',

    // Bíblia
    bibleVersion: 'ACF (Almeida Corrigida e Fiel)',
    bibleLayout: 'bottom-right',
    showVerseNumbers: false,

    // useConfigStore.ts
    videoEngine: 'smart' as 'ffmpeg' | 'native' | 'hybrid' | 'smart',

    // Limites de Segurança (Safe Area)
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,

    // Produtividade
    activeTheme: 'Padrão'
  }

  const autoSave = ref(true)

  // As configurações globais do aplicativo
  const settings = ref({ ...defaultSettings });

  // 2. Salva no disco nativo toda vez que algo em settings mudar
  watch(
    settings,
    async (newSettings) => {
      if (!isLoaded.value || !tauriStore || !autoSave.value) return; // Só tenta salvar se o tauriStore já foi instanciado

      await tauriStore.set('app_config', newSettings);
      await tauriStore.save();
      await emit('update-settings')
      
    },
    { deep: true }
  );

  // Ações para manipular o modal
  const openDialog = () => isDialogOpen.value = true;
  const closeDialog = () => isDialogOpen.value = false;

  const loadSettings = async () => {
    try {
      // Inicia a store do Tauri v2
      tauriStore = await load('settings.json', { autoSave: false, defaults: { app_config: { ...defaultSettings } } });

      const savedConfig = await tauriStore.get<{ [key: string]: any }>('app_config');

      if (savedConfig) {
        settings.value = { ...defaultSettings, ...savedConfig };
      }
    } catch (error) {
      console.error("Erro ao carregar as configurações do disco:", error);
    } finally {
      isLoaded.value = true;
    }
  };

  // Ação de reset
  const resetToDefaults = async () => {
    const confirmed = await ask('Tem certeza que deseja restaurar para as configurações padrões?', {
      title: 'Confirmação',
      kind: 'warning',
      okLabel: 'Sim, restaurar',
      cancelLabel: 'Cancelar'
    });
    if (confirmed) {
      settings.value = { ...defaultSettings };
      return true
    } else { 
      return false
    }
  };

  const getTheme = () => {
    return settings.value.isDarkMode ? 'dark' : 'light'
  }

  const screenRatio = computed(() => {
    if (settings.value.aspectRatio === 'custom') {
      const w = settings.value.customAspectW || 1920;
      const h = settings.value.customAspectH || 1080;
      return w && h ? w / h : 16 / 9;
    }

    const aspectString = settings.value.aspectRatio || '16:9';

    // Divide a string onde tem ":" e transforma os pedaços em números
    const [w, h] = aspectString.split(':').map(Number);

    // Se a conversão der certo e a altura não for zero, retorna a divisão
    if (w && h && h !== 0) {
      return w / h;
    }

    // Fallback de segurança caso a string venha malformada
    return 16 / 9;
  });

  return {
    isDialogOpen,
    settings,
    autoSave,
    screenRatio,
    openDialog,
    closeDialog,
    loadSettings,
    resetToDefaults,
    getTheme
  };
});