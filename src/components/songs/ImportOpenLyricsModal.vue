<script setup lang="ts">
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { parseOpenLyrics, type ParsedSong } from '../../utils/openLyricsParser'
import { useLocalGroupStore } from '../../stores/localGroupStore'

const localGroupStore = useLocalGroupStore()

// Mesma lista oficial de tags usada no ModalLocalSong.
const songTags = [
  'Adoração', 'Advento', 'Aliança', 'Alegria', 'Amor', 'Aniversário',
  'Arrependimento', 'Ascenção', 'Avivamento', 'Batismo', 'Benção', 'Bíblia',
  'Cantos Litúrgicos', 'Comunhão', 'Confiança', 'Confissão', 'Consolo',
  'Criação', 'Crianças', 'Datas Especiais', 'Dependência de Deus', 'Epifania',
  'Esperança', 'Esperar em Deus', 'Evangelho', 'Família', 'Fé e Justificação',
  'Graça', 'Gratidão', 'Igreja', 'Jesus, o Redentor', 'Jovens',
  'Juízo Final e Vida Eterna', 'Lar Cristão', 'Louvor', 'Luz', 'Manhã',
  'Matrimônio', 'Meios da Graça', 'Ministério – Ordenação e Instalação',
  'Missão', 'Morte', 'Morte e Sepultamento', 'Natal', 'Noite', 'Obediência',
  'Oferta', 'Oração', 'Páscoa', 'Paixão e Morte', 'Palavra de Deus',
  'Passagem de ano', 'Pátria', 'Pentecostes', 'Perdão', 'Povo de Deus',
  'Proteção', 'Proteção – Viagem', 'Quebrantamento', 'Quaresma',
  'Reconsagração', 'Reforma', 'Redenção', 'Refeição', 'Sabedoria', 'Salmo',
  'Salvação', 'Santa Ceia', 'Santidade', 'Santificação', 'Servir',
  'Temor do Senhor', 'Templo', 'Trabalho', 'Trindade', 'Vida Cristã',
  'Vida Eterna', 'Volta de Jesus',
]

const emit = defineEmits<{ (e: 'imported', count: number): void }>()

interface Row {
  song: ParsedSong
  selected: boolean
}

const dialog = ref(false)
const groupId = ref('')
const loading = ref(false)
const importing = ref(false)
const rows = ref<Row[]>([])
const failed = ref<string[]>([])
const expanded = ref<number | null>(null)

const selectedCount = computed(() => rows.value.filter((r) => r.selected).length)
const allSelected = computed(
  () => rows.value.length > 0 && rows.value.every((r) => r.selected),
)

const openDialog = (gid: string) => {
  groupId.value = gid
  rows.value = []
  failed.value = []
  expanded.value = null
  dialog.value = true
}

async function pickFiles() {
  loading.value = true
  try {
    const files = await invoke<{ name: string; xml: string }[]>(
      'pick_openlyrics_files',
    )
    const parsed: Row[] = []
    const errors: string[] = []
    for (const f of files) {
      const song = parseOpenLyrics(f.xml, f.name, songTags)
      if (song) parsed.push({ song, selected: true })
      else errors.push(f.name)
    }
    rows.value = parsed
    failed.value = errors
  } catch (e) {
    console.error('Falha ao abrir arquivos OpenLyrics', e)
  } finally {
    loading.value = false
  }
}

function toggleAll() {
  const next = !allSelected.value
  rows.value.forEach((r) => (r.selected = next))
}

/** Blocos da letra para a prévia — mesma regra do ModalLocalSong. */
function previewBlocks(lyric: string) {
  return (lyric || '')
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\n+$/, ''))
    .filter((b) => b.trim() !== '')
    .map((textBlock) => ({
      text: textBlock,
      isChorus: textBlock
        .split('\n')
        .every((l) => l.trim() === '' || l.startsWith('     ')),
    }))
}

async function importSelected() {
  if (importing.value) return
  importing.value = true
  let count = 0
  try {
    for (const r of rows.value) {
      if (!r.selected) continue
      await localGroupStore.addSong(groupId.value, {
        fullName: r.song.fullName,
        lyric: r.song.lyric,
        writerBy: r.song.writerBy,
        versionBy: r.song.versionBy,
        melodyBy: r.song.melodyBy,
        tags: r.song.tags.length ? r.song.tags : undefined,
      })
      count++
    }
    emit('imported', count)
    dialog.value = false
  } finally {
    importing.value = false
  }
}

defineExpose({ openDialog })
</script>

<template>
  <v-dialog v-model="dialog" max-width="820" persistent scrollable>
    <v-card class="rounded-lg overflow-hidden">
      <div
        class="d-flex align-center justify-space-between px-5 py-0 bg-indigo-darken-1 text-white"
      >
        <div class="d-flex align-center ga-3">
          <v-icon size="24">mdi-file-import-outline</v-icon>
          <h2 class="text-subtitle-1 font-weight-bold">Importar OpenLyrics</h2>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          density="comfortable"
          color="white"
          @click="dialog = false"
        />
      </div>

      <v-card-text class="pa-5" style="max-height: 72vh;">
        <div class="d-flex align-center ga-3 mb-4 flex-wrap">
          <v-btn
            color="indigo-darken-1"
            variant="flat"
            prepend-icon="mdi-folder-open-outline"
            :loading="loading"
            @click="pickFiles"
          >
            Selecionar arquivos .xml
          </v-btn>
          <span v-if="rows.length" class="text-body-2 text-medium-emphasis">
            {{ selectedCount }} de {{ rows.length }} selecionada(s)
          </span>
          <v-spacer />
          <v-btn
            v-if="rows.length"
            size="small"
            variant="tonal"
            @click="toggleAll"
          >
            {{ allSelected ? 'Desmarcar todas' : 'Marcar todas' }}
          </v-btn>
        </div>

        <v-alert
          v-if="failed.length"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          {{ failed.length }} arquivo(s) não puderam ser lidos:
          {{ failed.join(', ') }}
        </v-alert>

        <div v-if="!rows.length && !loading" class="text-center pa-8 text-medium-emphasis">
          <v-icon size="48" class="mb-2">mdi-music-note-off-outline</v-icon>
          <div class="text-body-2">
            Selecione um ou mais arquivos OpenLyrics (.xml) para pré-visualizar.
          </div>
        </div>

        <v-list v-else lines="two" density="comfortable">
          <template v-for="(r, i) in rows" :key="i">
            <v-list-item>
              <template #prepend>
                <v-checkbox-btn v-model="r.selected" />
              </template>
              <v-list-item-title class="font-weight-medium">
                {{ r.song.fullName }}
              </v-list-item-title>
              <v-list-item-subtitle>
                <span v-if="r.song.writerBy">{{ r.song.writerBy }}</span>
                <span v-if="r.song.tags.length"> · {{ r.song.tags.join(', ') }}</span>
              </v-list-item-subtitle>
              <template #append>
                <v-btn
                  size="small"
                  variant="text"
                  :icon="expanded === i ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                  @click="expanded = expanded === i ? null : i"
                />
              </template>
            </v-list-item>

            <v-expand-transition>
              <div v-if="expanded === i" class="px-4 pb-3">
                <div
                  v-for="(block, bi) in previewBlocks(r.song.lyric)"
                  :key="bi"
                  class="pa-3 mb-2 rounded border"
                  :class="block.isChorus ? 'border-indigo' : ''"
                >
                  <div class="text-caption text-medium-emphasis mb-1">
                    {{ block.isChorus ? 'Refrão' : 'Verso ' + (bi + 1) }}
                  </div>
                  <pre
                    class="text-body-2 ma-0"
                    style="white-space: pre-wrap; font-family: inherit;"
                    >{{ block.text }}</pre>
                </div>
              </div>
            </v-expand-transition>
            <v-divider v-if="i < rows.length - 1" />
          </template>
        </v-list>
      </v-card-text>

      <v-divider />

      <div class="d-flex justify-end ga-2 px-5 py-3 bg-surface-light">
        <v-btn variant="text" class="font-weight-bold" @click="dialog = false">
          Cancelar
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          class="font-weight-bold px-6"
          :loading="importing"
          :disabled="selectedCount === 0"
          @click="importSelected"
        >
          Importar {{ selectedCount || '' }}
          <v-icon end>mdi-content-save-check</v-icon>
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
