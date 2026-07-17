<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { BibleRef } from '../../types/bibleRef';
import BibleSelector from './BibleField.vue'; // Ajuste o caminho do seu seletor
import { useMenuStore } from '../../stores/menuStore';
import {
    fetchPassageFromBibliaOnline,
    resolveBibliaOnlineSlug,
    BIBLIA_ONLINE_DONATION,
    type ScrapedVerse,
} from '../../services/bibliaOnline'; // Ajuste o caminho se necessário

const menuStore = useMenuStore();

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        sources?: string[];
        defaultSource?: string;
    }>(),
    {
        sources: () => ['NVI', 'ACF', 'ARA', 'ARC', 'NTLH', 'KJV'],
        defaultSource: 'ARA',
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (
        e: 'add-reference',
        payload: {
            ref: BibleRef;
            source: string; // versão
            provider: 'bibliaonline' | 'manual';
            reference: string;
            text: string;
            verses: ScrapedVerse[];
            origin: { url: string; label: string; donationUrl: string; extractedAt: string } | null;
        },
    ): void;
}>();

const isOpen = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val),
});

const DONATION_URL = BIBLIA_ONLINE_DONATION;

// ---- estado ----
type Phase = 'select' | 'review';
const phase = ref<Phase>('select');
const selectedSource = ref<string>(props.defaultSource);

const currentSelection = ref<BibleRef[]>([]);
const reviewRef = ref<BibleRef | null>(null);

const bookSlug = ref('');
const provider = ref<'bibliaonline' | 'manual'>('bibliaonline');
const loading = ref(false);
const errorMsg = ref('');
const text = ref('');
const verses = ref<ScrapedVerse[]>([]);
const origin = ref<any>(null);

// ---- helpers ----
const referenceLabel = computed(() => {
    const r = reviewRef.value;
    if (!r) return '';
    const vs = r.verseStart ?? null;
    const ve = r.verseEnd ?? vs;
    const range = vs == null ? '(capítulo inteiro)' : vs === ve ? `${vs}` : `${vs}-${ve}`;
    return `${r.book} ${r.chapter}${vs == null ? '' : ':' + range}`;
});

const resetReview = () => {
    provider.value = 'bibliaonline';
    loading.value = false;
    errorMsg.value = '';
    text.value = '';
    verses.value = [];
    origin.value = null;
};

const close = () => {
    isOpen.value = false;
    phase.value = 'select';
    currentSelection.value = [];
    reviewRef.value = null;
    resetReview();
};

const backToSelect = () => {
    phase.value = 'select';
    currentSelection.value = [];
    reviewRef.value = null;
    resetReview();
};

// Quando o usuário escolhe a referência, vamos para a etapa de revisão (não fecha)
watch(currentSelection, (val) => {
    if (val && val.length > 0) {
        reviewRef.value = val[0];
        bookSlug.value = resolveBibliaOnlineSlug(val[0].book);
        resetReview();
        phase.value = 'review';
    }
});

const fetchText = async () => {
    if (!reviewRef.value) return;
    loading.value = true;
    errorMsg.value = '';
    try {
        const res = await fetchPassageFromBibliaOnline({
            version: selectedSource.value,
            book: bookSlug.value,
            chapter: reviewRef.value.chapter,
            verseStart: reviewRef.value.verseStart ?? null,
            verseEnd: reviewRef.value.verseEnd ?? null,
            bookName: reviewRef.value.book,
        });
        text.value = res.text;
        verses.value = res.verses;
        origin.value = res.source;
    } catch (e: any) {
        // O Rust rejeita com uma string (Err(String)); tratamos os dois casos.
        const msg = typeof e === 'string' ? e : (e?.message || 'Erro ao extrair o texto.');
        console.error('[BibliaOnline] falha na extração:', e);
        errorMsg.value = msg;
        origin.value = null;
    } finally {
        loading.value = false;
    }
};

const confirmAdd = () => {
    if (!reviewRef.value) return;
    emit('add-reference', {
        ref: reviewRef.value,
        source: selectedSource.value,
        provider: provider.value,
        reference: referenceLabel.value,
        text: text.value.trim(),
        // No modo manual não guardamos "verses" estruturados
        verses: provider.value === 'bibliaonline' ? verses.value : [],
        origin: provider.value === 'bibliaonline' ? origin.value : null,
    });
    close();
};

watch(provider, (p) => {
    // Ao alternar para manual, mantemos o texto já digitado/baixado (o usuário pode editar).
    if (p === 'manual') {
        // origem some no manual; será re-atribuída só se voltar e buscar de novo
    }
});

watch(isOpen, () => {
    menuStore.setShiftShortcutLocked(isOpen.value);
});
</script>

<template>
    <v-dialog v-model="isOpen" max-width="700" transition="dialog-top-transition" scrim="black">
        <v-card class="glass-modal" rounded="xl" elevation="24">
            <v-toolbar color="transparent" density="compact" class="px-2 mb-2 pt-1 bg-surface-light" border="none">
                <v-icon color="primary" class="ml-3 mr-2 opacity-80">mdi-book-plus</v-icon>
                <v-toolbar-title class="text-subtitle-1 font-weight-bold opacity-80">
                    {{ phase === 'select' ? 'Adicionar Passagem' : 'Revisar e adicionar' }}
                </v-toolbar-title>
                <v-spacer></v-spacer>
                <v-chip size="x-small" variant="text" class="mr-2 text-medium-emphasis">ESC</v-chip>
                <v-btn icon="mdi-close" variant="text" size="small" color="medium-emphasis" @click="close"></v-btn>
            </v-toolbar>

            <!-- ================= ETAPA 1: escolher referência ================= -->
            <v-card-text v-if="phase === 'select'" class="pa-4 pt-2 pb-6">
                <v-select v-model="selectedSource" :items="sources" label="Versão" variant="outlined"
                    density="comfortable" hide-details prepend-inner-icon="mdi-translate" class="mb-4"></v-select>

                <BibleSelector v-if="isOpen" v-model="currentSelection" :single="true"
                    label="Digite o livro, capítulo e verso..." />
            </v-card-text>

            <!-- ================= ETAPA 2: revisar / buscar / manual ================= -->
            <v-card-text v-else class="pa-4 pt-2 pb-4">
                <div class="d-flex align-center flex-wrap ga-2 mb-4">
                    <v-chip color="primary" variant="tonal" prepend-icon="mdi-book-open-page-variant">
                        {{ referenceLabel }}
                    </v-chip>
                    <v-chip color="secondary" variant="tonal">{{ selectedSource }}</v-chip>
                    <v-spacer></v-spacer>
                    <v-btn size="small" variant="text" prepend-icon="mdi-arrow-left" class="text-none"
                        @click="backToSelect">
                        Trocar referência
                    </v-btn>
                </div>

                <!-- Fonte do texto -->
                <v-btn-toggle v-model="provider" mandatory divided density="comfortable" color="primary"
                    variant="outlined" class="w-100 mb-4">
                    <v-btn value="bibliaonline" class="flex-grow-1 text-none">
                        <v-icon start size="small">mdi-cloud-download</v-icon> Bíblia Online
                    </v-btn>
                    <v-btn value="manual" class="flex-grow-1 text-none">
                        <v-icon start size="small">mdi-pencil</v-icon> Manual
                    </v-btn>
                </v-btn-toggle>

                <!-- Modo Bíblia Online -->
                <template v-if="provider === 'bibliaonline'">
                    <div class="d-flex ga-2 mb-3">
                        <v-text-field v-model="bookSlug" label="Livro (slug do Bíblia Online)"
                            hint="Ex.: mt, gn, sl, 1co. Confira na URL do site se der erro." persistent-hint
                            variant="outlined" density="comfortable" prepend-inner-icon="mdi-link-variant"
                            style="max-width: 260px;"></v-text-field>
                        <v-btn color="primary" variant="flat" class="text-none flex-grow-1"
                            prepend-icon="mdi-cloud-download" :loading="loading" @click="fetchText">
                            Buscar texto
                        </v-btn>
                    </div>

                    <v-alert v-if="errorMsg" type="warning" variant="tonal" density="compact" class="mb-3 text-caption">
                        {{ errorMsg }}
                    </v-alert>
                </template>

                <!-- Área de texto (editável nos dois modos) -->
                <v-textarea v-model="text"
                    :label="provider === 'manual' ? 'Digite o texto da passagem' : 'Texto extraído (pode editar)'"
                    variant="outlined" density="comfortable" rows="6" auto-grow hide-details class="mb-3"></v-textarea>

                <!-- Aviso de origem + doação -->
                <v-alert v-if="provider === 'bibliaonline' && origin" type="info" variant="tonal" density="compact"
                    class="mb-1 text-caption">
                    <div>
                        Texto extraído de <strong>{{ origin.label }}</strong>.
                    </div>
                    <div class="mt-1">
                        <a :href="origin.url" target="_blank" rel="noopener" class="text-decoration-none">Ver no
                            site</a>
                        <span class="mx-1">•</span>
                        <a :href="DONATION_URL" target="_blank" rel="noopener"
                            class="font-weight-bold text-decoration-none">
                            Doar / apoiar o projeto
                        </a>
                    </div>
                </v-alert>

                <p v-else class="text-caption text-medium-emphasis mb-1">
                    Conteúdo de domínio do Bíblia Online.
                    <a :href="DONATION_URL" target="_blank" rel="noopener"
                        class="font-weight-bold text-decoration-none">Doe aqui</a>.
                </p>
            </v-card-text>

            <v-card-actions v-if="phase === 'review'" class="px-4 pb-4">
                <v-spacer></v-spacer>
                <v-btn variant="text" @click="close">Cancelar</v-btn>
                <v-btn color="primary" variant="flat" class="text-none" :disabled="!text.trim()" @click="confirmAdd">
                    Adicionar à programação
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<style scoped>
.glass-modal {
    background: rgba(var(--v-theme-surface), 0.75) !important;
    backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.2) !important;
}

.opacity-80 {
    opacity: 0.8;
}

.w-100 {
    width: 100% !important;
}
</style>