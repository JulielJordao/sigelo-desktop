import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { emit as emitTauri } from '@tauri-apps/api/event';
// NOVO: Importação do store do tauri
import { load, type Store } from '@tauri-apps/plugin-store';
import { api } from '../routes/index';
import bibleData from '../data/bible.json';
import { useConfigStore } from './useConfigStore';
import { useStatusPresentationStore } from './statusPresentationStore';
import { calculateMaxFontSize, getMaxCharsFromSlides, getMaxLinesFromSlides } from '../utils/projection';

export const useBibleStore = defineStore('bible', () => {
    const configStore = useConfigStore();
    const statusPresStore = useStatusPresentationStore();

    const step = ref<'book' | 'chapter' | 'verse' | 'loading' | 'view' | 'projecting'>('book');
    const selectedBook = ref<any>(null);
    const selectedChapter = ref<number>(1);
    const verseStart = ref<number>(1);
    const verseEnd = ref<number>(1);
    const fetchedData = ref<{ book: string, chapter: string, verses: string[] } | null>(null);
    const searchQuery = ref('');
    const currentSlideIndex = ref(0);

    // NOVO: Controle de persistência
    let tauriStore: Store | null = null;
    const isLoaded = ref(false);

    // ATUALIZADO: Novos parâmetros adicionados
    const projectionSettings = ref({
        versesPerSlide: 2,
        fontSize: 5.0,
        fontFamily: 'Inter',
        align: 'left' as 'left' | 'center' | 'right' | 'justify',
        bold: false,          // Novo
        textBackdrop: false,  // Novo
        bgType: 'color',
        bgColor: '#000000',
        bgMedia: '',
        bgIsVideo: false,
        bgFit: 'cover',
        showReference: true
    });

    // NOVO: Carregar configurações salvas no disco
    const loadSettings = async () => {
        try {
            tauriStore = await load('bible_settings.json', { autoSave: false, defaults: { settings: { ...projectionSettings.value } } });
            const savedConfig = await tauriStore.get('settings');
            if (savedConfig) {
                projectionSettings.value = { ...projectionSettings.value, ...(savedConfig as any) };
            }
        } catch (error) {
            console.error("Erro ao carregar configurações da Bíblia:", error);
        } finally {
            isLoaded.value = true;
        }
    };

    // NOVO: Salva automaticamente no disco quando houver mudanças
    watch(projectionSettings, async (newSettings) => {
        if (!isLoaded.value || !tauriStore) return;
        await tauriStore.set('settings', newSettings);
        await tauriStore.save();
    }, { deep: true });

    // ... (MANTENHA OS COMPUTEDS: filteredBooks, totalVersesInChapter, availableVerses) ...
    const filteredBooks = computed(() => {
        if (!searchQuery.value) return bibleData;
        const normalize = (str: string) => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const query = normalize(searchQuery.value);
        return bibleData.filter(book => normalize(book.name).includes(query) || normalize(book.abbr).includes(query));
    });

    const totalVersesInChapter = computed(() => {
        if (!selectedBook.value) return 1;
        return selectedBook.value.chapters[selectedChapter.value - 1];
    });

    const availableVerses = computed(() => Array.from({ length: totalVersesInChapter.value }, (_, i) => i + 1));


    // ... (MANTENHA AS REGRAS E FUNÇÕES ATÉ A MONTAGEM DO HTML) ...
    watch(verseStart, (newVal) => { if (verseEnd.value < newVal) verseEnd.value = newVal; });
    watch(verseEnd, (newVal) => { if (verseStart.value > newVal) verseStart.value = newVal; });

    const getBookByAbbr = (abbr: string) => bibleData.find(it => it.abbr === abbr)?.name ?? "";
    const getBookChapters = (abbr: string) => bibleData.find(it => it.abbr === abbr)?.chapters ?? [];

    const bibleSlides = computed(() => {
        if (!fetchedData.value) return [];
        const slides = [];
        const verses = fetchedData.value.verses;
        const start = verseStart.value;
        const perSlide = projectionSettings.value.versesPerSlide;

        for (let i = 0; i < verses.length; i += perSlide) {
            const chunk = verses.slice(i, i + perSlide);
            const endVerse = start + i + chunk.length - 1;
            const slideHtml = chunk.map((v, idx) =>
                `<span style="color: rgba(255,255,255,0.6); font-size: 0.6em; vertical-align: super; margin-right: 4px;">${configStore.settings.showVerseNumbers ? (start + i + idx) : ""}</span>${v}`
            ).join('<br><br>');

            slides.push({
                reference: `${fetchedData.value.book} ${fetchedData.value.chapter}:${start + i}${chunk.length > 1 ? '-' + endVerse : ''}`,
                htmlContent: slideHtml
            });
        }
        return slides;
    });

    const maxCharsInBible = computed(() => getMaxCharsFromSlides(bibleSlides.value));
    const maxLinesInBible = computed(() => getMaxLinesFromSlides(bibleSlides.value));

    const maxBibleFontSize = computed(() => {
        return calculateMaxFontSize({
            maxChars: maxCharsInBible.value,
            maxLines: maxLinesInBible.value,
            aspectRatio: configStore.settings.aspectRatio,
            safeMargin: 1.25,
            absoluteMax: 15
        });
    });

    watch(maxBibleFontSize, (newMax) => {
        if (projectionSettings.value.fontSize > newMax) {
            projectionSettings.value.fontSize = newMax;
            if (step.value === 'projecting') projectCurrentSlide();
        }
    });

    const fetchBibleText = async (abbr: string, wholeChapter: boolean) => {
        step.value = 'loading';
        try {
            const normalizedAbbr = abbr.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const verses = wholeChapter ? `1-${totalVersesInChapter.value}` : `${verseStart.value}-${verseEnd.value}`;
            const response = await api.bibleApi(normalizedAbbr, selectedChapter.value, verses);
            fetchedData.value = response;
            step.value = 'view';
        } catch (error) {
            console.error("Erro ao buscar texto bíblico:", error);
            step.value = 'verse';
        }
    };

    const loadReference = async (reference: { abbr: string, chapter: number, verses?: string }) => {
        const abbr = reference.abbr;
        selectedBook.value = { name: getBookByAbbr(abbr), abbr: abbr, chapters: getBookChapters(abbr) };
        step.value = 'loading';

        if (!reference.verses) {
            selectedChapter.value = reference.chapter;
            await fetchBibleText(abbr, true);
        } else {
            const splitVerse = reference.verses.split("-");
            if (splitVerse.length > 1) {
                selectedChapter.value = reference.chapter;
                verseStart.value = Number.parseInt(splitVerse[0]);
                verseEnd.value = Number.parseInt(splitVerse[1]);
                await fetchBibleText(abbr, false);
            }
        }
    };

    const resetSelection = () => {
        selectedBook.value = null;
        fetchedData.value = null;
        searchQuery.value = '';
        step.value = 'book';
    };

    function getLocalPathFromAssetUrl(url: string): string {
        if (!url) return '';

        // 1. Remove os prefixos do Tauri (v2 usa http://asset.localhost, v1 usa asset://localhost)
        let cleanPath = url
            .replace(/^https?:\/\/asset\.localhost\//, '')
            .replace(/^asset:\/\/localhost\//, '');

        console.log(decodeURIComponent(cleanPath))
        // 2. Decodifica os caracteres da URL (%3A para :, %5C para \)
        return decodeURIComponent(cleanPath);
    }

    // ATUALIZADO: Motor de Projeção enviando JSON estruturado em vez de HTML bruto
    const projectCurrentSlide = async () => {
        const currentSlide = bibleSlides.value[currentSlideIndex.value];
        if (!currentSlide) return;

        const conf = configStore.settings;
        const settings = projectionSettings.value;

        // Construímos um objeto JSON com todos os dados necessários
        const payload = {
            type: 'bible',
            slide: {
                htmlContent: currentSlide.htmlContent,
                reference: currentSlide.reference
            },
            settings: {
                ...settings,
                // O vídeo precisa do caminho local (limpo)
                bgMediaLocal: getLocalPathFromAssetUrl(settings.bgMedia)
            },
            config: {
                bibleLayout: conf.bibleLayout,
                showVerseNumbers: conf.showVerseNumbers,
                chromaKey: conf.chromaKey,
                bgOpacity: conf.bgOpacity, 
                transitionType: conf.transitionType,
                marginTop: conf.marginTop,
                marginBottom: conf.marginBottom,
                marginLeft: conf.marginLeft,
                marginRight: conf.marginRight,
                activeTheme: conf.activeTheme || 'dark',
                selectedMonitor: conf.selectedMonitor
            }
        };

        console.log(payload)

        try {
            // Enviamos como string, o frontend vai dar o JSON.parse
            await invoke('update_projection', { 
                html: JSON.stringify(payload), 
                targetMonitor: conf.selectedMonitor || null 
            });
        } catch (error) {
            console.error("Erro ao projetar a bíblia:", error);
        }
    };

    const startProjection = async () => {
        await statusPresStore.setNewPresentation('Biblia', configStore.settings.selectedMonitor);
        currentSlideIndex.value = 0;
        step.value = 'projecting';
        projectCurrentSlide();
    };

    const stopProjection = async () => {
        step.value = 'view';
        try { await emitTauri('clear-projection'); }
        catch (error) { console.error("Erro ao parar a projeção:", error); }
    };

    const nextSlide = () => { if (currentSlideIndex.value < bibleSlides.value.length - 1) { currentSlideIndex.value++; projectCurrentSlide(); } };
    const prevSlide = () => { if (currentSlideIndex.value > 0) { currentSlideIndex.value--; projectCurrentSlide(); } };

    // Exportar loadSettings para ser acionado na UI
    return {
        step, selectedBook, selectedChapter, verseStart, verseEnd, fetchedData, searchQuery, currentSlideIndex, projectionSettings,
        filteredBooks, totalVersesInChapter, availableVerses, bibleSlides, maxBibleFontSize,
        fetchBibleText, loadReference, resetSelection, startProjection, stopProjection, nextSlide, prevSlide, loadSettings
    };
});