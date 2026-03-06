// src/stores/useConfigStore.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useConfigStore = defineStore('config', () => {
  // Estado que controla se o Modal está aberto
  const isDialogOpen = ref(false);

  // As configurações globais do aplicativo
  const settings = ref({
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
  });

  // Ações para manipular o modal
  const openDialog = () => isDialogOpen.value = true;
  const closeDialog = () => isDialogOpen.value = false;

  // Ação de reset
  const resetToDefaults = () => {
    if (confirm('Tem certeza que deseja restaurar todos os padrões? Você perderá ajustes não salvos.')) {
      settings.value.aspectRatio = '16:9';
      settings.value.bgOpacity = 100;
      settings.value.transitionType = 'fade';
      settings.value.activeTheme = 'Padrão';
    }
  };

  return { 
    isDialogOpen, 
    settings, 
    openDialog, 
    closeDialog, 
    resetToDefaults 
  };
});