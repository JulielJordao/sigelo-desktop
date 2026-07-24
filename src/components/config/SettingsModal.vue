<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useConfigStore } from '../../stores/useConfigStore';
import { invoke } from '@tauri-apps/api/core';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { mkdir, exists } from '@tauri-apps/plugin-fs';
import { useTheme } from 'vuetify';
import { usePresentationStore } from '../../stores/usePresentationStore';
import { useMenuStore } from '../../stores/menuStore';
import { emitTo } from '@tauri-apps/api/event';
import type { StageChordRenderMode } from '../../premium-modules/stage-monitor/utils/chordProStage';

const presentationStore = usePresentationStore()
const theme = useTheme();

const configStore = useConfigStore();
const { isDialogOpen, settings } = storeToRefs(configStore);
const menuStore = useMenuStore()

const toggleTheme = () => {
  localSettings.value.isDarkMode = !localSettings.value.isDarkMode
  configStore.settings.isDarkMode = localSettings.value.isDarkMode
  theme.change(configStore.getTheme())
};

const isOpening = ref(false)

// --- ESTADO LOCAL (SNAPSHOT) ---
// Inicializa com uma cópia vazia ou com os dados atuais para evitar erros de renderização
const localSettings = ref(JSON.parse(JSON.stringify(configStore.settings)));

// --- ESTADOS DO MODAL ---
const activeTab = ref('midia');
const isLoadingMonitors = ref(false);

interface MonitorInfo {
  name: string;
  width: number;
  height: number;
  is_primary: boolean;
}

const listMonitor = ref<MonitorInfo[]>([])

// Lista reativa de monitores
const availableMonitors = ref<{ title: string, value: string }[]>([]);

// Referências para os caminhos das pastas
const mediaFolderPath = ref('');
const cacheFolderPath = ref('');

// --- OPÇÕES ESTÁTICAS PARA OS SELECTS ---
const aspectOptions = [
  { title: '16:9 (Widescreen - Padrão)', value: '16:9' },
  { title: '4:3 (Projetores Antigos)', value: '4:3' },
  { title: 'Livre / Customizado', value: 'custom' }
];

const transitionOptions = [
  { title: 'Esmaecimento (Fade)', value: 'fade' },
  { title: 'Corte Seco (Sem animação)', value: 'none' },
  { title: 'Deslizar Vertical', value: 'slide' },
  { title: 'Deslizar Horizontal', value: 'slide-h' },
  { title: 'Zoom Suave', value: 'zoom' },
  { title: 'Desfoque (Blur)', value: 'blur' },
  { title: 'Subida Suave', value: 'rise' }
];

const themeOptions = <string[]>[];

const bibleVersions = ['ACF (Almeida Corrigida e Fiel)'
  //,'NAA (Nova Almeida Atualizada)', 'NVI (Nova Versão Internacional)', 'ARC (Almeida Revista e Corrigida)'
];

const bibleLayouts = [
  { title: 'Referência Acima do Texto', value: 'top' },
  { title: 'Referência Abaixo (Direita)', value: 'bottom-right' },
  { title: 'Ocultar Referência', value: 'hidden' }
];

// --- INTEGRAÇÃO COM TAURI (MONITORES) ---
const fetchMonitors = async () => {
  isLoadingMonitors.value = true;
  try {
    const monitors = await invoke<MonitorInfo[]>('get_monitors');
    listMonitor.value = monitors;
    availableMonitors.value = monitors.map(m => ({
      title: `${m.name} (${m.width}x${m.height})${m.is_primary ? ' - Principal' : ''}`,
      value: m.name
    }));
  } catch (error) {
    console.error("Erro ao buscar monitores:", error);
  } finally {
    isLoadingMonitors.value = false;
  }
};

const autoDetectProjector = async () => {
  try {
    const bestMonitor = await invoke<MonitorInfo | null>('detect_projector_cmd');
    if (bestMonitor) {
      localSettings.value.selectedMonitor = bestMonitor.name;
    } else {
      alert("Nenhum projetor ou tela secundária foi identificado.");
    }
  } catch (error) {
    console.error("Erro ao detectar projetor:", error);
  }
};

// Armazenamento

// --- ESTADOS DE ARMAZENAMENTO ---
const storageStats = ref({
  mediaSize: 'Calculando...',
  cacheSize: 'Calculando...'
});

// Funções de interação com o sistema de arquivos (via Tauri)
const openMediaFolder = async () => {
  try {
    // No futuro, isso chamará o Rust para abrir a pasta nativa no Mac/Windows
    // await invoke('open_media_folder_cmd');
    await invoke('open_folder_native', { path: mediaFolderPath.value });
  } catch (error) {
    console.error("Erro ao tentar abrir pasta:", error);
  }
};

// Função utilitária para formatar bytes em MB/GB
const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Busca os tamanhos invocando o Rust
const loadStats = async () => {
  try {
    const mediaBytes = await invoke('get_dir_size', { path: mediaFolderPath.value });
    const cacheBytes = await invoke('get_dir_size', { path: cacheFolderPath.value });

    storageStats.value = {
      mediaSize: formatBytes(mediaBytes as number),
      cacheSize: formatBytes(cacheBytes as number)
    };
  } catch (error) {
    console.error("Erro ao carregar tamanhos:", error);
    storageStats.value.mediaSize = 'Erro';
    storageStats.value.cacheSize = 'Erro';
  }
};

// Limpa o cache invocando o comando Rust
const clearCache = async () => {
  try {
    // Você pode querer adicionar um v-dialog de confirmação aqui no futuro
    storageStats.value.cacheSize = 'Limpando...';
    await invoke('clear_directory', { path: cacheFolderPath.value });
    await loadStats(); // Recalcula o tamanho após limpar
  } catch (error) {
    console.error("Erro ao limpar cache:", error);
  }
};

// Inicializa os caminhos e garante que as pastas existem
const setupFolders = async () => {
  try {
    const baseDir = await appLocalDataDir();

    // Define os caminhos
    mediaFolderPath.value = await join(baseDir, 'media');
    cacheFolderPath.value = await join(baseDir, 'cache');
    // Nossas novas subpastas!
    const slidesFolder = await join(mediaFolderPath.value, 'slides');
    const reproductionFolder = await join(mediaFolderPath.value, 'reproducao');

    // Cria as pastas recursivamente (o recursive: true já cria a pasta 'media' pai se faltar)
    if (!(await exists(slidesFolder))) await mkdir(slidesFolder, { recursive: true });
    if (!(await exists(reproductionFolder))) await mkdir(reproductionFolder, { recursive: true });
    if (!(await exists(cacheFolderPath.value))) await mkdir(cacheFolderPath.value, { recursive: true });

    await loadStats();
  } catch (error) {
    console.error("Erro ao configurar pastas:", error);
  }
};

const openDialog = () => {
  isOpening.value = true
  localSettings.value = JSON.parse(JSON.stringify(configStore.settings));
  setupFolders();
  isDialogOpen.value = true;
  fetchMonitors();
}

const saveAndClose = () => {
  const monitor = listMonitor.value.find(it => localSettings.value.selectedMonitor.includes(it.name))

  if (monitor?.width && monitor?.height) {
    localSettings.value.height = monitor.height
    localSettings.value.width = monitor.width
  }

  // 2. Transfere os dados locais para a Store Global (O que vai ativar o watch e salvar no Tauri)
  Object.assign(configStore.settings, localSettings.value);

  // 3. Fecha o modal
  configStore.closeDialog();
}

const listShortcuts = [
  { label: "Avançar / Voltar Slide", keys: "Setas (← / →)" },
  { label: "Pesquisa rápida de músicas", keys: "Shift + F" },
  { label: "Abertura rápida da bíblia", keys: "Shift + B" },
  { label: "Projetar Letra", keys: "F5" },
  { label: "Projetar Letra do Início", keys: "Shift + F5" },
  { label: "Minimizar/Maximizar Tela de Projeção", keys: "CTRL + F" },
  { label: "Finalizar Apresentação", keys: "Esc" },


  // { label: "Limpar Fundo", keys: "F2"},
  //{ label: "Tela Preta", keys: "F3"},
  //{ label: "Exibir Logo", keys: "F4"},
]

// ─── Toggle de visualização (simplificado/completo) ────────────────────────
const isStageLayoutSimplified = ref(true);

// ─── Dados dos layouts ──────────────────────────────────────────────────────
const stageLayoutOptions = [
  {
    value: 'full',
    title: 'Completo',
    description: 'Slide atual grande + preview do próximo + relógio. Layout balanceado para uso geral.',
    bestFor: 'Uso geral',
    icon: 'mdi-view-sequential',
    color: 'blue',
    features: ['Slide atual', 'Próximo', 'Relógio'],
  },
  {
    value: 'current_only',
    title: 'Slide Atual',
    description: 'Só o slide atual em texto enorme, sem distrações.',
    bestFor: 'Palco distante',
    icon: 'mdi-magnify',
    color: 'indigo',
    features: ['Texto grande', 'Sem preview'],
  },
  {
    value: 'scrolling',
    title: 'Teleprompter',
    description: 'Texto contínuo rolando conforme avança.',
    bestFor: 'Leitura longa',
    icon: 'mdi-text-long',
    color: 'green',
    features: ['Auto-scroll', 'Histórico'],
  },
  {
    value: 'preacher',
    title: 'Pregador',
    description: 'Slide + relógio + cronômetro de fala + notas.',
    bestFor: 'Pregador',
    icon: 'mdi-podium',
    color: 'amber',
    features: ['Notas', 'Cronômetro', 'Próximo'],
  },
  {
    value: 'musician',
    title: 'Músico',
    description: 'Letra atual + próximas 2 linhas + info musical.',
    bestFor: 'Banda',
    icon: 'mdi-music',
    color: 'purple',
    features: ['Tom', 'BPM', 'Capo'],
  },
  {
    value: 'countdown',
    title: 'Cronômetro',
    description: 'Timer gigante no centro da tela.',
    bestFor: 'Contagem',
    icon: 'mdi-timer-sand',
    color: 'red',
    features: ['Timer grande', 'Slide pequeno'],
  },
  {
    value: 'clock_focus',
    title: 'Relógio',
    description: 'Relógio analógico + digital gigante.',
    bestFor: 'Transmissão',
    icon: 'mdi-clock-outline',
    color: 'blue-grey',
    features: ['Analógico', 'Digital'],
  },
  {
    value: 'split_verse',
    title: 'Contexto',
    description: 'Versículo atual + anterior e posterior em cinza.',
    bestFor: 'Bíblia',
    icon: 'mdi-book-open-variant',
    color: 'teal',
    features: ['Anterior', 'Atual', 'Próximo'],
  },
  {
    value: 'notes_only',
    title: 'Notas',
    description: 'Só o roteiro/notas do pregador.',
    bestFor: 'Roteiro',
    icon: 'mdi-text-box',
    color: 'orange',
    features: ['Texto grande', 'Sem slide'],
  },
  {
    value: 'media_info',
    title: 'Mídia',
    description: 'Nome, tempo e barra de progresso enorme.',
    bestFor: 'Vídeos',
    icon: 'mdi-filmstrip',
    color: 'cyan',
    features: ['Progresso', 'Tempo restante'],
  },
  {
    value: 'chordpro',
    title: 'Cifra',
    description: 'Letra + acordes com transposição e auto-scroll.',
    bestFor: 'Banda',
    icon: 'mdi-music-clef-treble',
    color: 'deep-purple',
    features: ['Transposição', 'Auto-scroll', 'BPM'],
  },
];

// ─── Handlers ───────────────────────────────────────────────────────────────
function onStageLayoutSelect(layout: string) {
    // Atualiza o localSettings ANTES de emitir
    localSettings.value.stageLayout = layout;
  
    // Emite pro monitor de palco
    emitTo('stage', 'update-stage-layout', layout);
  
    // Fecha o modal de seleção (se estiver usando)
    isLayoutModalOpen.value = false;
}

function onChordModeSelect(mode: StageChordRenderMode) {
  // Atualiza o localSettings ANTES de emitir
  localSettings.value.chordRenderMode = mode;
  
  // Emite pro monitor de palco
  emitTo('stage', 'stage-chord-mode', mode);
}

onMounted(async () => {
  await presentationStore.loadPresets()
  //presentationStore.presets.forEach(it => themeOptions.push(it.name))
})

// Observa a opção de proporção e o monitor selecionado para sugerir a resolução
watch(
  () => [localSettings.value.aspectRatio, localSettings.value.selectedMonitor],
  ([newAspect, newMonitor]) => {
    console.log("watch")
    if (newAspect === 'custom' && !isOpening.value) {
      // Busca o monitor atual selecionado na lista devolvida pelo Tauri
      const monitor = listMonitor.value.find(it => it.name.includes(newMonitor))

      if (monitor && monitor.width && monitor.height) {
        localSettings.value.customAspectW = monitor.width;
        localSettings.value.customAspectH = monitor.height;

      } else if (!localSettings.value.customAspectW) {
        // Fallback de segurança se falhar a detecção
        localSettings.value.customAspectW = 1920;
        localSettings.value.customAspectH = 1080;
      }
    }
    isOpening.value = false
  }
);


defineExpose({ openDialog })

watch(isDialogOpen, () => {
  menuStore.setShiftShortcutLocked(isDialogOpen.value)
})

const resetToDefaults = async () => {
  const confirmed = await configStore.resetToDefaults()
  if (confirmed) {
    localSettings.value = JSON.parse(JSON.stringify(configStore.settings));

    theme.change(configStore.getTheme())
  }
}

const isSimplified = ref(true)
const isLayoutModalOpen = ref(false)
const isTutorialModalOpen = ref(false)
const currentLayoutInfo = ref<{
  title: string | null;
  icon: string | null;
  description: string | null;
}>({
  title: null,
  icon: null,
  description: null
});

watch(
  () => localSettings.value.stageLayout,
  (newLayout) => {
    const layout = stageLayoutOptions.find(l => l.value === newLayout);
    if (layout) {
      currentLayoutInfo.value = {
        title: layout.title,
        icon: layout.icon,
        description: layout.description
      };
    }
  },
  { immediate: true } // Executa imediatamente ao carregar os dados
);

watch(
  () => localSettings.value.stageMonitorEnabled,
  async (enabled) => {
    if (enabled) {
      // Abre a janela de palco via Tauri
      try {
        await invoke('prepare_projection_window', { 
          targetMonitor: localSettings.value.stageMonitor || 'stage',
          windowLabel: 'stage'
        });
        
        // Envia configurações iniciais
        setTimeout(() => {
          emitTo('stage', 'update-stage-layout', localSettings.value.stageLayout);
          emitTo('stage', 'stage-chord-mode', localSettings.value.chordRenderMode);
        }, 500); // Delay pra garantir que a janela está pronta
      } catch (error) {
        console.error('Erro ao abrir monitor de palco:', error);
        // Reverte o toggle se falhar
        localSettings.value.stageMonitorEnabled = false;
      }
    } else {
      // Fecha a janela de palco via Tauri
      try {
        await invoke('close_stage_window');
      } catch (error) {
        console.error('Erro ao fechar monitor de palco:', error);
      }
    }
  }
);

const engineOptions = [
  {
    value: 'ffmpeg',
    title: 'FFmpeg',
    icon: 'mdi-cpu-64-bit',
    chipText: 'Mais compatível',
    chipColor: 'green',
    description: 'Ideal para <strong>computadores modestos</strong> e arquivos incomuns (ProRes, MKV, HEVC).',
    features: [
      { text: '✓ ProRes / MKV', color: '' },
      { text: '~ Delay na Busca', color: 'warning' }
    ]
  },
  {
    value: 'native',
    title: 'Nativo',
    icon: 'mdi-lightning-bolt',
    chipText: 'Suave',
    chipColor: 'blue',
    description: 'Usa o player do sistema. Modo Busca <strong>instantâneo</strong>, porém exige mais do hardware (CPU/GPU).',
    features: [
      { text: '✓ MP4 / H.264', color: '' },
      { text: '✓ Suave ao vivo', color: 'success' },
      { text: '⚠ Consumo Elevado', color: 'orange' } // Adicionado o aviso de peso
    ]
  },
  {
    value: 'hybrid',
    title: 'Híbrido',
    icon: 'mdi-scale-balance',
    chipText: 'Equilíbrio',
    chipColor: 'purple',
    description: 'MP4 via Nativo, demais via FFmpeg.',
    features: [
      { text: '✓ MP4 → nativo', color: 'success' },
      { text: '✓ Outros → FFmpeg', color: '' }
    ]
  },
  {
    value: 'smart',
    title: 'Inteligente',
    icon: 'mdi-brain',
    chipText: 'Recomendado',
    chipColor: 'primary',
    description: 'Detecta automaticamente a melhor rota para o codec.',
    features: [
      { text: '✓ Fallback Auto', color: 'success' },
      { text: '★ Recomendado', color: 'primary' }
    ]
  }
]

</script>

<template>
  <v-dialog v-model="isDialogOpen" max-width="850" transition="dialog-bottom-transition">
    <v-card class="rounded-lg bg-surface d-flex flex-column" style="max-height: 90vh;">

      <v-toolbar color="surface" density="compact" class="border-b flex-shrink-0" elevation="0">
        <v-icon class="ml-4" color="primary">mdi-cog-outline</v-icon>
        <v-toolbar-title class="text-subtitle-1 font-weight-bold ml-2">Configurações do Sistema</v-toolbar-title>

        <v-spacer></v-spacer>

        <v-btn icon variant="text" @click="toggleTheme" class="mr-1" title="Alternar Tema">
          <v-scale-transition mode="out-in">
            <v-icon :key="localSettings.isDarkMode"
              :color="!localSettings.isDarkMode ? 'amber-lighten-1' : 'amber-darken-4'">
              {{ localSettings.isDarkMode ? 'mdi-weather-night' : 'mdi-white-balance-sunny' }}
            </v-icon>
          </v-scale-transition>
        </v-btn>

        <v-btn icon="mdi-close" variant="text" @click="configStore.closeDialog"></v-btn>
      </v-toolbar>

      <v-tabs v-model="activeTab" color="primary" class="border-b bg-surface-light flex-shrink-0" show-arrows>
        <v-tab value="midia"><v-icon start>mdi-monitor-dashboard</v-icon> Telas</v-tab>
        <v-tab value="transmissao"><v-icon start>mdi-broadcast</v-icon> Palco e Transmissão</v-tab>
        <v-tab value="biblia"><v-icon start>mdi-book-open-variant</v-icon> Bíblia</v-tab>
        <v-tab value="avancado"><v-icon start>mdi-tune</v-icon> Limites e Atalhos</v-tab>
        <v-tab value="armazenamento"><v-icon start>mdi-harddisk</v-icon> Armazenamento</v-tab>
        <v-tab value="produtividade"><v-icon start>mdi-lightning-bolt</v-icon> Produtividade</v-tab>
      </v-tabs>

      <v-card-text class="pa-0 overflow-y-auto flex-grow-1">
        <v-window v-model="activeTab">

          <v-window-item value="midia" class="pa-6">
            <p class="text-body-2 text-medium-emphasis mb-6">Configure os monitores de saída e o comportamento da tela
              de projeção.</p>

            <v-card variant="outlined" color="surface-variant" class="pa-4 rounded-lg mb-6">
              <h3 class="text-subtitle-1 font-weight-bold mb-2 d-flex align-center">
                <v-icon size="20" class="mr-2 text-primary">mdi-projector</v-icon> Saída de Projeção
              </h3>
              <v-row class="mt-1 align-center">
                <v-col cols="12" sm="8">
                  <v-select v-model="localSettings.selectedMonitor" :items="availableMonitors"
                    :loading="isLoadingMonitors" label="Selecione o Projetor/Tela" variant="outlined"
                    density="comfortable" prepend-inner-icon="mdi-monitor" hide-details></v-select>
                </v-col>
                <v-col cols="12" sm="4">
                  <v-btn color="primary" variant="tonal" class="w-100 h-100" style="min-height: 48px;"
                    @click="autoDetectProjector">Auto Detectar</v-btn>
                </v-col>
              </v-row>
            </v-card>

            <v-row>
              <v-col cols="12" md="6">
                <v-select v-model="localSettings.aspectRatio" :items="aspectOptions"
                  label="Proporção do Telão (Aspect Ratio)" variant="outlined" density="comfortable"
                  prepend-inner-icon="mdi-aspect-ratio" hide-details class="mb-4"></v-select>
              </v-col>
              <v-col cols="12" md="6">
                <v-select v-model="localSettings.transitionType" :items="transitionOptions"
                  label="Transição entre Slides" variant="outlined" density="comfortable"
                  prepend-inner-icon="mdi-transition" hide-details class="mb-4"></v-select>
              </v-col>
            </v-row>

            <v-expand-transition>
              <div v-if="localSettings.aspectRatio === 'custom'" class="mb-4">
                <v-card variant="tonal" color="primary" class="pa-3 rounded-lg border">
                  <p class="text-caption font-weight-bold mb-2 ml-1">Definir Proporção Manual</p>
                  <div class="d-flex align-center">
                    <v-text-field v-model.number="localSettings.customAspectW" type="number" label="Largura"
                      variant="solo-filled" density="compact" hide-details class="flex-grow-1"></v-text-field>

                    <v-icon class="mx-3" color="primary">mdi-close</v-icon>

                    <v-text-field v-model.number="localSettings.customAspectH" type="number" label="Altura"
                      variant="solo-filled" density="compact" hide-details class="flex-grow-1"></v-text-field>
                  </div>
                  <p class="text-caption mt-2 mb-0 ml-1 opacity-70">
                    * Sugerimos não distorcer muito a relação para que os textos não fiquem achatados.
                  </p>
                </v-card>
              </div>
            </v-expand-transition>

            <v-card variant="tonal" class="pa-4 rounded-lg mt-2">
              <p class="text-subtitle-2 font-weight-bold mb-2">Filtro Escurecedor de Fundo</p>
              <p class="text-caption mb-2">Ajuda a destacar o texto escurecendo imagens/vídeos de fundo.</p>
              <v-slider v-model="localSettings.bgOpacity" min="0" max="100" step="5" thumb-label color="primary"
                prepend-icon="mdi-brightness-6" hide-details>
                <template v-slot:append><span class="text-caption font-weight-bold" style="width: 40px">{{
                  settings.bgOpacity }}%</span></template>
              </v-slider>
            </v-card>
          </v-window-item>

          <v-window-item value="transmissao" class="pa-4">

            <v-card variant="outlined" class="rounded-lg mb-4 w-100 px-4 py-2">
              <v-row density="compact" align="center">
                <v-col cols="12" md="4" class="d-flex align-center">
                  <v-switch v-model="localSettings.stageMonitorEnabled" color="primary" label="Ativar Monitor de Palco"
                    density="compact" hide-details>
                  </v-switch>
                </v-col>

                <v-col cols="12" md="4" class="d-flex align-center">
                  <v-switch v-model="localSettings.stageHighContrast" color="primary"
                    label="Alto Contraste (Fundo Preto/Amarelo)" density="compact" hide-details>
                  </v-switch>
                </v-col>

                <v-col cols="12" md="4">
                  <v-select v-model="localSettings.stageMonitor" :items="availableMonitors" label="Tela do Retorno"
                    variant="outlined" density="compact" hide-details :disabled="!localSettings.stageMonitorEnabled">
                  </v-select>
                </v-col>
              </v-row>
            </v-card>

            <v-card variant="outlined" class="rounded-lg mb-4 w-100 border-primary"
              style="border-width: 2px !important;">
              <div class="px-4 py-3 d-flex align-center bg-surface-light">
                <v-icon color="primary" class="mr-2" size="20">mdi-monitor-speaker</v-icon>
                <span class="text-subtitle-2 font-weight-bold">Layout do Retorno Ativo</span>

                <v-spacer></v-spacer>

                <v-btn color="primary" variant="flat" size="small" prepend-icon="mdi-swap-horizontal"
                  @click="isLayoutModalOpen = true">
                  Alterar Layout
                </v-btn>
              </div>

              <div class="pa-4 d-flex align-center">
                <v-avatar color="primary" variant="tonal" rounded size="48" class="mr-4">
                  <v-icon size="24">{{ currentLayoutInfo?.icon || 'mdi-view-dashboard' }}</v-icon>
                </v-avatar>
                <div>
                  <div class="text-subtitle-1 font-weight-bold">{{ currentLayoutInfo?.title || 'Layout Padrão' }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ currentLayoutInfo?.description || 'Layout selecionado para exibição no monitor de palco.' }}
                  </div>
                </div>
              </div>
            </v-card>

            <v-row>
              <v-col cols="12" md="6" class="d-flex">
                <v-card variant="outlined" class="rounded-lg w-100 d-flex flex-column">
                  <div class="px-3 py-3 d-flex align-center border-b bg-surface-light">
                    <v-icon color="primary" class="mr-2" size="20">mdi-music-clef-treble</v-icon>
                    <span class="text-subtitle-2 font-weight-bold">Renderização de Cifra</span>
                  </div>

                  <div class="pa-4 flex-grow-1 d-flex flex-column justify-center align-center">
                    <p class="text-caption text-medium-emphasis mb-3 text-center">
                      Escolha como cifras (.cho) aparecem no monitor.
                    </p>

                    <v-btn-toggle v-model="localSettings.chordRenderMode" color="primary" variant="outlined" mandatory
                      divided>

                      <v-tooltip location="bottom">
                        <template v-slot:activator="{ props }">
                          <v-btn v-bind="props" value="separate" @click="onChordModeSelect('separate')">
                            <v-icon start>mdi-format-line-spacing</v-icon>
                            Separado
                          </v-btn>
                        </template>
                        <div class="text-caption">
                          <strong>Padrão:</strong> Acorde em cima, letra embaixo.<br>Alinhamento monoespaçado perfeito.
                        </div>
                      </v-tooltip>

                      <v-tooltip location="bottom">
                        <template v-slot:activator="{ props }">
                          <v-btn v-bind="props" value="inline" @click="onChordModeSelect('inline')">
                            <v-icon start>mdi-format-text</v-icon>
                            Inline
                          </v-btn>
                        </template>
                        <div class="text-caption">
                          <strong>Compacto:</strong> Acorde na mesma linha da letra.<br>Ideal para telas menores.
                        </div>
                      </v-tooltip>

                    </v-btn-toggle>
                  </div>
                </v-card>
              </v-col>

              <v-col cols="12" md="6" class="d-flex">
                <v-card variant="outlined" class="rounded-lg w-100 d-flex flex-column">
                  <div class="px-3 py-3 d-flex align-center border-b bg-surface-light">
                    <v-icon color="primary" class="mr-2" size="20">mdi-video-wireless</v-icon>
                    <span class="text-subtitle-2 font-weight-bold">Integração OBS / vMix</span>

                    <v-spacer></v-spacer>

                    <v-tooltip location="bottom" max-width="350">
                      <template v-slot:activator="{ props }">
                        <v-icon v-bind="props" size="20" color="medium-emphasis" class="cursor-help">
                          mdi-help-circle-outline
                        </v-icon>
                      </template>
                      <div class="text-caption pa-1">
                        <strong>Modo Lower Thirds:</strong> Empurra o texto para a parte inferior da tela (máx 2 linhas)
                        para
                        sobrepor com câmera.<br><br>
                        <strong>Chroma Key:</strong> Remove o fundo selecionado no OBS/vMix, deixando apenas o texto.
                      </div>
                    </v-tooltip>
                  </div>

                  <div class="pa-4 flex-grow-1 d-flex flex-column justify-space-between">
                    <div>
                      <v-switch v-model="localSettings.lowerThirds" color="primary" label="Modo Lower Thirds (Rodapé)"
                        density="compact" hide-details class="mb-3">
                      </v-switch>

                      <div class="d-flex align-center mb-4">
                        <span class="text-caption font-weight-bold mr-3">Chroma Key:</span>
                        <v-btn-toggle v-model="localSettings.chromaKey" color="primary" variant="outlined" divided
                          density="compact">
                          <v-btn value="none" size="small">Off</v-btn>
                          <v-btn value="#00FF00" color="green" size="small">Verde</v-btn>
                          <v-btn value="#0000FF" color="blue" size="small">Azul</v-btn>
                        </v-btn-toggle>
                      </div>
                    </div>

                    <v-btn variant="tonal" color="primary" size="small" prepend-icon="mdi-lightbulb-on"
                      @click="isTutorialModalOpen = true">
                      Ver Guias de Configuração
                    </v-btn>
                  </div>
                </v-card>
              </v-col>
            </v-row>

            <v-dialog v-model="isLayoutModalOpen" max-width="900" scrollable>
              <v-card rounded="lg">
                <div class="px-4 py-3 d-flex align-center bg-surface-light border-b">
                  <v-icon color="primary" class="mr-2" size="24">mdi-view-grid</v-icon>
                  <span class="text-h6 font-weight-bold">Escolher Layout de Palco</span>
                  <v-spacer></v-spacer>
                  <v-btn-toggle v-model="isStageLayoutSimplified" mandatory density="compact" variant="outlined"
                    selected-class="text-primary" class="mr-4" style="height: 32px;">
                    <v-btn :value="true" size="small"><v-icon start>mdi-view-compact-outline</v-icon>
                      Simplificado</v-btn>
                    <v-btn :value="false" size="small"><v-icon start>mdi-view-dashboard-outline</v-icon>
                      Completo</v-btn>
                  </v-btn-toggle>
                  <v-btn icon="mdi-close" variant="text" density="comfortable"
                    @click="isLayoutModalOpen = false"></v-btn>
                </div>

                <v-card-text class="pa-4 bg-background">
                  <v-row density="comfortable">
                    <v-col v-for="layout in stageLayoutOptions" :key="layout.value" cols="12"
                      :sm="isStageLayoutSimplified ? 3 : 6" :md="isStageLayoutSimplified ? 3 : 4">
                      <v-tooltip :disabled="!isStageLayoutSimplified" location="bottom" max-width="320">
                        <template v-slot:activator="{ props: tooltipProps }">
                          <v-card v-bind="tooltipProps"
                            :variant="localSettings.stageLayout === layout.value ? 'tonal' : 'outlined'"
                            :color="localSettings.stageLayout === layout.value ? 'primary' : undefined"
                            class="pa-3 rounded-lg cursor-pointer transition-swing h-100"
                            :class="{ 'border-primary border-opacity-100': localSettings.stageLayout === layout.value }"
                            @click="onStageLayoutSelect(layout.value)" style="border-width: 2px !important;">
                            <div class="d-flex align-center" :class="{ 'mb-2': !isStageLayoutSimplified }">
                              <v-icon size="20" class="mr-2"
                                :color="localSettings.stageLayout === layout.value ? 'primary' : layout.color">
                                {{ layout.icon }}
                              </v-icon>
                              <span class="text-subtitle-2 font-weight-bold">{{ layout.title }}</span>
                              <v-spacer v-if="!isStageLayoutSimplified"></v-spacer>
                              <v-chip v-if="!isStageLayoutSimplified" size="x-small" :color="layout.color"
                                variant="tonal">
                                {{ layout.bestFor }}
                              </v-chip>
                            </div>

                            <v-expand-transition>
                              <div v-if="!isStageLayoutSimplified">
                                <p class="text-caption text-medium-emphasis mb-2">
                                  {{ layout.description }}
                                </p>
                                <div v-if="layout.features" class="d-flex flex-wrap gap-1">
                                  <v-chip v-for="feat in layout.features" :key="feat" size="x-small" color="grey"
                                    variant="outlined">
                                    {{ feat }}
                                  </v-chip>
                                </div>
                              </div>
                            </v-expand-transition>
                          </v-card>
                        </template>
                        <div class="pa-1">
                          <div class="font-weight-bold mb-1">{{ layout.title }}</div>
                          <div class="text-caption">{{ layout.description }}</div>
                        </div>
                      </v-tooltip>
                    </v-col>
                  </v-row>
                </v-card-text>
                <v-card-actions class="px-4 py-3 border-t">
                  <v-spacer></v-spacer>
                </v-card-actions>
              </v-card>
            </v-dialog>

            <v-dialog v-model="isTutorialModalOpen" max-width="800" scrollable>
              <v-card rounded="lg">
                <div class="px-4 py-3 d-flex align-center bg-surface-light border-b">
                  <v-icon color="primary" class="mr-2" size="24">mdi-lightbulb-on</v-icon>
                  <span class="text-h6 font-weight-bold">Guias e Tutoriais de Integração</span>
                  <v-spacer></v-spacer>
                  <v-btn icon="mdi-close" variant="text" density="comfortable"
                    @click="isTutorialModalOpen = false"></v-btn>
                </div>

                <v-card-text class="pa-0">
                  <v-expansion-panels variant="accordion" class="rounded-0">
                    <v-expansion-panel>
                      <v-expansion-panel-title class="text-subtitle-1 font-weight-bold">
                        <v-icon start color="red">mdi-video</v-icon> Como configurar no OBS Studio
                      </v-expansion-panel-title>
                      <v-expansion-panel-text>
                        <ol class="text-body-2 text-medium-emphasis pl-4">
                          <li class="mb-2"><strong>Adicione a fonte:</strong> Clique com botão direito em "Fontes" →
                            "Captura de
                            Janela" → Selecione a janela do sistema de projeção.</li>
                          <li class="mb-2"><strong>Ative o Chroma Key:</strong> Clique com botão direito na fonte →
                            "Filtros" →
                            "+" → "Chroma Key". Escolha a cor verde ou azul e ajuste a similaridade.</li>
                          <li class="mb-2"><strong>Posicione a fonte:</strong> Arraste e redimensione para sobrepor com
                            outros
                            elementos (webcam, logo).</li>
                          <li><strong>Lower Thirds:</strong> Se ativou o modo transmissão, o texto ficará na parte
                            inferior. Deixe
                            espaço na parte superior da cena para outros elementos.</li>
                        </ol>
                      </v-expansion-panel-text>
                    </v-expansion-panel>

                    <v-expansion-panel>
                      <v-expansion-panel-title class="text-subtitle-1 font-weight-bold">
                        <v-icon start color="blue">mdi-alpha-v-box</v-icon> Como configurar no vMix
                      </v-expansion-panel-title>
                      <v-expansion-panel-text>
                        <ol class="text-body-2 text-medium-emphasis pl-4">
                          <li class="mb-2"><strong>Adicione a fonte:</strong> Clique em "Add Input" → "Desktop Capture"
                            →
                            Selecione a janela de projeção.</li>
                          <li class="mb-2"><strong>Chroma Key:</strong> Com a fonte selecionada, vá em "Colour" → Ative
                            "ChromaKey" e selecione a cor desejada.</li>
                          <li class="mb-2"><strong>Posicionamento:</strong> Arraste para a posição desejada ou use
                            "Layers" para
                            sobrepor com outros elementos.</li>
                          <li><strong>Mix:</strong> Combine com webcam, títulos e outros elementos na mesma camada.</li>
                        </ol>
                      </v-expansion-panel-text>
                    </v-expansion-panel>

                    <v-expansion-panel>
                      <v-expansion-panel-title class="text-subtitle-1 font-weight-bold">
                        <v-icon start color="amber">mdi-star</v-icon> Dicas para melhor resultado
                      </v-expansion-panel-title>
                      <v-expansion-panel-text>
                        <ul class="text-body-2 text-medium-emphasis pl-4">
                          <li class="mb-2"><strong>Iluminação uniforme:</strong> Se usar chroma key, certifique-se que
                            não há
                            sombras na cor de fundo.</li>
                          <li class="mb-2"><strong>Teste antes:</strong> Sempre faça um ensaio completo da transmissão
                            para
                            ajustar cores, posicionamento e timing.</li>
                          <li class="mb-2"><strong>Fonte:</strong> Use resolução 1080p ou superior na captura para
                            textos nítidos.
                          </li>
                        </ul>
                      </v-expansion-panel-text>
                    </v-expansion-panel>
                  </v-expansion-panels>
                </v-card-text>
              </v-card>
            </v-dialog>

          </v-window-item>

          <v-window-item value="biblia" class="pa-6">
            <h3 class="text-h6 font-weight-bold mb-4 text-primary"><v-icon start>mdi-book-cross</v-icon> Projeção da
              Bíblia
              Sagrada</h3>
            <v-row>
              <v-col cols="12" md="6">
                <v-select v-model="localSettings.bibleVersion" :items="bibleVersions" label="Versão Padrão"
                  variant="outlined" density="comfortable" hide-details class="mb-4"></v-select>
              </v-col>
              <v-col cols="12" md="6">
                <v-select v-model="localSettings.bibleLayout" :items="bibleLayouts" label="Layout da Referência"
                  variant="outlined" density="comfortable" hide-details class="mb-4"></v-select>
              </v-col>
            </v-row>
            <v-switch v-model="localSettings.showVerseNumbers" color="primary"
              label="Exibir números dos versículos no texto projetado" density="compact" hide-details></v-switch>
          </v-window-item>

          <v-window-item value="avancado" class="pa-6">
            <h3 class="text-h6 font-weight-bold mb-2 text-primary"><v-icon start>mdi-border-inside</v-icon> Margens de
              Segurança
              (Safe Area)</h3>
            <p class="text-body-2 text-medium-emphasis mb-4">Evite projetar em bordas cortadas de painéis de LED
              limitando a área
              de texto.</p>

            <v-card variant="outlined" class="pa-4 mb-8 bg-surface">
              <v-row density="comfortable">
                <v-col cols="6" md="3"><v-text-field v-model="localSettings.marginTop" type="number" label="Topo (%)"
                    variant="outlined" density="compact" suffix="%" hide-details></v-text-field></v-col>
                <v-col cols="6" md="3"><v-text-field v-model="localSettings.marginBottom" type="number"
                    label="Rodapé (%)" variant="outlined" density="compact" suffix="%"
                    hide-details></v-text-field></v-col>
                <v-col cols="6" md="3"><v-text-field v-model="localSettings.marginLeft" type="number"
                    label="Esquerda (%)" variant="outlined" density="compact" suffix="%"
                    hide-details></v-text-field></v-col>
                <v-col cols="6" md="3"><v-text-field v-model="localSettings.marginRight" type="number"
                    label="Direita (%)" variant="outlined" density="compact" suffix="%"
                    hide-details></v-text-field></v-col>
              </v-row>
            </v-card>

            <h3 class="text-h6 font-weight-bold mb-2 text-primary"><v-icon start>mdi-keyboard</v-icon> Atalhos de
              Teclado
              (Hotkeys)</h3>
            <v-table density="compact" class="border rounded-lg">
              <thead>
                <tr>
                  <th class="text-left font-weight-bold">Ação</th>
                  <th class="text-left font-weight-bold">Atalho Padrão</th>
                </tr>
              </thead>
              <tbody v-for="shortcut in listShortcuts">
                <tr>
                  <td>{{ shortcut.label }}</td>
                  <td><v-chip size="small" variant="outlined">{{ shortcut.keys }}</v-chip></td>
                </tr>
              </tbody>
            </v-table>
          </v-window-item>

          <v-window-item value="armazenamento" class="pa-6">
            <h3 class="text-h6 font-weight-bold mb-2 text-primary">
              <v-icon start>mdi-folder-information</v-icon> Gerenciamento de Arquivos
            </h3>
            <p class="text-body-2 text-medium-emphasis mb-6">
              Acompanhe o espaço utilizado no seu disco e acesse as pastas raiz do sistema.
            </p>

            <v-row>
              <v-col cols="12" md="6">
                <v-card variant="tonal" class="pa-5 rounded-lg h-100 d-flex flex-column">
                  <div class="d-flex align-center mb-1">
                    <v-icon color="primary" class="mr-2">mdi-folder-multiple-image</v-icon>
                    <span class="text-subtitle-1 font-weight-bold">Mídia Local</span>
                  </div>
                  <p class="text-caption text-medium-emphasis mb-4">
                    Fundos, vídeos e imagens importadas para reprodução.
                  </p>

                  <h2 class="text-h3 font-weight-black text-primary mb-6">
                    {{ storageStats.mediaSize }}
                  </h2>

                  <v-spacer></v-spacer>
                  <v-btn variant="tonal" color="primary" prepend-icon="mdi-folder-open" class="w-100"
                    @click="openMediaFolder">
                    Abrir Pasta no Sistema
                  </v-btn>
                </v-card>
              </v-col>

              <v-col cols="12" md="6">
                <v-card variant="tonal" class="pa-5 rounded-lg h-100 d-flex flex-column">
                  <div class="d-flex align-center mb-1">
                    <v-icon color="secondary" class="mr-2">mdi-cloud-download</v-icon>
                    <span class="text-subtitle-1 font-weight-bold">Dados da Internet</span>
                  </div>
                  <p class="text-caption text-medium-emphasis mb-4">
                    Bíblias em JSON baixadas, fontes, miniaturas e arquivos de atualização.
                  </p>

                  <h2 class="text-h3 font-weight-black text-secondary mb-6">
                    {{ storageStats.cacheSize }}
                  </h2>

                  <v-spacer></v-spacer>
                  <v-btn variant="outlined" color="error" prepend-icon="mdi-delete-sweep" class="w-100"
                    @click="clearCache">
                    Limpar Cache Baixado
                  </v-btn>
                </v-card>
              </v-col>
            </v-row>

            <v-card variant="tonal" color="info" class="pa-4 mt-6 rounded-lg d-flex align-center">
              <v-icon start>mdi-information-outline</v-icon>
              <div class="ml-2">
                <p class="text-caption font-weight-bold mb-0">Local de Instalação</p>
                <p class="text-caption mb-0" style="opacity: 0.8;">Os arquivos nativos estão seguros no diretório padrão
                  do seu
                  sistema operacional.</p>
              </div>
            </v-card>
          </v-window-item>

          <v-window-item value="produtividade" class="pa-6">
            <p class="text-body-2 text-medium-emphasis mb-6">Ferramentas para ganhar tempo durante a operação ao vivo.
            </p>

            <v-row class="mb-4">
              <v-col cols="12" md="8">
                <v-select :disabled="true" v-model="localSettings.activeTheme" :items="themeOptions"
                  label="Tema de Projeção Ativo" variant="outlined" density="comfortable"
                  prepend-inner-icon="mdi-palette-swatch" hide-details></v-select>
              </v-col>
              <v-col cols="12" md="4" class="d-flex align-center">
                <v-btn :disabled="true" prepend-icon="mdi-content-save" color="primary" variant="flat"
                  class="w-100 h-100" style="min-height: 48px;">Salvar Tema</v-btn>
              </v-col>
            </v-row>
            <v-row>
              <!--  
                    SNIPPET: Adicionar na aba "produtividade" do SettingsDialog.vue
                    
                    1. Adicione ao configStore.settings:
                        videoEngine: 'smart' as 'ffmpeg' | 'native' | 'hybrid' | 'smart'
                    
                    2. Cole este bloco antes ou depois do bloco de "Histórico de Ações"
                  -->

              <!-- ══════════════════════════════════════════════════════ -->
              <!-- MOTOR DE VÍDEO                                        -->
              <!-- ══════════════════════════════════════════════════════ -->
              <v-row>
                <v-card variant="outlined" class="rounded-lg mb-6 w-100">
                  <div class="px-4 pt-4 pb-2 d-flex align-center">
                    <div class="d-flex align-center">
                      <v-icon color="primary" class="mr-2" size="20">mdi-engine</v-icon>
                      <span class="text-subtitle-1 font-weight-bold">Motor de Reprodução</span>

                      <v-tooltip location="bottom" max-width="350">
                        <template v-slot:activator="{ props }">
                          <v-icon v-bind="props" size="18" color="medium-emphasis" class="ml-2 cursor-help">
                            mdi-information-outline
                          </v-icon>
                        </template>
                        <div class="text-caption pa-1">
                          Define como os vídeos são reproduzidos no telão ou nas visualizações. Afeta a compatibilidade
                          de
                          formatos,
                          o uso de hardware e a suavidade do <strong>Modo Busca ao Vivo</strong>.
                        </div>
                      </v-tooltip>
                    </div>

                    <v-spacer></v-spacer>

                    <v-btn-toggle v-model="isSimplified" mandatory density="compact" variant="outlined"
                      selected-class="text-primary" style="height: 32px;">
                      <v-btn :value="true" size="small">
                        <v-icon start>mdi-view-compact-outline</v-icon>
                        Simplificado
                      </v-btn>
                      <v-btn :value="false" size="small">
                        <v-icon start>mdi-view-dashboard-outline</v-icon>
                        Completo
                      </v-btn>
                    </v-btn-toggle>
                  </div>

                  <v-divider></v-divider>

                  <div class="pa-4">
                    <v-row density="comfortable">

                      <v-col v-for="engine in engineOptions" :key="engine.value" cols="12" :sm="isSimplified ? 3 : 6">
                        <v-tooltip :disabled="!isSimplified" location="bottom" max-width="300">
                          <template v-slot:activator="{ props }">
                            <v-card v-bind="props"
                              :variant="localSettings.videoEngine === engine.value ? 'tonal' : 'outlined'"
                              :color="localSettings.videoEngine === engine.value ? 'primary' : undefined"
                              class="pa-3 rounded-lg cursor-pointer transition-swing"
                              :class="{ 'border-primary border-opacity-100': localSettings.videoEngine === engine.value }"
                              @click="localSettings.videoEngine = engine.value"
                              style="border-width: 2px !important; min-height: 100%;">
                              <div class="d-flex align-center" :class="{ 'mb-2': !isSimplified }">
                                <v-icon size="20" class="mr-2"
                                  :color="localSettings.videoEngine === engine.value ? 'primary' : 'medium-emphasis'">
                                  {{ engine.icon }}
                                </v-icon>
                                <span class="text-subtitle-2 font-weight-bold">{{ engine.title }}</span>
                                <v-spacer v-if="!isSimplified"></v-spacer>
                                <v-chip v-if="!isSimplified" size="x-small" :color="engine.chipColor" variant="tonal">
                                  {{ engine.chipText }}
                                </v-chip>
                              </div>

                              <v-expand-transition>
                                <div v-if="!isSimplified">
                                  <p class="text-caption text-medium-emphasis mb-2" v-html="engine.description"></p>
                                  <div class="d-flex flex-wrap gap-1">
                                    <v-chip v-for="feat in engine.features" :key="feat.text" size="x-small"
                                      :color="feat.color" variant="outlined">
                                      {{ feat.text }}
                                    </v-chip>
                                  </div>
                                </div>
                              </v-expand-transition>
                            </v-card>
                          </template>

                          <div class="pa-1">
                            <div class="font-weight-bold mb-1">{{ engine.title }}</div>
                            <div class="text-caption" v-html="engine.description"></div>
                          </div>
                        </v-tooltip>
                      </v-col>
                    </v-row>
                  </div>

                  <v-expand-transition>
                    <div v-if="localSettings.videoEngine === 'native'" class="px-4 pb-4">
                      <v-alert type="warning" variant="tonal" density="compact" class="text-caption mb-0">
                        <strong>Atenção:</strong> No Windows, o suporte nativo do WebView2 é limitado.
                      </v-alert>
                    </div>
                    <div v-else-if="localSettings.videoEngine === 'ffmpeg'" class="px-4 pb-4">
                      <v-alert type="info" variant="tonal" density="compact" class="text-caption mb-0">
                        O FFmpeg pode apresentar atraso no Modo Busca ao vivo.
                      </v-alert>
                    </div>
                  </v-expand-transition>
                </v-card>
              </v-row>
            </v-row>
            <v-row>
              <v-col cols="12" md="6">
                <v-card variant="outlined"
                  class="pa-4 rounded-lg h-100 d-flex flex-column justify-center align-center text-center">
                  <v-icon size="32" color="medium-emphasis" class="mb-2">mdi-undo-variant</v-icon>
                  <p class="text-subtitle-2 font-weight-bold">Histórico de Ações</p>
                  <p class="text-caption text-medium-emphasis">Use <strong>Ctrl+Z</strong> para desfazer e
                    <strong>Ctrl+Y</strong>
                    para refazer movimentos acidentais na tela de projeção.
                  </p>
                </v-card>
              </v-col>
              <v-col cols="12" md="6">
                <v-card variant="outlined"
                  class="pa-4 rounded-lg border-error h-100 d-flex flex-column justify-center align-center bg-error-lighten-5">
                  <v-icon size="32" color="error" class="mb-2">mdi-alert-circle-outline</v-icon>
                  <p class="text-subtitle-2 font-weight-bold text-error mb-2">Deu algo errado?</p>
                  <v-btn color="error" variant="tonal" size="small" @click="resetToDefaults">Restaurar Padrões
                    Originais</v-btn>
                </v-card>
              </v-col>
            </v-row>
          </v-window-item>

        </v-window>
      </v-card-text>

      <v-divider class="flex-shrink-0"></v-divider>
      <v-card-actions class="pa-4 flex-shrink-0">
        <v-spacer></v-spacer>
        <v-btn color="grey-darken-1" variant="text" @click="configStore.closeDialog">Cancelar</v-btn>
        <v-btn color="primary" variant="flat" class="px-6" @click="saveAndClose">Concluir</v-btn>
      </v-card-actions>

    </v-card>
  </v-dialog>
</template>
<style scoped>
.transition-swing {
  transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.transition-swing:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.chord-preview-box {
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.chord-example {
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.3;
  color: rgba(0, 0, 0, 0.7);
  margin: 0;
  white-space: pre;
}

kbd {
  display: inline-block;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.05);
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 3px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85em;
  font-weight: 600;
  margin: 0 2px;
}

.cursor-help {
  cursor: help;
}
</style>