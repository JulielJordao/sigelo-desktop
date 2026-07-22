<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { useLocalGroupStore } from '../../stores/localGroupStore';
import type { SongCache } from '../../stores/songCacheStore';

const localGroupStore = useLocalGroupStore();

// Se você já tiver o multiselect_options compartilhado no app desktop,
// troque estas constantes por: import { multiselect_options } from '../../utils/validateForm'
const tones = [
  'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bbm', 'Bm',
];
const songTags = ["Adoração",
    "Advento",
    "Aliança",
    "Alegria",
    "Amor",
    "Aniversário",
    "Arrependimento",
    "Ascenção",
    "Avivamento",
    "Batismo",
    "Benção",
    "Bíblia",
    "Cantos Litúrgicos",
    "Comunhão",
    "Confiança",
    "Confissão",
    "Consolo",
    "Criação",
    "Crianças",
    "Datas Especiais",
    "Dependência de Deus",
    "Epifania",
    "Esperança",
    "Esperar em Deus",
    "Evangelho",
    "Família",
    "Fé e Justificação",
    "Graça",
    "Gratidão",
    "Igreja",
    "Jesus, o Redentor",
    "Jovens",
    "Juízo Final e Vida Eterna",
    "Lar Cristão",
    "Louvor",
    "Luz",
    "Manhã",
    "Matrimônio",
    "Meios da Graça",
    "Ministério – Ordenação e Instalação",
    "Missão",
    "Morte",
    "Morte e Sepultamento",
    "Natal",
    "Noite",
    "Obediência",
    "Oferta",
    "Oração",
    "Páscoa",
    "Paixão e Morte",
    "Palavra de Deus",
    "Passagem de ano",
    "Pátria",
    "Pentecostes",
    "Perdão",
    "Povo de Deus",
    "Proteção",
    "Proteção – Viagem",
    "Quebrantamento",
    "Quaresma",
    "Reconsagração",
    "Reforma",
    "Redenção",
    "Refeição",
    "Sabedoria",
    "Salmo",
    "Salvação",
    "Santa Ceia",
    "Santidade",
    "Santificação",
    "Servir",
    "Temor do Senhor",
    "Templo",
    "Trabalho",
    "Trindade",
    "Vida Cristã",
    "Vida Eterna",
    "Volta de Jesus"];

const emit = defineEmits<{ (e: 'saved', song: SongCache, mode: 'create' | 'edit'): void }>();

const dialog = ref(false);
const isValid = ref(false);
const form = ref<any>(null);
const saving = ref(false);
const showPreview = ref(false);

const groupId = ref('');
const editMode = ref(false);
const editingId = ref('');

const formData = ref({
  fullName: '',
  tone: '',
  writerBy: '',
  versionBy: '',
  melodyBy: '',
  youtubeLink: '',
  tags: [] as string[],
  lyric: '',
});

const rules = {
  required: (v: string) => !!v || 'Este campo é obrigatório.',
  minLength: (min: number) => (v: string) =>
    !v || v.length >= min || `Deve ter no mínimo ${min} caracteres.`,
  youtubeLink: (v: string) => {
    const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
    return !v || pattern.test(v) || 'Link do YouTube inválido.';
  },
};

const resetForm = () => {
  formData.value = {
    fullName: '', tone: '', writerBy: '', versionBy: '',
    melodyBy: '', youtubeLink: '', tags: [], lyric: '',
  };
  showPreview.value = false;
};

const openDialog = (gid: string, song?: SongCache) => {
  groupId.value = gid;
  resetForm();

  if (song) {
    editMode.value = true;
    editingId.value = song.id;
    formData.value = {
      fullName: song.fullName ?? '',
      tone: song.tone ?? '',
      writerBy: song.writerBy ?? '',
      versionBy: song.versionBy ?? '',
      melodyBy: song.melodyBy ?? '',
      youtubeLink: song.youtubeLink ?? '',
      tags: [...(song.tags ?? [])],
      lyric: song.lyric ?? '',
    };
  } else {
    editMode.value = false;
    editingId.value = '';
  }
  dialog.value = true;
};

const cancelForm = () => { dialog.value = false; };

const submitForm = async () => {
  const { valid } = await form.value.validate();
  if (!valid || saving.value) return;

  saving.value = true;
  try {
    const payload = {
      fullName: formData.value.fullName.trim(),
      tone: formData.value.tone || undefined,
      writerBy: formData.value.writerBy || undefined,
      versionBy: formData.value.versionBy || undefined,
      melodyBy: formData.value.melodyBy || undefined,
      youtubeLink: formData.value.youtubeLink || undefined,
      tags: formData.value.tags.length ? formData.value.tags : undefined,
      lyric: formData.value.lyric,
    };

    const saved = editMode.value
      ? await localGroupStore.updateSong(groupId.value, editingId.value, payload)
      : await localGroupStore.addSong(groupId.value, payload);

    emit('saved', (saved ?? { ...payload, id: editingId.value }) as SongCache,
         editMode.value ? 'edit' : 'create');
    dialog.value = false;
  } finally {
    saving.value = false;
  }
};

// --- Refrão: mesma lógica do ModalAddFiles da web ---
const getTextarea = (): HTMLTextAreaElement | null => {
  const wrapper = document.getElementById('local-lyric-textarea');
  if (!wrapper) return null;
  return (wrapper.querySelector('textarea') ?? wrapper) as HTMLTextAreaElement;
};

const applyToSelectedLines = (transform: (line: string) => string) => {
  const textarea = getTextarea();
  if (!textarea) return;

  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const current = formData.value.lyric || '';
  if (!current) return;

  let lineStart = current.lastIndexOf('\n', start - 1);
  lineStart = lineStart === -1 ? 0 : lineStart + 1;

  let lineEnd = current.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = current.length;

  const result = current.substring(lineStart, lineEnd)
    .split('\n').map(transform).join('\n');

  formData.value.lyric =
    current.substring(0, lineStart) + result + current.substring(lineEnd);

  nextTick(() => {
    textarea.focus();
    textarea.setSelectionRange(lineStart, lineStart + result.length);
  });
};

const indentChorus = () => applyToSelectedLines(line => '     ' + line);
const unindentChorus = () => applyToSelectedLines(line => line.replace(/^ {1,5}/, ''));

// --- Pré-visualização: blocos separados por linha em branco ---
const previewBlocks = computed(() => {
  return (formData.value.lyric || '')
    .split(/\n\s*\n/)
    .map(b => b.replace(/\n+$/, ''))
    .filter(b => b.trim() !== '')
    .map(text => ({
      text,
      isChorus: text.split('\n').every(l => l.trim() === '' || l.startsWith('     ')),
    }));
});

defineExpose({ openDialog });
</script>

<template>
  <v-dialog v-model="dialog" max-width="760" persistent scrollable
    transition="dialog-bottom-transition">
    <v-card class="rounded-lg overflow-hidden">

      <!-- Header no mesmo padrão da web -->
      <div class="d-flex align-center justify-space-between px-5 py-0 bg-indigo-darken-1 text-white">
        <div class="d-flex align-center ga-3">
          <v-icon size="24">mdi-music-note-plus</v-icon>
          <h2 class="text-subtitle-1 font-weight-bold">
            {{ editMode ? 'Editar Música' : 'Cadastrar Música' }}
          </h2>
        </div>
        <v-btn icon="mdi-close" variant="text" density="comfortable"
          color="white" @click="cancelForm" />
      </div>

      <v-card-text class="pa-5" style="max-height: 72vh;">
        <v-form ref="form" v-model="isValid">
          <v-row dense>
            <v-col cols="12">
              <v-text-field v-model="formData.fullName"
                :rules="[rules.required, rules.minLength(3)]"
                label="Nome da Música *" variant="outlined" density="comfortable"
                prepend-inner-icon="mdi-music-note" />
            </v-col>

            <v-col cols="12" md="4">
              <v-select v-model="formData.tone" :items="tones" label="Tom Principal"
                variant="outlined" density="comfortable" clearable
                prepend-inner-icon="mdi-music-clef-treble" hide-details="auto" />
            </v-col>

            <v-col cols="12" md="8">
              <v-text-field v-model="formData.youtubeLink" :rules="[rules.youtubeLink]"
                label="Link do YouTube" variant="outlined" density="comfortable"
                prepend-inner-icon="mdi-youtube" hide-details="auto" />
            </v-col>

            <v-col cols="12" md="4">
              <v-text-field v-model="formData.writerBy" label="Escrito Por"
                variant="outlined" density="comfortable" hide-details="auto" />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="formData.versionBy" label="Versão Por"
                variant="outlined" density="comfortable" hide-details="auto" />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="formData.melodyBy" label="Melodia Por"
                variant="outlined" density="comfortable" hide-details="auto" />
            </v-col>

            <v-col cols="12">
              <v-autocomplete v-model="formData.tags" :items="songTags" label="Tags"
                multiple chips closable-chips clearable variant="outlined"
                density="comfortable" hide-details="auto" />
            </v-col>
          </v-row>

          <!-- Bloco da letra, espelhando o ModalAddFiles -->
          <div class="mt-5 pa-4 rounded-lg border bg-surface-light">
            <div class="d-flex justify-space-between align-center mb-3 flex-wrap ga-2">
              <span class="text-body-2 font-weight-bold text-medium-emphasis">
                Letra da Música
              </span>
              <div class="d-flex ga-2 flex-wrap justify-end">
                <v-btn size="small" variant="tonal" prepend-icon="mdi-format-indent-decrease"
                  @click="unindentChorus">
                  Desmarcar
                  <v-tooltip activator="parent" location="top">Remover os 5 espaços</v-tooltip>
                </v-btn>
                <v-btn size="small" variant="flat" color="indigo-darken-1"
                  prepend-icon="mdi-format-indent-increase" @click="indentChorus">
                  Marcar Refrão
                  <v-tooltip activator="parent" location="top">Adicionar 5 espaços</v-tooltip>
                </v-btn>
                <v-btn size="small" variant="flat" color="indigo"
                  :prepend-icon="showPreview ? 'mdi-pencil-outline' : 'mdi-eye-outline'"
                  :disabled="!formData.lyric" @click="showPreview = !showPreview">
                  {{ showPreview ? 'Editar' : 'Pré-visualizar' }}
                </v-btn>
              </div>
            </div>

            <v-textarea v-if="!showPreview" id="local-lyric-textarea"
              v-model="formData.lyric" rows="14" auto-grow variant="outlined"
              placeholder="Escreva ou cole a letra aqui..."
              class="font-mono text-body-2" hide-details spellcheck="false" />

            <div v-else class="d-flex flex-column ga-2">
              <div v-for="(block, i) in previewBlocks" :key="i"
                class="pa-3 rounded border bg-surface"
                :class="block.isChorus ? 'border-indigo' : ''">
                <div class="text-caption text-medium-emphasis mb-1">
                  {{ block.isChorus ? 'Refrão' : 'Verso ' + (i + 1) }}
                </div>
                <pre class="text-body-2 ma-0" style="white-space: pre-wrap; font-family: inherit;">{{ block.text }}</pre>
              </div>
              <div v-if="previewBlocks.length === 0"
                class="text-center pa-4 text-caption text-grey">
                Nada para pré-visualizar.
              </div>
            </div>
          </div>
        </v-form>
      </v-card-text>

      <v-divider />

      <div class="d-flex justify-end ga-2 px-5 py-3 bg-surface-light">
        <v-btn variant="text" class="font-weight-bold" @click="cancelForm">Cancelar</v-btn>
        <v-btn color="primary" variant="flat" class="font-weight-bold px-6"
          :loading="saving" @click="submitForm">
          Salvar <v-icon end>mdi-content-save-check</v-icon>
        </v-btn>
      </div>

    </v-card>
  </v-dialog>
</template>