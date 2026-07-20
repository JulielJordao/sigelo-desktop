<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useProgramStore, type ProgramItem } from '../../stores/programStore';
import { useEventStore } from '../../stores/eventStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useMusicPresentationStore } from '../../stores/presentationStore';
import { usePresentationStore } from '../../stores/usePresentationStore'; // presets/temas
import type { BibleRef } from '../../types/bibleRef';

import MediaPickerModal from '../media/MediaPickerModal.vue';
import ModalSelectPreset from '../presets/modalSelectPreset.vue';

import SearchSongModal from '../songs/SearchSongModal.vue';   // ajuste o caminho se necessário
import AddBibleModal from '../bible/AddBibleModal.vue';        // ajuste o caminho se necessário

import { useSongCacheStore } from '../../stores/songCacheStore';
import { emit as tauriEmit } from '@tauri-apps/api/event';

import MediaPreviewModal from '../media/MediaPreviewModal.vue';
import { useStatusPresentationStore } from '../../stores/statusPresentationStore';
import { useConfigStore } from '../../stores/useConfigStore';

const statusStore = useStatusPresentationStore();
const configStore = useConfigStore();

// estado do preview
const showMediaPreview = ref(false);
const mediaPreviewFile = ref<any>(null)

const songCacheStore = useSongCacheStore();

const programStore = useProgramStore();
const eventStore = useEventStore();
const mediaStore = useMediaStore();
const musicStore = useMusicPresentationStore();
const presentationStore = usePresentationStore();

// ===== abas =====
const tab = computed<'future' | 'past'>({
    get: () => (programStore.showPast ? 'past' : 'future'),
    set: (v) => (programStore.showPast = v === 'past'),
});
const shownPrograms = computed(() =>
    programStore.showPast ? programStore.pastPrograms : programStore.futurePrograms,
);

const currentPresetForItem = computed(() =>
    programStore.currentProgram?.items.find(i => i.id === presetItemId.value)?.presetId ?? null
);

// ===== diálogos =====
const showSongSearch = ref(false);
const showBibleModal = ref(false);
const showMediaPicker = ref(false);
const showImportDialog = ref(false);
const showProgramDialog = ref(false);
const showBibleEdit = ref(false);
const showPresetPicker = ref(false);

const importing = ref(false);
const importShowPast = ref(false);

// contexto de edição (item 2)
const songEditItemId = ref<string | null>(null);
const mediaEditItemId = ref<string | null>(null);
const bibleEditItemId = ref<string | null>(null);
const bibleEditText = ref('');
const presetItemId = ref<string | null>(null);

// ===== criar / editar programação =====
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
    if (dialogMode.value === 'create') programStore.createProgram(formName.value, date);
    else if (editingId.value) programStore.updateProgramMeta(editingId.value, formName.value, date);
    showProgramDialog.value = false;
};

// ===== importar de evento =====
const openImportDialog = async () => {
    if (!eventStore.events || eventStore.events.length === 0) await eventStore.loadEvents();
    importShowPast.value = false;
    showImportDialog.value = true;
};
const importableEvents = computed(() => {
    let list = [...(eventStore.events || [])];
    if (!importShowPast.value) {
        const today = startOfTodayMs();
        list = list.filter((e) => new Date(e.date).getTime() >= today);
    }
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

// ===== adicionar / substituir itens =====
const openAddSong = () => { songEditItemId.value = null; showSongSearch.value = true; };
const openMediaPicker = async () => {
    mediaEditItemId.value = null;
    showMediaPicker.value = true;
};

const onAddSong = (song: any) => {
    if (songEditItemId.value) {
        programStore.replaceSong(songEditItemId.value, song);
        songEditItemId.value = null;
    } else {
        programStore.addSong(song);
    }
};
const onAddMedia = (media: any) => {
    if (mediaEditItemId.value) {
        programStore.replaceMedia(mediaEditItemId.value, media);
        mediaEditItemId.value = null;
    } else {
        programStore.addMedia(media);
    }
    showMediaPicker.value = false;
};
const onAddBible = (payload: {
    ref: BibleRef; source: string; provider?: string;
    reference?: string; text?: string; verses?: any[]; origin?: any;
}) =>
    programStore.addBible(payload.ref, payload.source, {
        provider: payload.provider,
        reference: payload.reference,
        text: payload.text,
        verses: payload.verses,
        origin: payload.origin,
    });

// ===== EDITAR item (item 2) =====
const onEditItem = async (item: ProgramItem) => {
    if (item.type === 'song') {
        songEditItemId.value = item.id;
        showSongSearch.value = true;
    } else if (item.type === 'media') {
        mediaEditItemId.value = item.id;
        showMediaPicker.value = true;
    } else if (item.type === 'bible') {
        bibleEditItemId.value = item.id;
        bibleEditText.value = item.payload?.text || '';
        showBibleEdit.value = true;
    }
};
const saveBibleEdit = () => {
    if (bibleEditItemId.value) programStore.updateBibleText(bibleEditItemId.value, bibleEditText.value);
    showBibleEdit.value = false;
    bibleEditItemId.value = null;
};

// ===== PRESET por música (item 3) =====
const openPresetPicker = (item: ProgramItem) => {
    presetItemId.value = item.id;
    showPresetPicker.value = true;
};
const choosePreset = (presetId: string | null) => {
    if (presetItemId.value) programStore.setItemPreset(presetItemId.value, presetId);
    showPresetPicker.value = false;
    presetItemId.value = null;
};
const presetName = (id?: string | null) =>
    (presentationStore.presets || []).find((p: any) => p.id === id)?.name || '';

// ===== apresentar item =====
const buildBibleReference = (item: ProgramItem) => {
    const r = item.payload?.ref || {};
    const vs = r.verseStart ?? null;
    const ve = r.verseEnd ?? vs;
    const verses = vs == null ? undefined : vs === ve ? `${vs}` : `${vs}-${ve}`;
    return { abbr: r.book, chapter: r.chapter, verses };
};

const presentItem = async (item: ProgramItem) => {
    if (item.type === 'song') {
        // Garante que o item tenha o _id
        if(!item.payload?._id) item.payload._id = item.payload?.id;

        // Garante que a payload tenha os arquivos (online busca da API, offline do cache)
        await songCacheStore.getFilesFromSongs([item.payload]);

        // Carrega a letra e monta o customSong (dispara o preview)
        await musicStore.setCustomSong(item.payload);

        // Item 3: aplica o tema DEPOIS de carregar, senão o watcher de rawLyric
        // (savedPresetBySong) sobrescreve o tema do item
        if (item.presetId) presentationStore.applyPreset(item.presetId);
    } else if (item.type === 'media') {
        mediaPreviewFile.value = item.payload;
        showMediaPreview.value = true;
    } else if (item.type === 'bible') {
        const r = item.payload?.ref || {};
        tauriEmit('open-bible', {
            book: r.book,
            chapter: r.chapter,
            verseStart: r.verseStart,
            verseEnd: r.verseEnd,
            text: item.payload?.text?.trim() || undefined, // texto manual
        });
    }
};

// ===== preview do texto bíblico (item 3 anterior) =====
const expanded = ref<Set<string>>(new Set());
const toggleExpand = (id: string) => {
    const s = new Set(expanded.value);
    s.has(id) ? s.delete(id) : s.add(id);
    expanded.value = s;
};

// ===== drag & drop por ponteiro (funciona no Tauri) =====
const listWrap = ref<HTMLElement | null>(null);
const dragIndex = ref<number | null>(null);
const dragActive = ref(false);
let dragFrom = -1;

// quando confirma no preview → projeta de fato
const onProjectMedia = async (file: any) => {
    console.log('projecting media', file)
    await statusStore.setNewPresentation('Media', configStore.settings.selectedMonitor);
    tauriEmit('project-media', file);
    statusStore.setProjectedMedia(file);

};

const startDrag = (index: number, e: PointerEvent) => {
    e.preventDefault();
    dragFrom = index;
    dragActive.value = true;
    dragIndex.value = index;
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag, { once: true });
};
const onMove = (e: PointerEvent) => {
    if (!dragActive.value || !listWrap.value) return;
    const nodes = Array.from(listWrap.value.querySelectorAll('[data-drag-index]')) as HTMLElement[];
    if (!nodes.length) return;
    let target = nodes.length - 1;
    for (let i = 0; i < nodes.length; i++) {
        const r = nodes[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { target = i; break; }
    }
    if (target >= 0 && target !== dragFrom) {
        programStore.moveItem(dragFrom, target);
        dragFrom = target;
        dragIndex.value = target;
    }
};
const endDrag = () => {
    dragActive.value = false;
    dragFrom = -1;
    dragIndex.value = null;
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', onMove);
};
onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onMove);
    document.body.style.userSelect = '';
});

// ===== sincronização com evento =====
const showSyncDialog = ref(false);
const syncDiff = ref<any>(null);
const syncSongs = ref<any[]>([]);
const syncProgramId = ref<string | null>(null);
const syncChecking = ref(false);

const checkEventSync = async (programId: string) => {
    const p = programStore.programs.find((x) => x._id === programId);
    if (!p?.eventId) return;
    const event = (eventStore.events || []).find((e: any) => e._id === p.eventId);
    if (!event) return;
    syncChecking.value = true;
    try {
        await eventStore.getSongsForEvent(event);
        const currentSongs = [...eventStore.songsByEvent];
        if (!programStore.eventChangedSince(programId, currentSongs)) return;
        const diff = programStore.diffProgramWithEvent(programId, currentSongs);
        if (!diff.changed) { programStore.acknowledgeEvent(programId, currentSongs); return; }
        syncDiff.value = diff;
        syncSongs.value = currentSongs;
        syncProgramId.value = programId;
        showSyncDialog.value = true;
    } finally {
        syncChecking.value = false;
    }
};
const openProgramAndCheck = async (p: any) => {
    programStore.openProgram(p._id);
    await checkEventSync(p._id);
};
const applySync = () => {
    if (syncProgramId.value) programStore.applyEventSync(syncProgramId.value, syncSongs.value);
    showSyncDialog.value = false;
};
const dismissSync = () => {
    if (syncProgramId.value) programStore.acknowledgeEvent(syncProgramId.value, syncSongs.value);
    showSyncDialog.value = false;
};

// ===== helpers =====
const formatDate = (d: string | Date) =>
    new Date(d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
const shortDate = (d: string | Date) =>
    new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
const timeLabel = (d: string | Date) =>
    new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const typeColor = (t: ProgramItem['type']) =>
    t === 'song' ? 'primary' : t === 'media' ? 'deep-purple' : 'teal';

onMounted(async () => {
    await programStore.loadPrograms();
});
</script>

<template>
    <div class="d-flex flex-column fill-height">
        <div class="d-flex flex-column fill-height bg-grey-lighten-4 position-relative">

            <!-- toolbar -->
            <div class="bg-surface elevation-1 z-10" style="position: sticky; top: 0; z-index: 10;">
                <v-toolbar density="compact" color="transparent" elevation="0">
                    <v-toolbar-title class="text-subtitle-1 font-weight-bold">
                        <v-icon start color="primary">mdi-playlist-music</v-icon> Programação
                    </v-toolbar-title>
                    <v-spacer></v-spacer>
                    <v-btn v-if="programStore.currentProgram" size="small" variant="tonal" color="primary"
                        @click="programStore.closeProgram()" prepend-icon="mdi-arrow-left"
                        class="mr-2 text-none">Voltar</v-btn>
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

                    <!-- ============ LISTA ============ -->
                    <div v-if="!programStore.currentProgram" :key="'list'">
                        <v-btn-toggle v-model="tab" mandatory density="comfortable" color="primary" variant="outlined"
                            divided class="w-100 mb-3">
                            <v-btn value="future" class="flex-grow-1 text-none"><v-icon start
                                    size="small">mdi-calendar-arrow-right</v-icon> Próximas</v-btn>
                            <v-btn value="past" class="flex-grow-1 text-none"><v-icon start
                                    size="small">mdi-history</v-icon>
                                Anteriores</v-btn>
                        </v-btn-toggle>

                        <template v-if="shownPrograms.length > 0">
                            <v-card v-for="p in shownPrograms" :key="p._id"
                                class="mb-2 border-sm rounded-lg cursor-pointer transition-all elevation-1" hover
                                @click="openProgramAndCheck(p)">
                                <div class="pa-3 d-flex align-center">
                                    <v-avatar color="primary" size="40" variant="tonal"
                                        class="mr-3"><v-icon>mdi-playlist-music</v-icon></v-avatar>
                                    <div class="flex-grow-1 overflow-hidden">
                                        <div class="text-subtitle-2 font-weight-bold text-truncate">
                                            {{ p.name }}
                                            <v-icon v-if="p.eventId" size="x-small" color="primary" class="ml-1"
                                                title="Vinculada a um evento">mdi-link-variant</v-icon>
                                        </div>
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
                                {{ programStore.showPast ? 'Nenhuma programação anterior.' 
                                : 'Nenhuma programação futura ainda.' }}
                            </p>
                            <v-btn size="small" color="primary" variant="tonal" prepend-icon="mdi-plus"
                                @click="onCreateNew">Nova
                                programação</v-btn>
                        </div>
                    </div>

                    <!-- ============ DETALHE ============ -->
                    <div v-else :key="'detail-' + programStore.currentProgram._id">
                        <div
                            class="bg-white d-flex align-center justify-space-between mb-3 pl-2 pr-1 py-1 rounded-lg border-sm elevation-1">
                            <div class="overflow-hidden mr-2">
                                <h3 class="text-subtitle-1 font-weight-bold text-truncate"
                                    :title="programStore.currentProgram.name">{{
                                    programStore.currentProgram.name }}</h3>
                                <span class="text-caption text-grey d-block text-truncate">
                                    <v-icon size="x-small" start>mdi-calendar</v-icon>{{
                                        formatDate(programStore.currentProgram.date) }}
                                    <v-icon size="x-small" start class="ml-1">mdi-clock-outline</v-icon>{{
                                        timeLabel(programStore.currentProgram.date) }}
                                </span>
                            </div>
                            <div class="d-flex align-center flex-shrink-0">
                                <v-btn v-if="programStore.currentProgram.eventId" icon size="small" variant="text"
                                    color="primary" :loading="syncChecking" title="Verificar alterações do evento"
                                    @click="checkEventSync(programStore.currentProgram._id)"><v-icon>mdi-sync</v-icon></v-btn>
                                <v-chip size="small" color="primary" variant="tonal" class="mr-1">{{
                                    programStore.currentProgram.items.length }} itens</v-chip>
                                <v-btn icon="mdi-pencil" size="small" variant="text" color="grey"
                                    @click="openEdit(programStore.currentProgram)"></v-btn>
                            </div>
                        </div>

                        <div class="d-flex ga-2 mb-3 flex-wrap">
                            <v-btn size="small" color="primary" variant="flat" class="text-none flex-grow-1"
                                prepend-icon="mdi-music-note-plus" @click="openAddSong">Música</v-btn>
                            <v-btn size="small" color="deep-purple" variant="flat" class="text-none flex-grow-1"
                                prepend-icon="mdi-image-plus" @click="openMediaPicker">Mídia</v-btn>
                            <v-btn size="small" color="teal-darken-1" variant="flat" class="text-none flex-grow-1"
                                prepend-icon="mdi-book-plus" @click="showBibleModal = true">Bíblia</v-btn>
                        </div>

                        <v-card v-if="programStore.currentProgram.items.length > 0" class="border-sm rounded-lg"
                            elevation="0">
                            <div ref="listWrap">
                                <v-list density="compact" class="bg-transparent pa-0">
                                    <v-list-item v-for="(item, index) in programStore.currentProgram.items"
                                        :key="item.id" :data-drag-index="index" class="border-b program-item"
                                        :class="{ dragging: dragIndex === index }">
                                        <template v-slot:prepend>
                                            <v-icon size="small" color="grey-lighten-1" class="mr-1 drag-handle"
                                                @pointerdown.stop.prevent="startDrag(index, $event)">mdi-drag-vertical</v-icon>
                                            <div class="text-caption text-grey font-weight-bold mr-2"
                                                style="width: 18px;">{{ index + 1 }}</div>
                                            <v-avatar :color="typeColor(item.type)" size="28" variant="tonal"
                                                class="mr-2"><v-icon size="small">{{ item.icon }}</v-icon></v-avatar>
                                        </template>

                                        <v-list-item-title class="font-weight-bold text-subtitle-2 text-truncate text-high-emphasis">{{
                                            item.title
                                            }}</v-list-item-title>
                                        <v-list-item-subtitle class="text-caption text-truncate">{{ item.subtitle
                                            }}</v-list-item-subtitle>

                                        <!-- tema (preset) da música — item 3 -->
                                        <div v-if="item.type === 'song' && item.presetId" class="mt-1">
                                            <v-chip size="x-small" color="deep-purple" variant="tonal"
                                                prepend-icon="mdi-palette" class="cursor-pointer"
                                                @click.stop="openPresetPicker(item)">{{ presetName(item.presetId)
                                                }}</v-chip>
                                        </div>

                                        <!-- texto da passagem bíblica -->
                                        <div v-if="item.type === 'bible' && item.payload?.text"
                                            class="text-caption text-medium-emphasis mt-1 bible-text cursor-pointer"
                                            :class="{ clamp2: !expanded.has(item.id) }" @click="toggleExpand(item.id)"
                                            :title="expanded.has(item.id) ? 'Recolher' : 'Ver texto completo'">{{
                                            item.payload.text }}</div>

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
                                                    <v-list-item v-if="item.type === 'song'"
                                                        @click="openPresetPicker(item)" prepend-icon="mdi-palette"
                                                        title="Tema da música"></v-list-item>
                                                    <v-list-item @click="onEditItem(item)" prepend-icon="mdi-pencil"
                                                        title="Editar"></v-list-item>
                                                    <v-divider></v-divider>
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
                            </div>
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

        <!-- Editar texto bíblico (item 2) -->
        <v-dialog v-model="showBibleEdit" max-width="560">
            <v-card rounded="lg">
                <v-toolbar color="teal-darken-1" density="compact">
                    <v-toolbar-title class="text-subtitle-1 font-weight-bold">Editar passagem</v-toolbar-title>
                    <v-spacer></v-spacer>
                    <v-btn icon="mdi-close" variant="text" @click="showBibleEdit = false"></v-btn>
                </v-toolbar>
                <v-card-text class="pa-4">
                    <v-textarea v-model="bibleEditText" label="Texto da passagem" variant="outlined" rows="8" auto-grow
                        hide-details></v-textarea>
                </v-card-text>
                <v-card-actions class="px-4 pb-4">
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="showBibleEdit = false">Cancelar</v-btn>
                    <v-btn color="primary" variant="flat" @click="saveBibleEdit">Salvar</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Escolher tema/preset da música (item 3) -->
        <ModalSelectPreset
            v-model="showPresetPicker"
            select-mode
            :selected-preset-id="currentPresetForItem"
            @select="choosePreset" />

        <!-- Criar / Editar programação -->
        <v-dialog v-model="showProgramDialog" max-width="420">
            <v-card rounded="lg">
                <v-toolbar color="primary" density="compact">
                    <v-toolbar-title class="text-subtitle-1 font-weight-bold">{{ dialogMode === 'create' 
                    ? 'Nova programação' :
                        'Editar programação' }}</v-toolbar-title>
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
                    <v-btn color="primary" variant="flat" @click="saveProgram">Salvar</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Seletor de mídia (adicionar ou substituir) -->
        <MediaPickerModal v-model="showMediaPicker" :replacing="!!mediaEditItemId" @select="onAddMedia" />

        <!-- Importar de evento -->
        <v-dialog v-model="showImportDialog" max-width="450">
            <v-card rounded="lg">
                <v-toolbar color="primary" density="compact">
                    <v-toolbar-title class="text-subtitle-1 font-weight-bold">Importar de um evento</v-toolbar-title>
                    <v-spacer></v-spacer>
                    <v-btn icon="mdi-close" variant="text" @click="showImportDialog = false"></v-btn>
                </v-toolbar>
                <v-card-text class="pa-3">
                    <div class="d-flex align-center justify-space-between mb-2 px-1">
                        <span class="text-caption text-grey-darken-1 font-weight-medium text-uppercase">{{
                            importShowPast ?
                            'Todos os eventos' : 'Eventos futuros' }}</span>
                        <v-switch v-model="importShowPast" label="Mostrar anteriores" density="compact" color="primary"
                            hide-details inset class="flex-grow-0"></v-switch>
                    </div>
                    <v-list v-if="importableEvents.length > 0" class="border rounded-lg" density="compact"
                        style="max-height: 380px; overflow-y: auto;">
                        <v-list-item v-for="ev in importableEvents" :key="ev._id" @click="doImportEvent(ev)"
                            :disabled="importing" hover class="cursor-pointer">
                            <template v-slot:prepend><v-avatar color="primary" size="36" variant="tonal"
                                    class="mr-2"><v-icon>mdi-calendar-check</v-icon></v-avatar></template>
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

        <!-- Sincronizar com evento -->
        <v-dialog v-model="showSyncDialog" max-width="460">
            <v-card rounded="lg">
                <v-toolbar color="primary" density="compact">
                    <v-icon start class="ml-3">mdi-sync-alert</v-icon>
                    <v-toolbar-title class="text-subtitle-1 font-weight-bold">Evento atualizado</v-toolbar-title>
                    <v-spacer></v-spacer>
                    <v-btn icon="mdi-close" variant="text" @click="showSyncDialog = false"></v-btn>
                </v-toolbar>
                <v-card-text class="pa-4">
                    <p class="text-body-2 mb-3">O repertório do evento vinculado mudou. Deseja atualizar esta
                        programação
                        automaticamente?</p>
                    <div v-if="syncDiff?.added?.length" class="mb-2">
                        <div class="text-caption font-weight-bold text-success mb-1"><v-icon size="x-small"
                                start>mdi-plus-circle</v-icon>Adicionadas</div>
                        <v-chip v-for="s in syncDiff.added" :key="'a-' + s.id" size="x-small" color="success"
                            variant="tonal" class="mr-1 mb-1">{{ s.name }}</v-chip>
                    </div>
                    <div v-if="syncDiff?.removed?.length" class="mb-2">
                        <div class="text-caption font-weight-bold text-error mb-1"><v-icon size="x-small"
                                start>mdi-minus-circle</v-icon>Removidas</div>
                        <v-chip v-for="(s, i) in syncDiff.removed" :key="'r-' + i" size="x-small" color="error"
                            variant="tonal" class="mr-1 mb-1">{{ s.name }}</v-chip>
                    </div>
                    <div v-if="syncDiff?.reordered" class="text-caption text-medium-emphasis"><v-icon size="x-small"
                            start>mdi-swap-vertical</v-icon>A ordem das músicas também mudou.</div>
                    <v-alert type="info" variant="tonal" density="compact" class="mt-3 text-caption">Mídias e passagens
                        bíblicas
                        adicionadas por você são mantidas.</v-alert>
                </v-card-text>
                <v-card-actions class="px-4 pb-4">
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="dismissSync">Agora não</v-btn>
                    <v-btn color="primary" variant="flat" class="text-none" prepend-icon="mdi-sync"
                        @click="applySync">Atualizar</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <MediaPreviewModal v-model="showMediaPreview" :file="mediaPreviewFile" @project="onProjectMedia" />

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
    opacity: 0.6;
    background-color: rgba(var(--v-theme-primary), 0.08);
}

.drag-handle {
    cursor: grab;
    touch-action: none;
}

.drag-handle:active {
    cursor: grabbing;
}

.bible-text {
    white-space: pre-line;
    line-height: 1.35;
}

.bible-text.clamp2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
</style>