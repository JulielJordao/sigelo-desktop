// src/stores/useConfigStore.ts
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { load } from '@tauri-apps/plugin-store';
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
    bgOpacity: 80,
    transitionType: 'fade',
    
    // Palco e Transmissão
    stageMonitor: null,
    stageLayout: 'full',
    stageHighContrast: true,
    lowerThirds: false,
    chromaKey: 'none',

    // Bíblia
    bibleVersion: 'NAA (Nova Almeida Atualizada)',
    bibleLayout: 'bottom-right',
    showVerseNumbers: false,

    // Limites de Segurança (Safe Area)
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,

    // Produtividade
    activeTheme: 'Padrão'
  }

  // As configurações globais do aplicativo
  const settings = ref({...defaultSettings});

  // 2. Salva no disco nativo toda vez que algo em settings mudar
  watch(
    settings, 
    async (newSettings) => {
      if (!isLoaded.value || !tauriStore) return; // Só tenta salvar se o tauriStore já foi instanciado
      
      await tauriStore.set('app_config', newSettings);
      await tauriStore.save(); 
    }, 
    { deep: true }
  );

  // Ações para manipular o modal
  const openDialog = () => isDialogOpen.value = true;
  const closeDialog = () => isDialogOpen.value = false;

  const loadSettings = async () => {
    try {
      // Inicia a store do Tauri v2
      tauriStore = await load('settings.json', { autoSave: false , defaults: { app_config: {...defaultSettings} }});
      
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
  const resetToDefaults = () => {
    if (confirm('Tem certeza que deseja restaurar todos os padrões? Você perderá ajustes não salvos.')) {
      settings.value = { ...defaultSettings };
    }
  };

  const getTheme = () => {
    return  settings.value.isDarkMode ? 'light': 'dark'
  }

  return { 
    isDialogOpen, 
    settings, 
    openDialog, 
    closeDialog, 
    loadSettings,
    resetToDefaults,
    getTheme
  };
});