<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useConfigStore } from '../../stores/useConfigStore'; 
import { invoke } from '@tauri-apps/api/core';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { mkdir, exists } from '@tauri-apps/plugin-fs';
import { useTheme } from 'vuetify';
import { usePresentationStore } from '../../stores/usePresentationStore';
import { useMenuStore  } from '../../stores/menuStore';

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
  { title: 'Esmaecimento (Fade-in)', value: 'fade' },
  { title: 'Corte Seco (Sem animação)', value: 'none' },
  { title: 'Deslizar (Slide)', value: 'slide' }
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

const stageLayouts = [
  { title: 'Slide Atual + Próximo + Relógio', value: 'full' },
  { title: 'Apenas Slide Atual (Texto Maior)', value: 'current_only' },
  { title: 'Texto contínuo (Rolagem)', value: 'scrolling' }
];

// --- INTEGRAÇÃO COM TAURI (MONITORES) ---
const fetchMonitors = async () => {
    isLoadingMonitors.value = true;
    try {
        const monitors = await invoke<MonitorInfo[]>('get_monitors');
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

/* Vamos simular o carregamento do tamanho das pastas ao abrir o modal
const fetchStorageStats = async () => {
    try {
        // const stats = await invoke('get_storage_stats_cmd');
        // storageStats.value = stats;
        
        // Mock visual:
        storageStats.value = {
            mediaSize: '4.2 GB',
            cacheSize: '350 MB'
        };
    } catch (error) {
        console.error("Erro ao ler armazenamento:", error);
    }
};*/

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
    localSettings.value = JSON.parse(JSON.stringify(configStore.settings));
    setupFolders();
    isDialogOpen.value = true;
    fetchMonitors();
}

const saveAndClose = () => {
    // 2. Transfere os dados locais para a Store Global (O que vai ativar o watch e salvar no Tauri)
    Object.assign(configStore.settings, localSettings.value);
    
    // 3. Fecha o modal
    configStore.closeDialog();
}

const listShortcuts = [
  { label: "Avançar / Voltar Slide", keys: "Setas (← / →)"},
  { label: "Pesquisa rápida de músicas", keys: "Shift + F"},
  { label: "Abertura rápida da bíblia", keys: "Shift + B"},
  { label: "Projetar Letra", keys: "F5"},
  { label: "Projetar Letra do Início", keys: "Shift + F5"},
  { label: "Finalizar Apresentação", keys: "Esc"},


 // { label: "Limpar Fundo", keys: "F2"},
  //{ label: "Tela Preta", keys: "F3"},
  //{ label: "Exibir Logo", keys: "F4"},
]

onMounted(async ()=> {
  await presentationStore.loadPresets()
  //presentationStore.presets.forEach(it => themeOptions.push(it.name))
})

defineExpose({ openDialog })

watch(isDialogOpen, () => {
  menuStore.setShiftShortcutLocked(isDialogOpen.value)
})

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
            <v-icon 
              :key="localSettings.isDarkMode" 
              :color="!localSettings.isDarkMode ? 'amber-lighten-1' : 'amber-darken-4'"
            >
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
            <p class="text-body-2 text-medium-emphasis mb-6">Configure os monitores de saída e o comportamento da tela de projeção.</p>
            
            <v-card variant="outlined" color="surface-variant" class="pa-4 rounded-lg mb-6">
              <h3 class="text-subtitle-1 font-weight-bold mb-2 d-flex align-center">
                <v-icon size="20" class="mr-2 text-primary">mdi-projector</v-icon> Saída de Projeção
              </h3>
              <v-row class="mt-1 align-center">
                <v-col cols="12" sm="8">
                  <v-select v-model="localSettings.selectedMonitor" :items="availableMonitors" :loading="isLoadingMonitors" label="Selecione o Projetor/Tela" variant="outlined" density="comfortable" prepend-inner-icon="mdi-monitor" hide-details></v-select>
                </v-col>
                <v-col cols="12" sm="4">
                  <v-btn color="primary" variant="tonal" class="w-100 h-100" style="min-height: 48px;" @click="autoDetectProjector">Auto Detectar</v-btn>
                </v-col>
              </v-row>
            </v-card>

            <v-row>
              <v-col cols="12" md="6">
                <v-select v-model="localSettings.aspectRatio" :items="aspectOptions" label="Proporção do Telão (Aspect Ratio)" variant="outlined" density="comfortable" prepend-inner-icon="mdi-aspect-ratio" hide-details class="mb-4"></v-select>
              </v-col>
              <v-col cols="12" md="6">
                <v-select v-model="localSettings.transitionType" :items="transitionOptions" label="Transição entre Slides" variant="outlined" density="comfortable" prepend-inner-icon="mdi-transition" hide-details class="mb-4"></v-select>
              </v-col>
            </v-row>
            
            <v-card variant="tonal" class="pa-4 rounded-lg mt-2">
              <p class="text-subtitle-2 font-weight-bold mb-2">Filtro Escurecedor de Fundo</p>
              <p class="text-caption mb-2">Ajuda a destacar o texto escurecendo imagens/vídeos de fundo.</p>
              <v-slider v-model="localSettings.bgOpacity" min="0" max="100" step="5" thumb-label color="primary" prepend-icon="mdi-brightness-6" hide-details>
                <template v-slot:append><span class="text-caption font-weight-bold" style="width: 40px">{{ settings.bgOpacity }}%</span></template>
              </v-slider>
            </v-card>
          </v-window-item>

          <v-window-item value="transmissao" class="pa-6">
            <h3 class="text-h6 font-weight-bold mb-4 text-primary"><v-icon start>mdi-account-voice</v-icon> Monitor de Palco (Retorno)</h3>
            <v-row class="mb-4">
              <v-col cols="12" md="6">
                <v-select v-model="localSettings.stageMonitor" :items="availableMonitors" label="Tela do Retorno" variant="outlined" density="comfortable" hide-details></v-select>
              </v-col>
              <v-col cols="12" md="6">
                <v-select v-model="localSettings.stageLayout" :items="stageLayouts" label="Layout do Retorno" variant="outlined" density="comfortable" hide-details></v-select>
              </v-col>
            </v-row>
            <v-switch v-model="localSettings.stageHighContrast" color="primary" label="Forçar Alto Contraste (Fundo Preto, Letras Amarelas)" density="compact" hide-details class="mb-6"></v-switch>

            <v-divider class="mb-6"></v-divider>

            <h3 class="text-h6 font-weight-bold mb-4 text-primary"><v-icon start>mdi-video-wireless</v-icon> Integração OBS / vMix</h3>
            <v-row>
              <v-col cols="12" md="6">
                <v-switch v-model="localSettings.lowerThirds" color="primary" label="Modo Transmissão (Lower Thirds)" density="compact" hide-details></v-switch>
                <p class="text-caption text-medium-emphasis ml-10">Empurra o texto para a parte inferior da tela, em no máximo 2 linhas.</p>
              </v-col>
              <v-col cols="12" md="6">
                <p class="text-caption font-weight-bold mb-2">Fundo Chroma Key</p>
                <v-btn-toggle v-model="localSettings.chromaKey" color="primary" variant="outlined" divided density="compact">
                  <v-btn value="none">Desativado</v-btn>
                  <v-btn value="#00FF00" color="green">Fundo Verde</v-btn>
                  <v-btn value="#0000FF" color="blue">Fundo Azul</v-btn>
                </v-btn-toggle>
              </v-col>
            </v-row>
          </v-window-item>

          <v-window-item value="biblia" class="pa-6">
            <h3 class="text-h6 font-weight-bold mb-4 text-primary"><v-icon start>mdi-book-cross</v-icon> Projeção da Bíblia Sagrada</h3>
            <v-row>
              <v-col cols="12" md="6">
                <v-select v-model="localSettings.bibleVersion" :items="bibleVersions" label="Versão Padrão" variant="outlined" density="comfortable" hide-details class="mb-4"></v-select>
              </v-col>
              <v-col cols="12" md="6">
                <v-select v-model="localSettings.bibleLayout" :items="bibleLayouts" label="Layout da Referência" variant="outlined" density="comfortable" hide-details class="mb-4"></v-select>
              </v-col>
            </v-row>
            <v-switch v-model="localSettings.showVerseNumbers" color="primary" label="Exibir números dos versículos no texto projetado" density="compact" hide-details></v-switch>
          </v-window-item>

          <v-window-item value="avancado" class="pa-6">
            <h3 class="text-h6 font-weight-bold mb-2 text-primary"><v-icon start>mdi-border-inside</v-icon> Margens de Segurança (Safe Area)</h3>
            <p class="text-body-2 text-medium-emphasis mb-4">Evite projetar em bordas cortadas de painéis de LED limitando a área de texto.</p>
            
            <v-card variant="outlined" class="pa-4 mb-8 bg-surface">
              <v-row density="comfortable">
                <v-col cols="6" md="3"><v-text-field v-model="localSettings.marginTop" type="number" label="Topo (%)" variant="outlined" density="compact" suffix="%" hide-details></v-text-field></v-col>
                <v-col cols="6" md="3"><v-text-field v-model="localSettings.marginBottom" type="number" label="Rodapé (%)" variant="outlined" density="compact" suffix="%" hide-details></v-text-field></v-col>
                <v-col cols="6" md="3"><v-text-field v-model="localSettings.marginLeft" type="number" label="Esquerda (%)" variant="outlined" density="compact" suffix="%" hide-details></v-text-field></v-col>
                <v-col cols="6" md="3"><v-text-field v-model="localSettings.marginRight" type="number" label="Direita (%)" variant="outlined" density="compact" suffix="%" hide-details></v-text-field></v-col>
              </v-row>
            </v-card>

            <h3 class="text-h6 font-weight-bold mb-2 text-primary"><v-icon start>mdi-keyboard</v-icon> Atalhos de Teclado (Hotkeys)</h3>
            <v-table density="compact" class="border rounded-lg">
              <thead>
                <tr>
                  <th class="text-left font-weight-bold">Ação</th>
                  <th class="text-left font-weight-bold">Atalho Padrão</th>
                </tr>
              </thead>
              <tbody v-for="shortcut in listShortcuts">
                <tr><td>{{ shortcut.label }}</td><td><v-chip size="small" variant="outlined">{{ shortcut.keys }}</v-chip></td></tr>
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
                    {{ storageStats.mediaSize  }}
                  </h2>
                  
                  <v-spacer></v-spacer>
                  <v-btn 
                    variant="tonal" 
                    color="primary" 
                    prepend-icon="mdi-folder-open" 
                    class="w-100"
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
                  <v-btn 
                    variant="outlined" 
                    color="error" 
                    prepend-icon="mdi-delete-sweep" 
                    class="w-100"
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
                    <p class="text-caption mb-0" style="opacity: 0.8;">Os arquivos nativos estão seguros no diretório padrão do seu sistema operacional.</p>
                </div>
            </v-card>
          </v-window-item>

          <v-window-item value="produtividade" class="pa-6">
            <p class="text-body-2 text-medium-emphasis mb-6">Ferramentas para ganhar tempo durante a operação ao vivo.</p>

            <v-row class="mb-4">
              <v-col cols="12" md="8">
                <v-select :disabled="true" v-model="localSettings.activeTheme" :items="themeOptions" label="Tema de Projeção Ativo" variant="outlined" density="comfortable" prepend-inner-icon="mdi-palette-swatch" hide-details></v-select>
              </v-col>
              <v-col cols="12" md="4" class="d-flex align-center">
                <v-btn :disabled="true"  prepend-icon="mdi-content-save" color="primary" variant="flat" class="w-100 h-100" style="min-height: 48px;">Salvar Tema</v-btn>
              </v-col>
            </v-row>

            <v-row>
              <v-col cols="12" md="6">
                <v-card variant="outlined" class="pa-4 rounded-lg h-100 d-flex flex-column justify-center align-center text-center">
                  <v-icon size="32" color="medium-emphasis" class="mb-2">mdi-undo-variant</v-icon>
                  <p class="text-subtitle-2 font-weight-bold">Histórico de Ações</p>
                  <p class="text-caption text-medium-emphasis">Use <strong>Ctrl+Z</strong> para desfazer e <strong>Ctrl+Y</strong> para refazer movimentos acidentais na tela de projeção.</p>
                </v-card>
              </v-col>
              <v-col cols="12" md="6">
                <v-card variant="outlined" class="pa-4 rounded-lg border-error h-100 d-flex flex-column justify-center align-center bg-error-lighten-5">
                  <v-icon size="32" color="error" class="mb-2">mdi-alert-circle-outline</v-icon>
                  <p class="text-subtitle-2 font-weight-bold text-error mb-2">Deu algo errado?</p>
                  <v-btn color="error" variant="tonal" size="small" @click="configStore.resetToDefaults">Restaurar Padrões Originais</v-btn>
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