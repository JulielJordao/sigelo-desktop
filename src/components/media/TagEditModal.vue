<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useMediaStore } from '../../stores/mediaStore';

const props = defineProps<{
  modelValue: boolean; // Controla se o modal está aberto
  mediaId: string;
  mediaName: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const mediaStore = useMediaStore();

// --- 1. CONFIGURAÇÕES E ESTADOS INICIAIS ---
// Lista fixa de sugestões (Você pode personalizar conforme a necessidade da igreja)
const fixedSuggestions = ['Bíblia', 'Jesus', 'Perdão', 'Cruz', 'Louvor', 'Adoração', 'Ceia', 'Abertura', 'Apelo', 'Coral', 'Infantil', 'Jovens'];

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const localTags = ref<string[]>([]);
const inputText = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

// Ao abrir o modal, carregamos as tags da música específica
watch(() => props.modelValue, (isNowOpen) => {
  if (isNowOpen) {
    inputText.value = '';
    const currentTagsString = mediaStore.tagsByFiles[props.mediaId] || [];
    
    // Converte a string separada por vírgula em array limpo
    localTags.value = currentTagsString
  }
});

// --- 2. LÓGICA DE FILTRAGEM (Passos 1, 3 e 4) ---
const normalizedInput = computed(() => inputText.value.trim().toLowerCase());

// Filtra sugestões fixas: Remove as que já foram escolhidas e filtra pelo que foi digitado
const filteredFixed = computed(() => {
  return fixedSuggestions.filter(tag => {
    const notSelected = !localTags.value.includes(tag);
    const matchesInput = tag.toLowerCase().includes(normalizedInput.value);
    return notSelected && matchesInput;
  });
});

// Filtra tags cadastradas globalmente: Remove as já escolhidas, remove as que já são fixas, e filtra
const filteredRegistered = computed(() => {

  if(!Array.isArray(mediaStore.allTags)) {
    return []
  }

  return mediaStore.allTags.filter(tag => {
    const notSelected = !localTags.value.includes(tag);
    const notFixed = !fixedSuggestions.includes(tag);
    const matchesInput = tag.toLowerCase().includes(normalizedInput.value);
    return notSelected && notFixed && matchesInput;
  });
});

// --- 3. LÓGICA DE ADIÇÃO E REMOÇÃO (Passos 2, 4 e 5) ---
const addTag = (tag: string) => {
  const cleanTag = tag.trim();
  // Só adiciona se não for vazio e se já não estiver na lista
  if (cleanTag && !localTags.value.includes(cleanTag)) {
    localTags.value.push(cleanTag);
  }
  // Limpa o campo e foca novamente
  inputText.value = '';
  inputRef.value?.focus();
};

const removeTag = (tagToRemove: string) => {
  localTags.value = localTags.value.filter(t => t !== tagToRemove);
};

// Passo 5: Enter aplica o que foi digitado
const onEnter = () => {
  if (inputText.value.trim()) {
    addTag(inputText.value);
  }
};

// Passo 4: Autocompletar com Tab se sobrar apenas 1 opção
const onTab = (event: KeyboardEvent) => {
  const totalOptions = filteredFixed.value.length + filteredRegistered.value.length;
  
  if (totalOptions === 1) {
    event.preventDefault(); // Impede de pular para o próximo botão da tela
    
    // Pega a única tag disponível, seja ela das fixas ou das cadastradas
    const tagToAutocomplete = filteredFixed.value.length === 1 
      ? filteredFixed.value[0] 
      : filteredRegistered.value[0];
      
    addTag(tagToAutocomplete);
  }
};

// --- 4. SALVAR (Passo 6) ---
const save = () => {
  // Transforma o array de volta em string separada por vírgula para respeitar o Record<string, string>
  mediaStore.applyNewTagsByFiles(props.mediaId, localTags.value)
  
  // (Opcional) Se você quiser que o allTags atualize na hora:
  // mediaStore.updateAllTags(); // Assumindo que você crie uma action para isso
  
  isOpen.value = false;
};

const close = () => {
  isOpen.value = false;
};
</script>

<template>
  <v-dialog 
    v-model="isOpen" 
    max-width="500" 
    transition="dialog-bottom-transition"
    scrim="black"
  >
    <v-card rounded="lg" elevation="10" class="bg-surface">
      
      <v-toolbar color="transparent" density="compact" class="px-2 pt-2" border="none">
        <v-icon color="primary" class="mr-3">mdi-tag-multiple</v-icon>
        <v-toolbar-title class="text-h6 font-weight-bold">Gerenciar Tags</v-toolbar-title>
        <v-spacer></v-spacer>
        <v-btn icon="mdi-close" variant="text" @click="close"></v-btn>
      </v-toolbar>

      <v-card-text class="pt-4 pb-2">
        <div class="mb-5 px-3 py-2 bg-surface-variant rounded-lg d-flex align-center border">
          <v-icon size="small" class="mr-2 text-medium-emphasis">mdi-music-note</v-icon>
          <span class="text-subtitle-2 font-weight-medium text-truncate" :title="mediaName">
            {{ mediaName }}
          </span>
        </div>

        <div class="mb-4" v-if="filteredFixed.length > 0">
          <div class="text-caption font-weight-bold text-medium-emphasis mb-2 text-uppercase">
            Sugestões
          </div>
          <v-chip-group>
            <v-chip
              v-for="tag in filteredFixed"
              :key="`fixed-${tag}`"
              size="small"
              variant="tonal"
              color="primary"
              class="font-weight-medium"
              @click="addTag(tag)"
            >
              <v-icon start size="x-small">mdi-plus</v-icon>
              {{ tag }}
            </v-chip>
          </v-chip-group>
        </div>

        <v-divider class="mb-4 opacity-50"></v-divider>

        <div class="mb-2">
          <v-chip-group v-if="localTags.length > 0" class="mb-2">
            <v-chip
              v-for="tag in localTags"
              :key="`selected-${tag}`"
              closable
              color="primary"
              variant="flat"
              size="small"
              @click:close="removeTag(tag)"
            >
              {{ tag }}
            </v-chip>
          </v-chip-group>

          <v-text-field
            ref="inputRef"
            v-model="inputText"
            label="Digite e aperte Enter..."
            variant="outlined"
            density="comfortable"
            color="primary"
            hide-details
            prepend-inner-icon="mdi-tag-plus-outline"
            @keydown.enter.prevent="onEnter"
            @keydown.tab="onTab"
          >
            <template v-slot:append-inner v-if="filteredFixed.length + filteredRegistered.length === 1 && inputText">
              <v-fade-transition>
                <v-chip size="x-small" color="grey" variant="tonal">Aperte TAB</v-chip>
              </v-fade-transition>
            </template>
          </v-text-field>
        </div>

        <div class="mt-4" v-if="filteredRegistered.length > 0">
          <div class="text-caption font-weight-bold text-medium-emphasis mb-2 text-uppercase">
            Tags de outras Músicas
          </div>
          <div class="d-flex flex-wrap gap-2">
            <v-chip
              v-for="tag in filteredRegistered"
              :key="`reg-${tag}`"
              size="small"
              variant="outlined"
              color="medium-emphasis"
              @click="addTag(tag)"
            >
              {{ tag }}
            </v-chip>
          </div>
        </div>
        
      </v-card-text>

      <v-card-actions class="pa-4 bg-surface-light d-flex justify-end gap-2 border-t">
        <v-btn variant="text" color="medium-emphasis" class="text-none" @click="close">
          Cancelar
        </v-btn>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-check" class="text-none px-6 rounded-pill" @click="save">
          Salvar Tags
        </v-btn>
      </v-card-actions>
      
    </v-card>
  </v-dialog>
</template>

<style scoped>
.gap-2 { gap: 8px; }
.opacity-50 { opacity: 0.5; }
</style>