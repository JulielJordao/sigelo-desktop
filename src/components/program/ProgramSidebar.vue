<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useProgramStore, type ProgramItem } from '../../stores/programStore';
import { useEventStore } from '../../stores/eventStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useMusicPresentationStore } from '../../stores/presentationStore';
import type { BibleRef } from '../../types/bibleRef';

// Modais reutilizadas
import SearchSongModal from '../songs/SearchSongModal.vue';   // ajuste o caminho se necessário
import AddBibleModal from '../bible/AddBibleModal.vue';        // ajuste o caminho se necessário

const programStore = useProgramStore();
const eventStore = useEventStore();
const mediaStore = useMediaStore();
const musicStore = useMusicPresentationStore();

// ==========================================
// ABAS: Próximas / Anteriores
// ==========================================
const tab = computed<'future' | 'past'>({
    get: () => (programStore.showPast ? 'past' : 'future'),
    set: (v) => (programStore.showPast = v === 'past'),
});

const shownPrograms = computed(() =>
    programStore.showPast ? programStore.pastPrograms : programStore.futurePrograms,
);

// ==========================================
// CONTROLE DE MODAIS / DIÁLOGOS
// ==========================================
const showSongSearch = ref(false);
const showBibleModal = ref(false);
const showMediaPicker = ref(false);
const showImportDialog = ref(false);
const showProgramDialog = ref(false); // criar/editar (nome + data + hora)

const importing = ref(false);
const importShowPast = ref(false);
const mediaSearch = ref('');

// ==========================================
// FORM DE CRIAR / EDITAR (nome + data + horário)
// ==========================================
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref<string | null>(null);
const formName = ref('');
const formDate = ref<Date | null>(new Date());
const formTime = ref('19:00');

const startOfTodayMs = () => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
};

const timeFromDate = (iso: string | Date) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const combineDateTime = (date: Date, time: string) => {
    const [h, m] = (time || '00:00').split(':').map((n) => parseInt(n, 10));
    const d = new Date(date);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
};

const onCreateNew = () => {
    dialogMode.value = 'create';
    editingId.value = null;
    formName.value = 'Nova Programação';
    formDate.value = new Date();
    formTime.value = '19:00';
    showProgramDialog.value = true;
};

const openEdit = (p: { _id: string; name: string; date: string }) => {
    dialogMode.value = 'edit';
    editingId.value = p._id;
    formName.value = p.name;
    formDate.value = new Date(p.date);
    formTime.value = timeFromDate(p.date);
    showProgramDialog.value = true;
};

const saveProgram = () => {
    const date = combineDateTime(formDate.value ?? new Date(), formTime.value);
    if (dialogMode.value === 'create') {
        programStore.createProgram(formName.value, date);
    } else if (editingId.value) {
        programStore.updateProgramMeta(editingId.value, formName.value, date);
    }
    showProgramDialog.value = false;
};

// ==========================================
// IMPORTAR DE EVENTO (futuros por padrão)
// ==========================================
const openImportDialog = async () => {
    if (!eventStore.events || eventStore.events.length === 0) {
        await eventStore.loadEvents();
    }
    importShowPast.value = false;
    showImportDialog.value = true;
};

const importableEvents = computed(() => {
    let list = [...(eventStore.events || [])];
    if (!importShowPast.value) {
        const today = startOfTodayMs();
        list = list.filter((e) => new Date(e.date).getTime() >= today);
    }
    // Mais próximos primeiro
    return list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
});

const doImportEvent = async (event: any) => {
    importing.value = true;
    try {
        await eventStore.getSongsForEvent(event);
        programStore.importFromEvent(event, eventStore.songsByEvent);
        showImportDialog.value = false;
    } finally {
        importing.value = false;
    }
};

// ==========================================
// ADICIONAR ITENS
// ==========================================
const openMediaPicker = async () => {
    showMediaPicker.value = true;
};

const onAddSong = (song: any) => programStore.addSong(song);
const onAddMedia = (media: any) => {
    programStore.addMedia(media);
    showMediaPicker.value = false;
};
const onAddBible = (payload: { ref: BibleRef; source: string }) =>
    programStore.addBible(payload.ref, payload.source);

const filteredMedia = computed(() => {
    const q = mediaSearch.value.trim().toLowerCase();
    const list = mediaStore.mediaFiles || [];
    if (!q) return list;
    return list.filter((m) => m.name.toLowerCase().includes(q));
});

// ==========================================
// APRESENTAR ITEM (play)
// ==========================================
const presentItem = (item: ProgramItem) => {
    if (item.type === 'song') {
        musicStore.setCustomSong(item.payload);
    } else if (item.type === 'media') {
        // TODO: troque pela sua ação real de apresentar mídia, se houver.
        mediaStore.setFixedMedia(item.payload);
    } else if (item.type === 'bible') {
        // TODO: ligue na sua ação real de apresentar a passagem bíblica.
        // Ex.: presentationStore.openBibleReference(item.payload.ref, item.payload.source)
        console.warn('[Programação] Conecte a apresentação de Bíblia:', item.payload);
    }
};

// ==========================================
// DRAG & DROP (reordenar) + setas
// ==========================================
const dragIndex = ref<number | null>(null);
const overIndex = ref<number | null>(null);

const onDragStart = (i: number) => (dragIndex.value = i);
const onDragOver = (i: number, e: DragEvent) => {
    e.preventDefault();
    overIndex.value = i;
};
const onDrop = (i: number) => {
    if (dragIndex.value !== null) programStore.moveItem(dragIndex.value, i);
    dragIndex.value = null;
    overIndex.value = null;
};
const onDragEnd = () => {
    dragIndex.value = null;
    overIndex.value = null;
};

// ==========================================
// HELPERS DE EXIBIÇÃO
// ==========================================
const formatDate = (dateString: string | Date) =>
    new Date(dateString).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
    });

const shortDate = (dateString: string | Date) =>
    new Date(dateString).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
    });

const timeLabel = (dateString: string | Date) =>
    new Date(dateString).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
    });

const typeColor = (t: ProgramItem['type']) =>
    t === 'song' ? 'primary' : t === 'media' ? 'deep-purple' : 'teal';

onMounted(async () => {
    await programStore.loadPrograms();
});
</script>

<template>
    <div class="d-flex flex-column fill-height">
        <div class="d-flex flex-column fill-height bg-grey-lighten-4 position-relative">

            <!-- ===================== TOOLBAR ===================== -->
            <div class="bg-surface elevation-1 z-10" style="position: sticky; top: 0; z-index: 10;">
                <v-toolbar density="compact" color="transparent" elevation="0">
                    <v-toolbar-title class="text-subtitle-1 font-weight-bold">
                        <v-icon start color="primary">mdi-playlist-music</v-icon> Programação
                    </v-toolbar-title>
                    <v-spacer></v-spacer>

                    <v-btn v-if="programStore.currentProgram" size="small" variant="tonal" color="primary"
                        @click="programStore.closeProgram()" prepend-icon="mdi-arrow-left" class="mr-2 text-none">
                        Voltar
                    </v-btn>

                    <v-menu v-else location="bottom end">
                        <template v-slot:activator="{ props }">
                            <v-btn v-bind="props" icon="mdi-plus" size="small" color="primary" variant="tonal"
                                class="mr-2"></v-btn>
                        </template>
                        <v-list density="compact" nav>
                            <v-list-item @click="onCreateNew" prepend-icon="mdi-file-plus-outline"
                                title="Nova programação"></v-list-item>
                            <v-list-item @click="openImportDialog" prepend-icon="mdi-calendar-import"
                                title="Importar de evento"></v-list-item>
                        </v-list>
                    </v-menu>
                </v-toolbar>
            </div>

            <div class="bg-surface-light flex-grow-1 overflow-y-auto pa-3">
                <v-slide-y-transition mode="out-in">

                    <!-- ================== MODO LISTA ================== -->
                    <div v-if="!programStore.currentProgram" :key="'list'">
                        <v-btn-toggle v-model="tab" mandatory density="comfortable" color="primary" variant="outlined"
                            divided class="w-100 mb-3">
                            <v-btn value="future" class="flex-grow-1 text-none">
                                <v-icon start size="small">mdi-calendar-arrow-right</v-icon> Próximas
                            </v-btn>
                            <v-btn value="past" class="flex-grow-1 text-none">
                                <v-icon start size="small">mdi-history</v-icon> Anteriores
                            </v-btn>
                        </v-btn-toggle>

                        <template v-if="shownPrograms.length > 0">
                            <v-card v-for="p in shownPrograms" :key="p._id"
                                class="mb-2 border-sm rounded-lg cursor-pointer transition-all elevation-1" hover
                                @click="programStore.openProgram(p._id)">
                                <div class="pa-3 d-flex align-center">
                                    <v-avatar color="primary" size="40" variant="tonal" class="mr-3">
                                        <v-icon>mdi-playlist-music</v-icon>
                                    </v-avatar>
                                    <div class="flex-grow-1 overflow-hidden">
                                        <div class="text-subtitle-2 font-weight-bold text-truncate">{{ p.name }}</div>
                                        <div class="text-caption text-grey">
                                            <v-icon size="x-small" start>mdi-calendar</v-icon>{{ shortDate(p.date) }}
                                            <v-icon size="x-small" start class="ml-1">mdi-clock-outline</v-icon>{{
                                            timeLabel(p.date) }}
                                            <span class="mx-1">•</span>{{ p.items.length }} itens
                                        </div>
                                    </div>

                                    <v-menu location="bottom end">
                                        <template v-slot:activator="{ props }">
                                            <v-btn v-bind="props" icon="mdi-dots-vertical" size="small" variant="text"
                                                color="grey" @click.stop></v-btn>
                                        </template>
                                        <v-list density="compact" nav>
                                            <v-list-item @click.stop="openEdit(p)" prepend-icon="mdi-pencil"
                                                title="Editar"></v-list-item>
                                            <v-list-item @click.stop="programStore.deleteProgram(p._id)"
                                                prepend-icon="mdi-delete" title="Excluir"
                                                base-color="error"></v-list-item>
                                        </v-list>
                                    </v-menu>
                                </div>
                            </v-card>
                        </template>

                        <div v-else class="text-center pa-6 mt-4 bg-white rounded-lg border-sm border-dashed">
                            <v-icon size="40" color="grey-lighten-2" class="mb-2">mdi-playlist-remove</v-icon>
                            <p class="text-caption text-grey-darken-1 mb-3">
                                {{ programStore.showPast ? 'Nenhuma programação anterior.' : 'Nenhuma programação futura ainda.' }}
                            </p>
                            <v-btn size="small" color="primary" variant="tonal" prepend-icon="mdi-plus"
                                @click="onCreateNew">
                                Nova programação
                            </v-btn>
                        </div>
                    </div>

                    <!-- ================== MODO DETALHE ================== -->
                    <div v-else :key="'detail-' + programStore.currentProgram._id">
                        <div
                            class="bg-white d-flex align-center justify-space-between mb-3 pl-2 pr-1 py-1 rounded-lg border-sm elevation-1">
                            <div class="overflow-hidden mr-2">
                                <h3 class="text-subtitle-1 font-weight-bold text-truncate"
                                    :title="programStore.currentProgram.name">
                                    {{ programStore.currentProgram.name }}
                                </h3>
                                <span class="text-caption text-grey d-block text-truncate">
                                    <v-icon size="x-small" start>mdi-calendar</v-icon>{{
                                        formatDate(programStore.currentProgram.date) }}
                                    <v-icon size="x-small" start class="ml-1">mdi-clock-outline</v-icon>{{
                                        timeLabel(programStore.currentProgram.date) }}
                                </span>
                            </div>
                            <div class="d-flex align-center flex-shrink-0">
                                <v-chip size="small" color="primary" variant="tonal" class="mr-1">
                                    {{ programStore.currentProgram.items.length }} itens
                                </v-chip>
                                <v-btn icon="mdi-pencil" size="small" variant="text" color="grey"
                                    @click="openEdit(programStore.currentProgram)"></v-btn>
                            </div>
                        </div>

                        <div class="d-flex ga-2 mb-3 flex-wrap">
                            <v-btn size="small" color="primary" variant="tonal" class="text-none flex-grow-1"
                                prepend-icon="mdi-music-note-plus" @click="showSongSearch = true">Música</v-btn>
                            <v-btn size="small" color="deep-purple" variant="tonal" class="text-none flex-grow-1"
                                prepend-icon="mdi-image-plus" @click="openMediaPicker">Mídia</v-btn>
                            <v-btn size="small" color="teal" variant="tonal" class="text-none flex-grow-1"
                                prepend-icon="mdi-book-plus" @click="showBibleModal = true">Bíblia</v-btn>
                        </div>

                        <v-card v-if="programStore.currentProgram.items.length > 0" class="border-sm rounded-lg"
                            elevation="0">
                            <v-list density="compact" class="bg-transparent pa-0">
                                <v-list-item v-for="(item, index) in programStore.currentProgram.items" :key="item.id"
                                    class="border-b program-item"
                                    :class="{ 'drag-over': overIndex === index, 'dragging': dragIndex === index }"
                                    draggable="true" @dragstart="onDragStart(index)"
                                    @dragover="onDragOver(index, $event)" @drop="onDrop(index)" @dragend="onDragEnd">
                                    <template v-slot:prepend>
                                        <v-icon size="small" color="grey-lighten-1" class="mr-1"
                                            style="cursor: grab;">mdi-drag-vertical</v-icon>
                                        <div class="text-caption text-grey font-weight-bold mr-2" style="width: 18px;">
                                            {{ index + 1 }}</div>
                                        <v-avatar :color="typeColor(item.type)" size="28" variant="tonal" class="mr-2">
                                            <v-icon size="small">{{ item.icon }}</v-icon>
                                        </v-avatar>
                                    </template>

                                    <v-list-item-title class="font-weight-bold text-subtitle-2 text-truncate">{{
                                        item.title
                                        }}</v-list-item-title>
                                    <v-list-item-subtitle class="text-caption text-truncate">{{ item.subtitle
                                        }}</v-list-item-subtitle>

                                    <template v-slot:append>
                                        <v-chip v-if="item.tone" size="x-small" color="secondary" variant="flat"
                                            class="font-weight-bold mr-1">{{ item.tone }}</v-chip>
                                        <v-btn icon="mdi-play-circle-outline" size="small" color="primary"
                                            variant="text" @click="presentItem(item)"></v-btn>
                                        <v-menu location="bottom end">
                                            <template v-slot:activator="{ props }">
                                                <v-btn v-bind="props" icon="mdi-dots-vertical" size="x-small"
                                                    variant="text" color="grey"></v-btn>
                                            </template>
                                            <v-list density="compact" nav>
                                                <v-list-item :disabled="index === 0"
                                                    @click="programStore.moveItem(index, index - 1)"
                                                    prepend-icon="mdi-arrow-up" title="Subir"></v-list-item>
                                                <v-list-item
                                                    :disabled="index === programStore.currentProgram.items.length - 1"
                                                    @click="programStore.moveItem(index, index + 1)"
                                                    prepend-icon="mdi-arrow-down" title="Descer"></v-list-item>
                                                <v-divider></v-divider>
                                                <v-list-item @click="programStore.removeItem(item.id)"
                                                    prepend-icon="mdi-delete" title="Remover"
                                                    base-color="error"></v-list-item>
                                            </v-list>
                                        </v-menu>
                                    </template>
                                </v-list-item>
                            </v-list>
                        </v-card>

                        <div v-else class="text-center pa-6 bg-white rounded-lg border-sm border-dashed">
                            <v-icon size="40" color="grey-lighten-2" class="mb-2">mdi-playlist-plus</v-icon>
                            <p class="text-caption text-grey-darken-1">Programação vazia. Adicione músicas, mídias ou
                                passagens acima.</p>
                        </div>
                    </div>
                </v-slide-y-transition>
            </div>
        </div>

        <!-- ===================== MODAIS ===================== -->
        <SearchSongModal v-model="showSongSearch" emit-only @select="onAddSong" />
        <AddBibleModal v-model="showBibleModal" @add-reference="onAddBible" />

        <!-- Criar / Editar programação (nome + data + horário) -->
        <v-dialog v-model="showProgramDialog" max-width="420">
            <v-card rounded="lg">
                <v-toolbar color="primary" density="compact">
                    <v-toolbar-title class="text-subtitle-1 font-weight-bold">
                        {{ dialogMode === 'create' ? 'Nova programação' : 'Editar programação' }}
                    </v-toolbar-title>
                    <v-spacer></v-spacer>
                    <v-btn icon="mdi-close" variant="text" @click="showProgramDialog = false"></v-btn>
                </v-toolbar>

                <v-card-text class="pa-4">
                    <v-text-field v-model="formName" label="Nome" variant="outlined" density="comfortable" hide-details
                        autofocus prepend-inner-icon="mdi-format-title" class="mb-3"></v-text-field>

                    <div class="d-flex ga-2">
                        <v-menu :close-on-content-click="false" location="bottom start">
                            <template v-slot:activator="{ props }">
                                <v-text-field v-bind="props" :model-value="formDate ? shortDate(formDate) : ''"
                                    label="Data" readonly variant="outlined" density="comfortable" hide-details
                                    prepend-inner-icon="mdi-calendar" class="flex-grow-1"
                                    style="min-width: 150px;"></v-text-field>
                            </template>
                            <v-date-picker v-model="formDate" color="primary" hide-header></v-date-picker>
                        </v-menu>

                        <v-text-field v-model="formTime" type="time" label="Horário" variant="outlined"
                            density="comfortable" hide-details prepend-inner-icon="mdi-clock-outline"
                            style="max-width: 140px;"></v-text-field>
                    </div>
                </v-card-text>

                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="showProgramDialog = false">Cancelar</v-btn>
                    <v-btn color="primary" variant="tonal" @click="saveProgram">Salvar</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Seletor de mídia -->
        <v-dialog v-model="showMediaPicker" max-width="600">
            <v-card rounded="lg">
                <v-toolbar color="deep-purple" density="compact">
                    <v-toolbar-title class="text-subtitle-1 font-weight-bold">Adicionar Mídia</v-toolbar-title>
                    <v-spacer></v-spacer>
                    <v-btn icon="mdi-close" variant="text" @click="showMediaPicker = false"></v-btn>
                </v-toolbar>
                <v-card-text class="pa-3">
                    <v-text-field v-model="mediaSearch" label="Buscar mídia..." variant="outlined" density="comfortable"
                        hide-details clearable prepend-inner-icon="mdi-magnify" class="mb-3"></v-text-field>
                    <v-list v-if="filteredMedia.length > 0" class="border rounded-lg" density="compact"
                        style="max-height: 400px; overflow-y: auto;">
                        <v-list-item v-for="media in filteredMedia" :key="media.id" @click="onAddMedia(media)" hover
                            class="cursor-pointer">
                            <template v-slot:prepend>
                                <v-avatar rounded="lg" size="40" class="mr-2">
                                    <v-img v-if="!media.isVideo" :src="media.url" cover></v-img>
                                    <v-icon v-else color="deep-purple">mdi-play-box</v-icon>
                                </v-avatar>
                            </template>
                            <v-list-item-title class="text-subtitle-2 text-truncate">{{ media.name
                                }}</v-list-item-title>
                            <v-list-item-subtitle class="text-caption">{{ media.isVideo ? 'Vídeo' : 'Imagem' }} • {{
                                media.category }}</v-list-item-subtitle>
                        </v-list-item>
                    </v-list>
                    <div v-else class="text-center py-8 text-grey">
                        <v-icon size="40" color="grey-lighten-2" class="mb-2">mdi-image-off</v-icon>
                        <p class="text-caption">Nenhuma mídia encontrada.</p>
                    </div>
                </v-card-text>
            </v-card>
        </v-dialog>

        <!-- Importar de evento (futuros por padrão) -->
        <v-dialog v-model="showImportDialog" max-width="450">
            <v-card rounded="lg">
                <v-toolbar color="primary" density="compact">
                    <v-toolbar-title class="text-subtitle-1 font-weight-bold">Importar de um evento</v-toolbar-title>
                    <v-spacer></v-spacer>
                    <v-btn icon="mdi-close" variant="text" @click="showImportDialog = false"></v-btn>
                </v-toolbar>
                <v-card-text class="pa-3">
                    <div class="d-flex align-center justify-space-between mb-2 px-1">
                        <span class="text-caption text-grey-darken-1 font-weight-medium text-uppercase">
                            {{ importShowPast ? 'Todos os eventos' : 'Eventos futuros' }}
                        </span>
                        <v-switch v-model="importShowPast" label="Mostrar anteriores" density="compact" color="primary"
                            hide-details inset class="flex-grow-0"></v-switch>
                    </div>

                    <v-list v-if="importableEvents.length > 0" class="border rounded-lg" density="compact"
                        style="max-height: 380px; overflow-y: auto;">
                        <v-list-item v-for="ev in importableEvents" :key="ev._id" @click="doImportEvent(ev)"
                            :disabled="importing" hover class="cursor-pointer">
                            <template v-slot:prepend>
                                <v-avatar color="primary" size="36" variant="tonal" class="mr-2">
                                    <v-icon>mdi-calendar-check</v-icon>
                                </v-avatar>
                            </template>
                            <v-list-item-title class="text-subtitle-2 font-weight-bold text-truncate">{{ ev.name
                                }}</v-list-item-title>
                            <v-list-item-subtitle class="text-caption">{{ shortDate(ev.date) }} • {{ timeLabel(ev.date)
                                }}</v-list-item-subtitle>
                        </v-list-item>
                    </v-list>

                    <div v-else class="text-center py-6 text-grey">
                        <v-icon size="40" color="grey-lighten-2" class="mb-2">mdi-calendar-remove</v-icon>
                        <p class="text-caption">{{ importShowPast ? 'Nenhum evento disponível.' 
                        : 'Nenhum evento futuro para importar.' }}</p>
                    </div>

                    <v-progress-linear v-if="importing" indeterminate color="primary" class="mt-3"></v-progress-linear>
                </v-card-text>
            </v-card>
        </v-dialog>

    </div>
</template>

<style scoped>
.transition-all {
    transition: all 0.3s ease;
}

.w-100 {
    width: 100% !important;
}

.program-item {
    transition: background-color 0.15s ease, opacity 0.15s ease;
}

.program-item.dragging {
    opacity: 0.4;
}

.program-item.drag-over {
    background-color: rgba(var(--v-theme-primary), 0.08);
    box-shadow: inset 0 2px 0 rgb(var(--v-theme-primary));
}
</style>