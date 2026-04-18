<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { BibleRef } from '../../types/bibleRef';
import BibleSelector from './BibleField.vue'; // Ajuste o caminho do seu seletor
import { useMenuStore } from '../../stores/menuStore';

const menuStore = useMenuStore()

const props = defineProps<{
  modelValue: boolean; // Controla se a modal está aberta (v-model)
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'open-reference', ref: BibleRef): void; // Emite a referência escolhida para o app
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

// Referência interna para o seletor
const currentSelection = ref<BibleRef[]>([]);

// Fecha a modal e reseta o estado
const close = () => {
  isOpen.value = false;
  currentSelection.value = [];
};

// Observa quando o usuário finaliza a seleção (apertou Enter com o capítulo/versículo)
watch(currentSelection, (newVal) => {
  if (newVal && newVal.length > 0) {
    emit('open-reference', newVal[0]); // Dispara a ação para a tela principal
    close(); // Fecha a modal após a seleção
  }
});

watch(isOpen, () => {
  menuStore.setShiftShortcutLocked(isOpen.value)
})
</script>

<template>
  <v-dialog 
    v-model="isOpen" 
    max-width="700" 
    max-height="800"
    transition="dialog-top-transition h-auto"
    scrim="black"
  >
    <v-card class="glass-modal" rounded="xl" elevation="24">
      
      <v-toolbar color="transparent" density="compact" class="px-2 mb-2 pt-1 bg-surface-light" border="none">
        <v-icon color="primary" class="ml-3 mr-2 opacity-80">mdi-book-open-page-variant</v-icon>
        <v-toolbar-title class="text-subtitle-1 font-weight-bold opacity-80">
          Abertura Rápida
        </v-toolbar-title>
        <v-spacer></v-spacer>
        <v-chip size="x-small" variant="text" class="mr-2 text-medium-emphasis">ESC</v-chip>
        <v-btn icon="mdi-close" variant="text" size="small" color="medium-emphasis" @click="close"></v-btn>
      </v-toolbar>

      <v-card-text class="pa-4 pt-2 pb-6">
        <BibleSelector 
          v-if="isOpen"
          v-model="currentSelection" 
          :single="true" 
          label="Digite o livro, capítulo e verso..."
        />
      </v-card-text>

    </v-card>
  </v-dialog>
</template>

<style scoped>
/* O Segredo da Transparência Adaptativa (Dark/Light) */
.glass-modal {
  /* Usa a cor de superfície atual do Vuetify (Branco no light, Escuro no dark) com 75% de opacidade */
  background: rgba(var(--v-theme-surface), 0.75) !important; 
  
  /* Aplica o desfoque nos elementos que estão atrás da modal */
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  
  /* Borda sutil para dar acabamento premium */
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.2) !important;
}

.opacity-80 {
  opacity: 0.8;
}
</style>