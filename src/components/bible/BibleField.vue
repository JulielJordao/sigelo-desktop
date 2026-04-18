<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue"
import bibleData from "../../data/bible.json"
import type { BibleBook, BibleRef as BibleReference } from "../../types/bibleRef"

const bible = bibleData as BibleBook[]

const props = defineProps<{
  modelValue: BibleReference[]
  label?: string,
  single?: boolean
}>()

const emit = defineEmits<{
  (e: "update:modelValue", value: BibleReference[]): void
}>()

const input = ref<string>("")
const references = ref<BibleReference[]>([...props.modelValue])
const inputRef = ref<HTMLInputElement | null>(null)

const isFocused = ref<boolean>(false)
const error = ref<boolean>(false)
const errorMessage = ref<string>("")
const showSelector = ref(false)

type Stage = "book" | "chapter" | "verseStart" | "verseEnd"
const stage = ref<Stage>("book")

const selectedBook = ref<BibleBook | null>(null)
const selectedChapter = ref<number | null>(null)
const verseStart = ref<number | null>(null)
const verseEnd = ref<number | null>(null)

// Sincroniza quando a prop muda externamente
watch(() => props.modelValue, (newVal) => {
  references.value = [...newVal]
}, { deep: true })

const filteredBooks = computed(() => {
  if (!input.value || stage.value !== 'book') return bible
  return bible.filter(b =>
    b.name.toLowerCase().includes(input.value.toLowerCase().trim()) ||
    b.abbr.toLowerCase().includes(input.value.toLowerCase().trim())
  )
})

const maxVerse = computed(() => {
  if (!selectedBook.value || !selectedChapter.value) return 0
  return selectedBook.value.chapters[selectedChapter.value - 1]
})

const currentSelectionText = computed(() => {
  let text = ""
  if (selectedBook.value) text += selectedBook.value.abbr
  if (selectedChapter.value) text += ` > Cap ${selectedChapter.value}`
  if (verseStart.value) text += ` > V. ${verseStart.value}`
  return text
})

watch(input, (newVal) => {
  if (!showSelector.value) return;

  // 1. RECUO (Downgrade): Se apagar o prefixo do livro
  if (stage.value !== 'book' && selectedBook.value) {
    const expectedPrefix = (selectedBook.value.abbr + ' ').toLowerCase();
    if (!newVal.toLowerCase().startsWith(expectedPrefix)) {
      stage.value = 'book';
      selectedBook.value = null;
      selectedChapter.value = null;
      verseStart.value = null;
      verseEnd.value = null;
    }
  }

  if (!newVal) return;

  // 2. AVANÇO LIVRO -> CAPÍTULO (Mc + Espaço -> Mc 3)
  if (stage.value === 'book' && props.single) {
    if (filteredBooks.value.length === 1 && newVal.endsWith(' ')) {
      selectBook(filteredBooks.value[0]);
      return;
    }
  }

  // 3. LOGICA DE PONTUAÇÃO E INTERVALO (Mc 3 -> Mc 3:2-7)
  if (selectedBook.value) {
    //const bookAbbr = selectedBook.value.abbr;
    
    // CASO A: Mc 3 + Espaço -> Mc 3:
    if (stage.value === 'chapter' && newVal.endsWith(' ')) {
      const parts = newVal.trim().split(' ');
      const lastPart = parts[parts.length - 1];
      if (lastPart.match(/^\d+$/)) {
        const chapNum = parseInt(lastPart);
        if (chapNum <= selectedBook.value.chapters.length) {
          input.value = newVal.trim() + ':';
          selectChapter(chapNum);
          return;
        }
      }
    }

    // CASO B: Detecção de Versículos e Hífen (Intervalos)
    // Regex para capturar padrões como ":2", ":2-", ":2-7"
    const verseMatch = newVal.match(/:(\d+)(-(\d+)?)?$/);
    
    if (verseMatch) {
      const vStart = parseInt(verseMatch[1]);
      const hasHyphen = newVal.includes('-');
      const vEnd = verseMatch[3] ? parseInt(verseMatch[3]) : null;

      // Valida e define o Versículo Inicial
      if (vStart > 0 && vStart <= maxVerse.value) {
        verseStart.value = vStart;
        
        if (hasHyphen) {
          stage.value = 'verseEnd';
          // Se houver um número após o hífen, valida como Versículo Final
          if (vEnd && vEnd > vStart && vEnd <= maxVerse.value) {
            verseEnd.value = vEnd;
          } else {
            verseEnd.value = null; // Usuário ainda está digitando o fim
          }
        } else {
          stage.value = 'verseStart';
          verseEnd.value = null;
        }
      }
    }
  }
});

/* ---------------- AÇÕES DO SELETOR ---------------- */

function selectBook(book: BibleBook) {
  selectedBook.value = book
  stage.value = "chapter"
  input.value = book.abbr + " "
  inputRef.value?.focus() 
}

function selectChapter(chapter: number) {
  selectedChapter.value = chapter
  stage.value = "verseStart"
  input.value = `${selectedBook.value?.abbr} ${chapter}:`
}

function handleVerseClick(n: number) {
  if (stage.value === "verseStart") {
    verseStart.value = n
    stage.value = "verseEnd"
  } else {
    if (n < (verseStart.value || 0)) {
      verseEnd.value = verseStart.value
      verseStart.value = n
    } else {
      verseEnd.value = n
    }
    confirmReference()
  }
}

function confirmReference() {
  if (!selectedBook.value || !selectedChapter.value) return

  const newRef: BibleReference = {
    book: selectedBook.value.abbr,
    chapter: selectedChapter.value,
    verseStart: verseStart.value,
    verseEnd: verseEnd.value ?? verseStart.value
  }

  if (props.single) {
    references.value = [newRef] 
  } else {
    references.value.push(newRef) 
  }

  errorMessage.value = ""
  emit("update:modelValue", references.value)
  resetSelector()
}

function resetSelector() {
  stage.value = "book"
  selectedBook.value = null
  selectedChapter.value = null
  verseStart.value = null
  verseEnd.value = null
  input.value = ""
  showSelector.value = false
}

function goBack() {
  if (stage.value === "chapter") {
    stage.value = "book"
    selectedBook.value = null
    input.value = ""
  } else if (stage.value === "verseStart") {
    stage.value = "chapter"
    selectedChapter.value = null
    input.value = `${selectedBook.value?.abbr} `
  } else if (stage.value === "verseEnd") {
    stage.value = "verseStart"
    verseStart.value = null
  }
}

/* ---------------- INPUT MANUAL PARSER ---------------- */
function parseInput(text: string): BibleReference | null {
  const clean = text.replace(":", " ").replace("-", " ").replace(".", " ")
  const parts = clean.split(" ").filter(Boolean)

  if (parts.length < 2) return null

  if(parts[0].length == 1 && /[0-9]/.test(parts[0])) {
    parts[0] += ` ${parts[1]}`
    parts.splice(1, 1)
  }

  if(parts[0].toLowerCase() === "salmo") {
    parts[0] = "Salmos"
  }

  const book = bible.find(b =>
    b.name.toLowerCase() === parts[0].toLowerCase() ||
    b.abbr.toLowerCase() === parts[0].toLowerCase()
  )
  if (!book) return null

  const chapter = Number(parts[1])
  if (isNaN(chapter) || chapter > book.chapters.length) return null

  const vStart = parts[2] ? Number(parts[2]) : null
  const vEnd = parts[3] ? Number(parts[3]) : vStart

  return {
    book: book.abbr,
    chapter,
    verseStart: vStart,
    verseEnd: vEnd
  }
}

function addReference(): void {
  if (!input.value.trim()) return

  // 3. Permite finalizar a referência com Enter mesmo se só tiver o Capítulo
  if (stage.value === 'chapter' && selectedBook.value) {
    const rawChapter = parseInt(input.value.replace(selectedBook.value.abbr, '').trim());
    if (rawChapter > 0 && rawChapter <= selectedBook.value.chapters.length) {
      selectedChapter.value = rawChapter;
      confirmReference(); // Finaliza a seleção apenas com o capítulo
      return;
    }
  }

  // Tenta o parser completo
  const parsed = parseInput(input.value)
  if (!parsed) {
    error.value = true
    errorMessage.value = "Referência inválida"
    return
  }
  
  stage.value = "book" 

  if (props.single) {
    references.value = [parsed]
  } else {
    references.value.push(parsed)
  }
  emit("update:modelValue", references.value)
  input.value = ""
  error.value = false
  showSelector.value = true
}

/* ---------------- AUXILIARES ---------------- */
//const isFloating = computed(() => isFocused.value || input.value || references.value.length > 0)

function formatRef(r: BibleReference) {
  let str = `${r.book} ${r.chapter}`
  if (r.verseStart) str += `:${r.verseStart}`
  if (r.verseEnd && r.verseEnd !== r.verseStart) str += `-${r.verseEnd}`
  return str
}

const selectedChip = ref<number | null>(null)

function handleKey(e: KeyboardEvent): void {
  if (selectedChip.value !== null) {
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      if (selectedChip.value > 0) selectedChip.value--
    }
    else if (e.key === "ArrowRight") {
      e.preventDefault()
      if (selectedChip.value < references.value.length - 1) {
        selectedChip.value++
      } else {
        selectedChip.value = null
      }
    }
    else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault()
      const index = selectedChip.value
      references.value.splice(index, 1)
      emit("update:modelValue", references.value)

      if (references.value.length === 0) {
        selectedChip.value = null
      } else if (index >= references.value.length) {
        selectedChip.value = references.value.length - 1
      }
    }
    else if (e.key === "Escape") {
      selectedChip.value = null
    }
    return
  }

    if (e.key === "Enter") {
        e.preventDefault();

        // Se o usuário digitou algo como "Mc 3:2-7" e deu Enter
        if (selectedBook.value && selectedChapter.value && verseStart.value) {
        // O confirmReference já usa verseStart e verseEnd que o watch atualizou
        confirmReference();
        return;
        }

        // Autocomplete de livro se houver apenas um na lista
        if (showSelector.value && stage.value === "book" && filteredBooks.value.length === 1) {
        selectBook(filteredBooks.value[0]);
        return;
        }

        addReference();
  }

  if (e.key === "ArrowLeft" && inputRef.value?.selectionStart === 0 && references.value.length > 0) {
    e.preventDefault()
    selectedChip.value = references.value.length - 1
  }

  if (e.key === "Backspace" && !input.value && references.value.length > 0) {
    references.value.pop()
    emit("update:modelValue", references.value)
  }
}

function clearSelection() {
  if (selectedChip.value !== null) selectedChip.value = null
}

const containerRef = ref<HTMLElement | null>(null)

function handleBlur() {
  isFocused.value = false
  setTimeout(() => {
    if (!isFocused.value) showSelector.value = false
  }, 150)
}

const bookDisplayMode = ref<'both' | 'abbr' | 'full'>('both');

onMounted(() => {
  // Garante que o input receba foco assim que o componente for montado na tela
  inputRef.value?.focus();

  // Recupera a preferência do usuário salva anteriormente
  const savedMode = localStorage.getItem('bibleBookDisplayMode');
  if (savedMode) {
    bookDisplayMode.value = savedMode as 'both' | 'abbr' | 'full';
  }
});

function cycleDisplayMode() {
  const modes: ('both' | 'abbr' | 'full')[] = ['both', 'abbr', 'full'];
  const nextIndex = (modes.indexOf(bookDisplayMode.value) + 1) % modes.length;
  bookDisplayMode.value = modes[nextIndex];
  localStorage.setItem('bibleBookDisplayMode', bookDisplayMode.value);
}
</script>

<template>
  <div ref="containerRef" class="w-100 position-relative">
    
    <v-text-field
      ref="inputRef"
      v-model="input"
      :label="references.length === 0 ? (label || 'Referência Bíblica') : ''"
      variant="outlined"
      color="primary"
      bg-color="surface"
      :error="error"
      :error-messages="error ? errorMessage : ''"
      autofocus
      hide-details="auto"
      class="text-body-1 font-weight-medium"
      @focus="isFocused = true; showSelector = true; error = false"
      @blur="handleBlur"
      @keydown="handleKey"
      @input="clearSelection"
    >
      <template v-slot:prepend-inner v-if="references.length > 0">
        <v-chip
          v-for="(r, i) in references"
          :key="i"
          closable
          size="small"
          :color="selectedChip === i ? 'primary' : 'surface-variant'"
          :variant="selectedChip === i ? 'flat' : 'elevated'"
          elevation="1"
          class="font-weight-bold mr-2 my-1 transition-all"
          @click.stop="selectedChip = i"
          @click:close="references.splice(i, 1); emit('update:modelValue', references); selectedChip = null"
        >
          {{ formatRef(r) }}
        </v-chip>
      </template>
    </v-text-field>

    <v-expand-transition>
      <v-card 
        v-if="showSelector"
        elevation="0" 
        class="w-100 mt-2 rounded-lg border bg-surface"
        style="display: flex; flex-direction: column;"
      >
        <div class="d-flex align-center justify-space-between pa-2 border-b bg-surface-light flex-shrink-0">
          <div>
            <v-btn 
              v-if="stage !== 'book'" 
              variant="text" 
              size="small" 
              color="primary" 
              prepend-icon="mdi-arrow-left"
              @mousedown.prevent="goBack"
            >
              Voltar
            </v-btn>
          </div>
          
          <v-chip v-if="stage !== 'book'" size="small" variant="tonal" class="font-weight-medium">
            {{ currentSelectionText }}
          </v-chip>

          <v-btn 
            v-if="stage === 'book'" 
            icon="mdi-view-grid-outline" 
            variant="text" 
            size="small" 
            color="medium-emphasis"
            class="ml-auto"
            title="Mudar visualização"
            @mousedown.prevent="cycleDisplayMode"
          ></v-btn>
        </div>

        <div class="px-3 pt-2 pb-1 text-caption font-weight-bold text-medium-emphasis text-uppercase tracking-wider flex-shrink-0">
          {{ stage === 'book' ? 'Selecione o Livro' : stage === 'chapter' ? 'Selecione o Capítulo' : stage === 'verseStart' ? 'Versículo Inicial' : 'Versículo Final (Opcional)' }}
        </div>

        <div class="pa-3 overflow-y-auto flex-grow-1 custom-scrollbar" style="max-height: 380px;">

          <div v-if="stage === 'book'" class="bible-grid book-grid">
            <v-card
              v-for="book in filteredBooks" 
              :key="book.abbr"
              hover
              ripple
              variant="tonal"
              color="primary"
              class="d-flex flex-column align-center justify-center transition-all px-1"
              style="aspect-ratio: 5/4;" 
              @mousedown.prevent="selectBook(book)"
            >
              <span v-if="bookDisplayMode === 'abbr'" class="text-h6 font-weight-bold">{{ book.abbr }}</span>
              
              <span v-if="bookDisplayMode === 'full'" class="text-caption font-weight-bold text-center" style="line-height: 1.1; word-break: break-word;">{{ book.name }}</span>
              
              <template v-if="bookDisplayMode === 'both'">
                <span class="text-subtitle-1 font-weight-bold mb-1">{{ book.abbr }}</span>
                <span class="text-[10px] text-uppercase text-center w-100" style="opacity: 0.7; line-height: 1.1; word-break: break-word;">{{ book.name }}</span>
              </template>
            </v-card>
          </div>

          <div v-if="stage === 'chapter'" class="bible-grid number-grid">
            <v-card
              v-for="(_, i) in selectedBook?.chapters" 
              :key="i"
              hover
              ripple
              variant="outlined"
              class="d-flex align-center justify-center text-subtitle-1 font-weight-bold"
              style="aspect-ratio: 1/1;"
              @mousedown.prevent="selectChapter(i + 1)"
            >
              {{ i + 1 }}
            </v-card>
          </div>

        <div v-if="stage === 'verseStart' || stage === 'verseEnd'" class="bible-grid number-grid">
            <v-card
                v-for="n in maxVerse" 
                :key="n"
                hover
                ripple
                :color="(n === verseStart || n === verseEnd) ? 'primary' : (verseEnd && n > (verseStart || 0) && n < verseEnd ? 'primary' : undefined)"
                :variant="(n === verseStart || n === verseEnd) ? 'flat' : (verseEnd && n > (verseStart || 0) && n < verseEnd ? 'tonal' : 'outlined')"
                class="d-flex align-center justify-center text-subtitle-2 font-weight-bold transition-all"
                :class="{ 'opacity-40': verseStart && n < verseStart && !verseEnd }"
                style="aspect-ratio: 1/1;"
                @mousedown.prevent="handleVerseClick(n)"
            >
                {{ n }}
            </v-card>
        </div>

        </div>
      </v-card>
    </v-expand-transition>
  </div>
</template>

<style scoped>
/* CSS Grid Flexível */
.bible-grid {
  display: grid;
  gap: 8px;
}

/* Livros ganham largura mínima de 88px (ideal para caber textos longos) */
.book-grid {
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
}

/* Números ocupam menos espaço (48px) */
.number-grid {
  grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
}

/* Customização Profissional da Barra de Rolagem */
.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { 
  background-color: rgba(var(--v-theme-on-surface), 0.2); 
  border-radius: 10px; 
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.4); 
}
</style>