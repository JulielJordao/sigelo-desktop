<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onMounted } from 'vue';
import { ask } from '@tauri-apps/plugin-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useConfigStore } from '../../stores/useConfigStore';
import { usePresentationStore } from '../../stores/usePresentationStore'; // NOVO STORE
import { getMaxLinesFromSlides, calculateMaxFontSize } from '../../utils/projection';
import { emit as tauriEmit } from '@tauri-apps/api/event';

import SlidePreview from '../preview/SlidePreview.vue';
import ModalSavePreset from '../presets/modalSavePreset.vue';
import ModalSelectPreset from '../presets/modalSelectPreset.vue';

import { useMusicPresentationStore } from '../../stores/presentationStore';
import { useStatusPresentationStore } from '../../stores/statusPresentationStore';
import { useMenuStore } from '../../stores/menuStore';
import type { Slide } from '../../stores/presentationStore';

// Importação das Abas Separadas
import TabSlides from '../tabs/TabSlides.vue';
import TabBackground from '../tabs/TabBackground.vue';
import TabText from '../tabs/TabText.vue';
import TabPosition from '../tabs/TabPosition.vue';
import TabEstrutura from '../tabs/TabEstrutura.vue';
import QuickBibleModal from '../bible/QuickBibleModal.vue';
import { BibleRef } from '../../types/bibleRef';

const menuStore = useMenuStore();
const configStore = useConfigStore();
const infoPresentationStore = usePresentationStore(); // INSTANCIANDO O STORE
const statusPresStore = useStatusPresentationStore();

const songInfo = useMusicPresentationStore();

const fixedTheme = ref(false)

const lyric = ref<string>('');
const currentTab = ref('slides');
const isProjecting = computed(() => { return statusPresStore.status.isPresentation && statusPresStore.status.isPresentation === 'Slides' });
const currentSlideIndex = ref<number>(0);
// const previewContainer = ref<HTMLElement | null>(null);

const isPresetModalOpen = ref(false)
const isQuickBibleOpen = ref(false)


// AQUI ESTÁ O SEGREDO: Atalhos para os valores do Store para facilitar a leitura no componente principal
const design = computed(() => infoPresentationStore.design);
const textStyles = computed(() => infoPresentationStore.textStyles);
const setNewDefaultThemeBySong = ref(true)

// --- PROCESSAMENTO DOS SLIDES (MANTIDO) ---
watch(() => songInfo.activeSong, () => { currentSlideIndex.value = 0; });

watch(() => infoPresentationStore.isSelectedPresetDefaultBySong, (newValue) => {
    if (newValue) {
        setNewDefaultThemeBySong.value = false;
        fixedTheme.value = false
    } else {
        setNewDefaultThemeBySong.value = true
    }
})

const parseSlides = function (rawText: string, targetLines: number = 4, maxLines: number = 5) {
    const lines = rawText.split('\n')
    const estrofes = []
    let chorusLines = []
    let chorus = []
    let buffer = []
    const typeText = []
    const typeSlides = <any>[]

    // Pré-define o que é refrão e o que é estrofe
    for (let line of lines) {
        // Quebra de linha
        if (!line.trim()) {
            if (buffer.length > 0) {
                estrofes.push(buffer.join('\n'))
                buffer = []
                typeText.push(0) // Estrofe
            }

            if (chorusLines.length > 0) {
                if (chorus.length < 1) {
                    typeText.push(1)
                } else {
                    typeText.push(chorus.length + 1)
                }
                chorus.push(chorusLines.join('\n'))
                chorusLines = []
            }
            // Refrão (linha com 5 espaços)
        } else if (/^\s{5}/.test(line)) {
            chorusLines.push(line.trim())
        } else {
            buffer.push(line.trim())
        }
    }

    if (buffer.length > 0) {
        estrofes.push(buffer.join('\n'))
        typeText.push(0)
    }

    if (chorusLines.length > 0) {
        typeText.push(chorus.length + 1)
        chorus.push(chorusLines.join('\n'))
    }

    const slides: string[] = [];
    let countChorus = 0;
    let countVerse = 0;
    let afterChorus = false;
    let onVerse = false;

    // Função interna que corta o texto e joga nas arrays finais
    const addBlock = (text: string, type: number) => {
        const chunks = splitTextBlock(text, targetLines, maxLines);
        chunks.forEach(chunk => {
            slides.push(chunk);
            typeSlides.push(type);
        });
    };

    // Constrói os slides usando o addBlock (muito mais limpo!)
    for (let i = 0; i < typeText.length; i++) {
        let sType = typeText[i];
        if (sType == 0) {
            addBlock(estrofes[countVerse], 0);
            countVerse++;
            onVerse = true;
        } else if (sType == 1) {
            addBlock(chorus[0], 1);
            onVerse = false;
            afterChorus = true;
        } else {
            countChorus++;
            addBlock(chorus[countChorus], 1);
            onVerse = false;
        }

        // Lógica de repetir o refrão
        if ((i + 1) < typeText.length) {
            if (afterChorus && onVerse && typeText[i + 1] < 1) {
                addBlock(chorus[countChorus], 1);
            }
        } else {
            if (afterChorus && onVerse) {
                addBlock(chorus[countChorus], 1);
            }
        }
    }
    return { slides, typeSlides };
}

function splitTextBlock(text: string, targetLines: number, maxLines: number): string[] {
    const lines = text.split('\n');
    if (lines.length <= maxLines) return [text]; // Passou na tolerância, não corta.

    const chunks: string[] = [];
    let i = 0;

    while (i < lines.length) {
        let remaining = lines.length - i;
        let take = targetLines;

        if (remaining <= maxLines) {
            take = remaining;
        } else if (remaining > maxLines && remaining < targetLines * 2) {
            take = Math.ceil(remaining / 2);
        }

        chunks.push(lines.slice(i, i + take).join('\n'));
        i += take;
    }

    return chunks;
}

const infoSlides = ref(parseSlides("")); // (Sua função parseSlides permanece inalterada)

const songSlides = computed(() => {
    songInfo.listSlides = []
    if (!songInfo.activeSong) return [];
    return infoSlides.value.slides.map((block, index) => {
        let label = infoSlides.value.typeSlides[index] == 0 ? `Slide ${index + 1} - verso` : `Slide ${index + 1} - refrão`
        if (infoSlides.value.typeSlides[index] == -1) {
            label = "título"
        }
        songInfo.listSlides.push({ label: label, text: block })
        return { label, text: block };
    });
});

const currentSlideText = computed(() => songSlides.value[currentSlideIndex.value]?.text || 'Selecione uma música');
const previousSlideText = computed(() => currentSlideIndex.value > 0 ? songSlides.value[currentSlideIndex.value-1] : null)
const nextSlideText = computed(() => currentSlideIndex.value < songSlides.value?.length - 1 ? songSlides.value[currentSlideIndex.value+1] : null)

const currentSlideType = computed(() => {
    if (!songSlides.value[currentSlideIndex.value]) return 'geral';
    const label = songSlides.value[currentSlideIndex.value].label.toLowerCase();
    if (label.includes('título') || label.includes('titulo')) return 'titulo';
    if (label.includes('refrão') || label.includes('refrao') || label.includes('coro')) return 'refrao';
    if (label.includes('verso') || label.includes('estrofe')) return 'verso';
    return 'geral';
});

const currentActiveStyle = computed(() => textStyles.value[currentSlideType.value]);

// Função que recebe a nova fonte do Drag&Drop (quando o autoFontSize está ligado)
const handleFontSizeUpdate = (newSize: number) => {
    infoPresentationStore.textStyles[currentSlideType.value].fontSize = newSize;
};

// Função que recebe as novas coordenadas do Drag&Drop e salva na Store
const handleLayoutUpdate = (newLayout: { posX: number, posY: number, width: number, height: number }) => {
    infoPresentationStore.design.posX = newLayout.posX;
    infoPresentationStore.design.posY = newLayout.posY;
    infoPresentationStore.design.width = newLayout.width;
    infoPresentationStore.design.height = newLayout.height;
};

// 1. Descobre o número máximo de linhas na música atual
const maxLinesInSong = computed(() => {
    return getMaxLinesFromSlides(songSlides.value);
});

const maxAllowedFontSize = computed(() => {
    return calculateMaxFontSize({
        maxLines: maxLinesInSong.value,
        aspectRatio: configStore.settings.aspectRatio,
        customWidth: configStore.settings.width,
        customHeight: configStore.settings.height
    });
});

// 3. Monitora mudanças e "esmaga" a fonte se ela estourar o limite
watch(maxAllowedFontSize, (newMax) => {
    const styles = ['geral', 'titulo', 'verso', 'refrao'] as const;

    styles.forEach(style => {
        if (textStyles.value[style].fontSize > newMax) {
            textStyles.value[style].fontSize = newMax;
        }
    });

    if (isProjecting.value) projectCurrentSlide();
});
/*
interface SlideProj {
    label: string;
    text: string;
}

function removeAccents(str: string | undefined): string | null {
    if (!str) return null;

    return str
        .toLowerCase()
        .normalize('NFD') // Decompõe os acentos
        .replace(/[\u0300-\u036f]/g, "");
}*/

const projectCurrentSlide = async () => {
    if (!songInfo.activeSong) return;
 
    const style = currentActiveStyle.value;
    const conf = { ...configStore.settings };
    const text = currentSlideText.value;
    const currentDesign = design.value;
 
    // Resolve o tipo de fundo de forma limpa
    let resolvedBgType = 'color';
    if (currentDesign.bgType !== 'color' && currentDesign.bgMedia) {
        resolvedBgType = currentDesign.bgIsVideo ? 'video' : 'image';
    }
 
    // ─── Calcula informações úteis pro palco ───────────────────────────────
    const totalSlides = songSlides.value.length;
    const currentIndex = currentSlideIndex.value;
    const slideNumber = currentIndex + 1;
    const slideKind = currentSlideType.value; // 'verso' | 'refrao' | 'titulo' | 'geral'
    const currentLabel = songSlides.value[currentIndex]?.label || '';
    
    // Próximo slide com mais detalhes
    const nextSlide = nextSlideText.value;
    const nextLabel = nextSlide?.label || null;
    const nextText = nextSlide?.text || null;
    
    // Slide anterior (útil pra layouts split)
    const prevSlide = previousSlideText.value;
    const prevLabel = prevSlide?.label || null;
    const prevText = prevSlide?.text || null;
 
    // Progresso da apresentação (porcentagem)
    const progressPct = totalSlides > 0 ? Math.round((slideNumber / totalSlides) * 100) : 0;
 
    // ─── Verifica se a música tem ChordPro associado ───────────────────────
    // Você pode ajustar isso pra buscar do songInfo.activeSong
    const chordproRaw = (songInfo.activeSong as any)?.chordpro || 
                        (songInfo.activeSong as any)?.chordProRaw || 
                        null;
 
    // ─── Extrai notas da música (se houver) ────────────────────────────────
    // Pode vir de um campo "notes" ou "preacherNotes" da música
    const songNotes = (songInfo.activeSong as any)?.notes || 
                      (songInfo.activeSong as any)?.preacherNotes || 
                      null;
 
    // ─── Informações musicais (BPM, tom, capo) — pra layout Musician ───────
    const musicInfo = {
        key: (songInfo.activeSong as any)?.key || null,        // Tom ex: "G", "D", "Em"
        bpm: (songInfo.activeSong as any)?.bpm || null,        // BPM ex: 80
        capo: (songInfo.activeSong as any)?.capo || null,      // Casa do capo ex: 2
        tempo: (songInfo.activeSong as any)?.tempo || null,    // Andamento ex: "Lento"
    };
 
    // ═════════════════════════════════════════════════════════════════════
    // PAYLOAD COMPLETO — Suporta TODOS os layouts do Stage Monitor
    // ═════════════════════════════════════════════════════════════════════
    const slidePayload = {
        type: 'slide',
        
        // ─── METADADOS DA APRESENTAÇÃO ──────────────────────────────────
        meta: {
            songTitle: songInfo.activeSong?.fullName || '',
            songId: songInfo.activeSong?.id || null,
            author: (songInfo.activeSong as any)?.author || null,
            slideNumber: slideNumber,
            totalSlides: totalSlides,
            progressPct: progressPct,
            slideKind: slideKind,           // 'verso' | 'refrao' | 'titulo' | 'geral'
            slideLabel: currentLabel,        // Ex: "Slide 3 - refrão"
            timestamp: Date.now(),
        },
        
        // ─── FUNDO (já existente) ────────────────────────────────────────
        background: {
            type: resolvedBgType,
            color: currentDesign.bgColor,
            media: currentDesign.bgMedia,
            fit: currentDesign.bgFit
        },
        
        // ─── LAYOUT VISUAL (já existente) ────────────────────────────────
        layout: {
            theme: conf.activeTheme.toLowerCase(),
            chromaKey: conf.chromaKey !== 'none' ? conf.chromaKey : 'transparent',
            opacity: conf.bgOpacity / 100,
            transition: conf.transitionType === 'fade' ? 'ease-in-out' : 'none',
            padding: `${conf.marginTop}px ${conf.marginRight}px ${conf.marginBottom}px ${conf.marginLeft}px`
        },
        
        // ─── TEXTO ATUAL (existente + enriquecido) ───────────────────────
        text: {
            content: text,
            posX: currentDesign.posX,
            posY: currentDesign.posY,
            width: currentDesign.width,
            height: currentDesign.height,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            color: style.color,
            align: style.align,
            bold: style.bold,
            italic: style.italic
        },
        
        // ─── PRÓXIMO SLIDE (enriquecido) ─────────────────────────────────
        nextSlide: nextSlide ? {
            content: {
                text: nextText,
                label: nextLabel,
                kind: getSlideKindFromLabel(nextLabel),
            }
        } : null,
        
        // ─── SLIDE ANTERIOR (NOVO) ───────────────────────────────────────
        // Útil pra layouts SplitVerse, Scrolling
        previousSlide: prevSlide ? {
            content: {
                text: prevText,
                label: prevLabel,
                kind: getSlideKindFromLabel(prevLabel),
            }
        } : null,
        
        // ─── HISTÓRICO DE SLIDES (NOVO) ──────────────────────────────────
        // Últimos 5 slides projetados — útil pro layout Scrolling
        slideHistory: getSlideHistory(currentIndex, 5),
        
        // ─── SLIDES UPCOMING (NOVO) ──────────────────────────────────────
        // Próximos 3 slides — útil pro layout Musician (banda planeja)
        upcomingSlides: getUpcomingSlides(currentIndex, 3),
        
        // ─── CHORDPRO (NOVO) ─────────────────────────────────────────────
        // Letra com cifra original — usado pelo layout ChordPro
        chordpro: chordproRaw,
        chordProRaw: chordproRaw, // alias pra compatibilidade
        
        // ─── INFORMAÇÕES MUSICAIS (NOVO) ─────────────────────────────────
        // Tom, BPM, capo — usado pelo layout Musician
        music: musicInfo,
        
        // ─── NOTAS DO PREGADOR (NOVO) ────────────────────────────────────
        // Anotações da música/sermão — usado pelos layouts Preacher e NotesOnly
        notes: songNotes,
        speakerNotes: songNotes, // alias
        
        // ─── REFERÊNCIA BÍBLICA (NOVO, se aplicável) ─────────────────────
        // Se o slide tiver uma referência bíblica embutida
        reference: extractBibleReference(text),
        
        // ─── TÍTULO DO SLIDE (NOVO) ──────────────────────────────────────
        title: songInfo.activeSong?.fullName || currentLabel,

        fullText: songSlides.value
                .map(s => s.text)
                .join('\n\n'),
    };
 
    try {
        await statusPresStore.setNewPresentation('Slides', conf.selectedMonitor)
 
        await invoke('update_projection', {
            html: JSON.stringify(slidePayload),
            targetMonitor: conf.selectedMonitor || null
        });
 
        currentTab.value = "slides"
    } catch (error) {
        console.error("Erro ao projetar o slide:", error);
    }
};

function getSlideKindFromLabel(label: string | null): string {
    if (!label) return 'geral';
    const lower = label.toLowerCase();
    if (lower.includes('título') || lower.includes('titulo')) return 'titulo';
    if (lower.includes('refrão') || lower.includes('refrao')) return 'refrao';
    if (lower.includes('verso') || lower.includes('estrofe')) return 'verso';
    return 'geral';
}

function getSlideHistory(currentIdx: number, count: number = 5) {
    const slides = songSlides.value;
    const start = Math.max(0, currentIdx - count);
    return slides.slice(start, currentIdx).map((slide, idx) => ({
        index: start + idx,
        label: slide.label,
        text: slide.text,
        kind: getSlideKindFromLabel(slide.label),
    }));
}

function getUpcomingSlides(currentIdx: number, count: number = 3) {
    const slides = songSlides.value;
    const end = Math.min(slides.length, currentIdx + 1 + count);
    return slides.slice(currentIdx + 1, end).map((slide, idx) => ({
        index: currentIdx + 1 + idx,
        label: slide.label,
        text: slide.text,
        kind: getSlideKindFromLabel(slide.label),
    }));
}

function extractBibleReference(text: string): string | null {
    if (!text) return null;
    
    // Regex pra detectar padrão "Livro Capítulo:Versículo"
    const bibleRegex = /\b([1-3]?\s*[A-ZÀ-Ú][a-zà-ú]+)\s+(\d+):(\d+)(?:-(\d+))?/;
    const match = text.match(bibleRegex);
    
    return match ? match[0] : null;
}

const stopProjection = async () => {
    await statusPresStore.clean()
};

const isClean = computed(() => songInfo.rawLyric == '')

const handleKeydown = async (e: KeyboardEvent) => {

    if (menuStore.menuOpened !== 'PdfPresenter' && !menuStore.isShiftShortcutLocked) {
        if (e.shiftKey && e.key === 'B') {
            // Necessário para não abrir a modal com o valor b por causa do autofocus
            setTimeout(() => {
                isQuickBibleOpen.value = true
            }, 50)
        }
    }

    if (!isClean.value) {
        if (e.shiftKey && e.key === 'F5') {
            currentSlideIndex.value = 0
            projectCurrentSlide()
        } else if (e.key === 'F5' && !isProjecting.value) {
            projectCurrentSlide()
        }
    }

    if (!isProjecting.value) return; // Só funciona se a projeção estiver rodando

    await slideKeypress(e.key)
};

const slideKeypress = async (key: string) => {
    switch (key) {
        case 'ArrowRight':
        case 'ArrowDown':
            // Avança slide
            if (currentSlideIndex.value < songSlides.value.length - 1) {
                currentSlideIndex.value++;
            } else {
                stopProjection()
            }
            break;
        case 'ArrowLeft':
        case 'ArrowUp':
            // Volta slide
            if (currentSlideIndex.value > 0) {
                currentSlideIndex.value--;
            }
            break;
        case 'Escape':
            if (currentSlideIndex.value === songSlides.value.length - 1) {
                stopProjection();
                break;
            }

            const confirmed = await ask('Deseja realmente encerrar a apresentação?', {
                title: 'Sigelo',
                kind: 'warning',
                okLabel: 'Sim, Encerrar',
                cancelLabel: 'Cancelar'
            });

            if (confirmed) {
                stopProjection();
            }
            break;
    }
}

const isSavePresetOpen = ref(false)

let unlistenHandleKeydown: UnlistenFn | null = null;

onMounted(async () => {
    await infoPresentationStore.loadPresets()
    window.addEventListener('keydown', handleKeydown);

    unlistenHandleKeydown = await listen<string>('handle-layout-keydown', async (e) => {
        await slideKeypress(e.payload)
    })
});

onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown);

    if (unlistenHandleKeydown) unlistenHandleKeydown()
});

watch(currentSlideIndex, () => {

    songInfo.setCurrentSlide(songSlides.value[currentSlideIndex.value] as Slide); // Log para verificar o slide atual
    if (isProjecting.value) { // Só envia se estiver no modo apresentação
        projectCurrentSlide();
    }
});

const formatRelativeTime = (date: Date | string) => {

    const d = new Date(date);
    if (isNaN(d.getTime())) return ""
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Mostra "11/04/2026 14:30:15" no tooltip
const formatFullDate = (date: Date | string) => {
    if (!date) return ""

    const d = new Date(date);
    if (isNaN(d.getTime())) return ""

    return d.toLocaleString([], {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

watch(() => songInfo.rawLyric, (newValue) => {
    isLoadedDefaultTheme.value = false
    lyric.value = newValue;
    checkEstrutura()

    songInfo.setCurrentSlide(songSlides.value[currentSlideIndex.value] as Slide);

    if (songInfo.activeSong?.id && newValue != "") {

        const presetId = infoPresentationStore.savedPresetBySong[songInfo.activeSong.id]
        fixedTheme.value = !!presetId

        if (presetId) {
            infoPresentationStore.setCurrentPresetId(presetId)
            infoPresentationStore.applyPreset(presetId)
        }

        isLoadedDefaultTheme.value = true
    }
});

const isLoadedDefaultTheme = ref(false)

const openBible = (bibleRef: BibleRef) => {
    console.log("tauri-emit", bibleRef)
    tauriEmit('open-bible', bibleRef)
}

watch(fixedTheme, () => {

    if (songInfo.activeSong?.id && isLoadedDefaultTheme.value && setNewDefaultThemeBySong.value) {
        infoPresentationStore.setPresetBySongId(songInfo.activeSong.id, fixedTheme.value ? infoPresentationStore.currentPresetId : null)
    } else {
        setNewDefaultThemeBySong.value = true
    }
})

const checkEstrutura = () => {
    if (songInfo.rawLyric) {
        infoSlides.value = parseSlides(
            songInfo.rawLyric,
            infoPresentationStore.design.targetLines,
            infoPresentationStore.design.maxLines
        );

        // Lógica para Injetar o Slide de Capa se o botão estiver ativo
        if (infoPresentationStore.design.coverSlide && songInfo.activeSong?.fullName) {
            infoSlides.value.slides.unshift(songInfo.activeSong.fullName);
            infoSlides.value.typeSlides.unshift(-1); // -1 pode ser o seu código para "Capa"
        }
    }
}

watch(
    [
        () => infoPresentationStore.design.targetLines,
        () => infoPresentationStore.design.maxLines,
        () => infoPresentationStore.design.coverSlide
    ],
    () => {
        checkEstrutura()
    }
);

const showSaveAlert = ref(false)

const updateCurrentPreset = async () => {
    if (infoPresentationStore.currentPresetId) {
        await infoPresentationStore.updateActivePreset();
        showSaveAlert.value = true
    }
}



</script>

<template>
    <div class="d-flex flex-column fill-height bg-background">
        <v-toolbar density="compact" color="surface" elevation="0" class="border-b px-2 flex-shrink-0">
            <v-btn icon variant="text" size="small" class="mr-2" @click="songInfo.toggleSidebar">
                <v-icon>{{ songInfo.showSidebarLists ? 'mdi-arrow-collapse-left' : 'mdi-arrow-expand-right' }}</v-icon>
            </v-btn>

            <v-toolbar-title class="text-subtitle-1 font-weight-bold">
                {{ songInfo.activeSong ? songInfo.activeSong.fullName : 'Modo de Apresentação' }}
            </v-toolbar-title>

            <v-spacer></v-spacer>

            <v-menu location="bottom end" v-if="!isClean">
                <template v-slot:activator="{ props: menuProps }">
                    <v-tooltip text="Opções de Salvamento" location="bottom">
                        <template v-slot:activator="{ props: tooltipProps }">
                            <v-btn v-bind="{ ...menuProps, ...tooltipProps }" icon="mdi-content-save-cog-outline"
                                variant="text" class="mr-2 text-medium-emphasis"></v-btn>
                        </template>
                    </v-tooltip>
                </template>

                <v-list density="compact" class="elevation-3" min-width="260">
                    <template v-if="infoPresentationStore.currentPreset">
                        <v-list-item lines="two" v-if="infoPresentationStore.currentPreset?.id">
                            <v-list-item-title class="text-overline font-weight-bold text-primary">
                                TEMA ATIVO
                            </v-list-item-title>
                            <v-list-item-subtitle class="text-truncate">
                                {{ infoPresentationStore.currentPreset?.name }}
                            </v-list-item-subtitle>

                            <template v-slot:append>
                                <v-icon size="small" icon="mdi-clock-outline" class="mr-1"
                                    v-tooltip:bottom="'Salvo em: ' + formatFullDate(infoPresentationStore.currentPreset.lastSaved)"></v-icon>
                                <span class="text-caption">{{
                                    formatRelativeTime(infoPresentationStore.currentPreset?.lastSaved) }}</span>
                            </template>
                        </v-list-item>
                        <v-divider class="mb-2"></v-divider>
                    </template>

                    <v-list-item class="text-red-darken-3"
                        v-if="infoPresentationStore.presets.length > 0 && infoPresentationStore.currentPreset?.id"
                        prepend-icon="mdi-content-save" title="Atualizar Tema Atual"
                        :disabled="!infoPresentationStore.currentPresetId" @click="updateCurrentPreset">
                        <template v-slot:subtitle>
                            Salva alterações no tema selecionado
                        </template>
                    </v-list-item>

                    <v-list-item class="text-green-darken-3" prepend-icon="mdi-content-save-plus"
                        title="Salvar como Novo Tema" @click="isSavePresetOpen = true">
                        <template v-slot:subtitle>
                            Cria uma nova cópia deste design
                        </template>
                    </v-list-item>
                </v-list>
            </v-menu>

            <v-divider vertical class="mx-2 my-2"></v-divider>

            <v-tooltip location="bottom" v-if="isProjecting">
                <template v-slot:activator="{ props }">
                    <v-icon v-bind="props" size="small"
                        class="mr-4 text-medium-emphasis cursor-help transition-swing hover-opacity">
                        mdi-keyboard-outline
                    </v-icon>
                </template>
                <div class="text-center pa-1">
                    <div class="text-caption font-weight-bold mb-1">Atalhos de Apresentação</div>
                    <div><kbd class="bg-grey-darken-3 px-1 rounded">←</kbd> <kbd
                            class="bg-grey-darken-3 px-1 rounded">→</kbd>
                        Navegar</div>
                    <div class="mt-1"><kbd class="bg-grey-darken-3 px-1 rounded">Esc</kbd> Sair</div>
                </div>
            </v-tooltip>

            <v-btn v-if="songInfo.activeSong && !isProjecting" color="primary" variant="flat" size="small"
                prepend-icon="mdi-play" @click="projectCurrentSlide" :disabled="isClean">Projetar</v-btn>

            <v-btn v-if="songInfo.activeSong && isProjecting" color="error" variant="flat" size="small"
                prepend-icon="mdi-stop" @click="stopProjection">Parar Apresentação</v-btn>
        </v-toolbar>

        <div v-if="songInfo.activeSong?.id && !isClean" class="d-flex flex-column flex-grow-1 overflow-hidden">

            <div class="bg-black d-flex align-center justify-center relative flex-shrink-0 preview-wrapper">
                <SlidePreview :design="design" :textStyle="currentActiveStyle" :text="currentSlideText"
                    :screenRatio="configStore.screenRatio" :editable="currentTab === 'posicao'"
                    :autoFontSize="infoPresentationStore.autoFontSize" @update-layout="handleLayoutUpdate"
                    @update-font-size="handleFontSizeUpdate" />
            </div>

            <v-card class="flex-grow-1 rounded-0 elevation-0 d-flex flex-column border-t bg-background">
                <div class="d-flex align-center bg-surface border-b flex-shrink-0">
                    <v-tooltip :text="`Preset Atual: ${infoPresentationStore.currentPreset?.name}`" location="bottom"
                        v-if="infoPresentationStore.currentPreset">
                        <template v-slot:activator="{ props }">
                            <v-chip v-bind="props" class="mx-3 cursor-pointer transition-swing" color="primary"
                                variant="tonal" prepend-icon="mdi-palette-outline" @click="isPresetModalOpen = true">
                                Tema
                            </v-chip>
                        </template>
                    </v-tooltip>

                    <v-divider vertical class="my-2" v-if="infoPresentationStore.currentPreset"></v-divider>

                    <v-tabs v-model="currentTab" bg-color="surface" density="compact" class="flex-grow-1"
                        color="primary">
                        <v-tab value="slides"><v-icon start>mdi-presentation-play</v-icon>Slides</v-tab>
                        <v-tab value="estrutura"><v-icon start>mdi-format-list-bulleted-type</v-icon>Estrutura</v-tab>
                        <v-tab value="fundo"><v-icon start>mdi-image-outline</v-icon>Fundo</v-tab>
                        <v-tab value="texto"><v-icon start>mdi-format-text</v-icon>Texto</v-tab>
                        <v-tab value="posicao"><v-icon start>mdi-crosshairs-gps</v-icon>Posição</v-tab>
                    </v-tabs>

                    <v-divider vertical class="my-2"></v-divider>
                    <div class="px-4 d-flex align-center" v-if="infoPresentationStore.currentPreset">
                        <v-tooltip text="Vincular este tema permanentemente a esta música" location="bottom"
                            open-delay="300">
                            <template v-slot:activator="{ props }">
                                <div v-bind="props" class="d-flex align-center">
                                    <v-switch v-model="fixedTheme" color="primary" density="compact" hide-details inset>
                                        <template v-slot:label>
                                            <v-icon size="small" class="mr-2 transition-swing"
                                                :color="fixedTheme ? 'primary' : 'medium-emphasis'">
                                                {{ fixedTheme ? 'mdi-pin' : 'mdi-pin-outline' }}
                                            </v-icon>

                                            <span class="text-body-2 transition-swing"
                                                :class="fixedTheme ? 'font-weight-medium text-primary' : 'text-medium-emphasis'">
                                                Fixar Tema
                                            </span>
                                        </template>
                                    </v-switch>
                                </div>
                            </template>
                        </v-tooltip>
                    </div>
                </div>

                <v-card-text class="flex-grow-1 overflow-hidden pa-0 d-flex flex-column">

                    <v-window v-model="currentTab" class="flex-grow-1 h-100">

                        <v-window-item value="slides" class="pa-4 h-100 overflow-y-auto" style="min-height: 0;">
                            <TabSlides :slides="songSlides" v-model:currentSlideIndex="currentSlideIndex"
                               />
                        </v-window-item>

                        <v-window-item value="estrutura" class="pa-4 h-100 overflow-y-auto">
                            <TabEstrutura :slides="songSlides" v-model:currentSlideIndex="currentSlideIndex" />
                        </v-window-item>

                        <v-window-item value="fundo" class="pa-6 h-100 overflow-y-auto">
                            <TabBackground />
                        </v-window-item>

                        <v-window-item value="texto" class="pa-2 pa-sm-4 h-100 overflow-y-auto">
                            <TabText :maxAllowedFontSize="maxAllowedFontSize" />
                        </v-window-item>

                        <v-window-item value="posicao"
                            class="pa-6 h-100 overflow-y-auto d-flex flex-column align-center justify-center">
                            <TabPosition />
                        </v-window-item>

                    </v-window>
                </v-card-text>
            </v-card>
        </div>

        <div v-else class="flex-grow-1 d-flex flex-column align-center justify-center text-medium-emphasis">
            <v-icon icon="mdi-projector-screen-outline" size="64" class="mb-4 text-disabled"></v-icon>
            <h3 class="font-weight-medium">{{ !songInfo.activeSong?.id ? 'Selecione uma música no repertório' :
                'Música sem letra cadastrada' }}</h3>
        </div>
    </div>
    <ModalSelectPreset v-model="isPresetModalOpen"></ModalSelectPreset>
    <ModalSavePreset v-model="isSavePresetOpen"></ModalSavePreset>
    <QuickBibleModal v-model="isQuickBibleOpen" @openReference="openBible"></QuickBibleModal>

    <v-snackbar v-model="showSaveAlert" color="success" elevation="24" rounded="pill" :timeout="3000">
        <v-icon start icon="mdi-check-circle"></v-icon>
        Preset **{{ infoPresentationStore.currentPreset?.name }}** atualizado com sucesso!

        <template v-slot:actions>
            <v-btn variant="text" @click="showSaveAlert = false">Fechar</v-btn>
        </template>
    </v-snackbar>
</template>
