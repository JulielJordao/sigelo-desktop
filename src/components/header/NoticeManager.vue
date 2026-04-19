<script setup lang="ts">
import { ref, watch } from 'vue';
import { useNoticeStore } from '../../stores/noticeStore';
import { useMenuStore } from '../../stores/menuStore';

const menuStore = useMenuStore()
const noticeStore = useNoticeStore();
const menuOpen = ref(false);
const activeTab = ref(0);

const positions = [
  { title: 'Topo da Tela', value: 'top' },
  { title: 'Rodapé da Tela', value: 'bottom' }
];

const styles = [
  { title: 'Fundo Sólido Leve', value: 'solid' },
  { title: 'Apenas Texto (Transparente)', value: 'transparent' }
];

const animations = [
  { title: 'Deslizar (Direita p/ Esquerda)', value: 'marquee' },
  { title: 'Surgir (Fade)', value: 'fade' },
  { title: 'Entrar por cima/baixo', value: 'slide' }
];

const applyNotice = () => {
  noticeStore.startNotice();
  menuOpen.value = false; // Fecha o menu ao aplicar/atualizar
};

watch(menuOpen, () => {
  menuStore.setShiftShortcutLocked(menuOpen.value)
})
</script>

<template>
  <div class="d-flex align-center">
    
    <v-expand-x-transition>
      <div v-if="noticeStore.isActive" 
           class="d-flex align-center bg-surface-variant rounded-pill pl-3 pr-1 py-1 mr-2 border shadow-sm"
           style="height: 36px;">
           
        <v-tooltip :text="noticeStore.text" location="bottom">
          <template v-slot:activator="{ props }">
            <span v-bind="props" class="text-caption font-weight-bold text-error mr-3 cursor-pointer d-inline-block text-truncate" style="max-width: 100px;">
              {{ noticeStore.formattedTime }}
            </span>
          </template>
        </v-tooltip>

        <v-divider vertical class="mx-1" style="height: 16px;"></v-divider>

        <v-btn :icon="noticeStore.isPaused ? 'mdi-play' : 'mdi-pause'" 
               size="x-small" variant="text" color="medium-emphasis"
               @click="noticeStore.togglePause"></v-btn>
               
        <v-btn icon="mdi-stop" size="x-small" variant="text" color="error"
               @click="noticeStore.stopNotice"></v-btn>
      </div>
    </v-expand-x-transition>

    <v-menu v-model="menuOpen" :close-on-content-click="false" location="bottom end" transition="slide-y-transition" offset="6">
      
      <template v-slot:activator="{ props: menuProps }">
        <v-tooltip text="Gerenciador de Avisos" location="bottom">
          <template v-slot:activator="{ props: tooltipProps }">
            <v-btn 
              v-bind="{ ...menuProps, ...tooltipProps }"
              icon
              size="small"
              variant="text"
              :color="noticeStore.isActive ? 'error' : 'medium-emphasis'"
              :class="{ 'alert-pulse': noticeStore.isActive && !noticeStore.isPaused }"
            >
              <v-icon>mdi-bullhorn-outline</v-icon>
              <v-badge v-if="noticeStore.isActive" dot color="error" floating></v-badge>
            </v-btn>
          </template>
        </v-tooltip>
      </template>

      <v-card width="350" class="elevation-4 border rounded-lg mt-2">
        <v-tabs v-model="activeTab" density="compact" grow color="primary">
          <v-tab value="0">Mensagem</v-tab>
          <v-tab value="1">Formato</v-tab>
        </v-tabs>

        <v-divider></v-divider>

        <v-window v-model="activeTab">
          
          <v-window-item value="0">
            <v-card-text class="pt-3">
              <v-textarea v-model="noticeStore.text" label="Texto do Aviso"
                          placeholder="Ex: Veículo placa ABC-1234 com farol aceso..."
                          variant="outlined" density="compact" rows="3" auto-grow hide-details class="mb-3"></v-textarea>
              
              <v-row dense>
                <v-col cols="6">
                  <v-text-field v-model.number="noticeStore.durationSecs" label="Duração (Segundos)"
                                type="number" variant="outlined" density="compact" hide-details></v-text-field>
                </v-col>
                <v-col cols="6">
                  <v-text-field v-model.number="noticeStore.frequencyMins" label="Repetir a cada (Min)"
                                type="number" variant="outlined" density="compact" hide-details
                                hint="0 = apenas uma vez"></v-text-field>
                </v-col>
              </v-row>
            </v-card-text>
          </v-window-item>

          <v-window-item value="1">
            <v-card-text class="pt-3">
              <v-select v-model="noticeStore.format.position" :items="positions" label="Posicionamento"
                        variant="outlined" density="compact" hide-details class="mb-3"></v-select>
              
              <v-select v-model="noticeStore.format.style" :items="styles" label="Estilo de Fundo"
                        variant="outlined" density="compact" hide-details class="mb-3"></v-select>
              
              <v-select v-model="noticeStore.format.animation" :items="animations" label="Animação"
                        variant="outlined" density="compact" hide-details class="mb-3"></v-select>

              <div class="d-flex align-center justify-space-between mt-2">
                <div class="text-caption text-medium-emphasis">Cor da Letra:</div>
                <input type="color" v-model="noticeStore.format.color" class="cursor-pointer">
              </div>

              <v-expand-transition>
                <div v-if="noticeStore.format.style === 'solid'" class="d-flex align-center justify-space-between mt-3">
                  <div class="text-caption text-medium-emphasis">Cor de Fundo:</div>
                  <input type="color" v-model="noticeStore.format.bgColor" class="cursor-pointer">
                </div>
              </v-expand-transition>

            </v-card-text>
          </v-window-item>
        </v-window>

        <v-divider></v-divider>

        <v-card-actions class="bg-surface-light">
          <v-spacer></v-spacer>
          <v-btn variant="text" size="small" @click="menuOpen = false">Fechar</v-btn>
          <v-btn color="primary" variant="flat" size="small" :disabled="!noticeStore.text" @click="applyNotice">
            {{ noticeStore.isActive ? 'Atualizar' : 'Iniciar Aviso' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-menu>

  </div>
</template>

<style scoped>
/* Animação de pulso suave para quando o aviso estiver rodando */
.alert-pulse {
  animation: pulse-red 2.5s infinite;
}

@keyframes pulse-red {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.1); opacity: 0.7; color: rgb(var(--v-theme-error)); }
  100% { transform: scale(1); opacity: 1; }
}
</style>