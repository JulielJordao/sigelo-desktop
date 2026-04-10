<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useEventStore } from '../../stores/eventStore';

import type { Event } from '../../types/event'; 
import { useMusicPresentationStore } from '../../stores/presentationStore';

const eventStore = useEventStore();
const musicStore = useMusicPresentationStore();

//const isOpen = computed(() => menuStore.menuOpened === 'Events'); 

const selectedDate = ref<Date | null>(null);
const selectedEvent = ref<Event | null>(null);
const showEventPopup = ref(false); 

// ==========================================
// LÓGICA DE DATAS E EVENTOS
// ==========================================

const resetTime = (d: Date | string) => {
  const dateObj = new Date(d);
  return new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()).getTime();
};

const eventDates = computed(() => {
  return (eventStore.events || []).map(e => new Date(e.date));
});

// 1. TRAVA DO CALENDÁRIO: Habilita apenas os dias que possuem culto/evento
const allowedDates = (val: unknown) => {
  const targetTime = resetTime(val as Date);
  return eventDates.value.some(d => resetTime(d) === targetTime);
};

const eventsOnSelectedDate = computed(() => {
  if (!selectedDate.value) return [];
  const targetTime = resetTime(selectedDate.value);
  return (eventStore.events || []).filter(e => resetTime(e.date) === targetTime);
});

// ==========================================
// 2. MÁGICA DOS PONTINHOS AZUIS (CSS DINÂMICO)
// ==========================================
// Como o Vuetify 3 não tem mais a prop 'events', injetamos o ponto via CSS na data correta.
const eventCssClasses = computed(() => {
  const events = eventStore.events || [];
  if (events.length === 0) return '';
  
  const uniqueDates = new Set(events.map(e => {
    const d = new Date(e.date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    // Gera as variações de datas que o Vuetify pode renderizar na sua versão
    return { padded: `${y}-${m}-${day}`, unpadded: `${y}-${d.getMonth() + 1}-${d.getDate()}` };
  }));

  let selectors: string[] = [];
  uniqueDates.forEach(date => {
    selectors.push(`[data-v-date^="${date.padded}"] .v-btn::after`);
    selectors.push(`[data-v-date^="${date.unpadded}"] .v-btn::after`);
  });

  return `
    ${selectors.join(',\n')} {
      content: '';
      position: absolute;
      bottom: 2px;
      left: 50%;
      transform: translateX(-50%);
      width: 6px;
      height: 6px;
      background-color: rgb(var(--v-theme-primary));
      border-radius: 50%;
    }
  `;
});

// ==========================================
// AÇÕES E VIGILANTES (WATCHERS)
// ==========================================

watch(selectedDate, (newDate) => {
  if (newDate && eventsOnSelectedDate.value.length > 0) {
    showEventPopup.value = true;
  } else {
    showEventPopup.value = false;
  }
});

const handleSelectEvent = async (event: Event) => {
  selectedEvent.value = event;
  showEventPopup.value = false; // Fecha o popup assim que escolhe o evento
  
  // Chama o back-end/store para carregar o repertório!
  await eventStore.getSongsForEvent(event);
};

const formatDate = (dateString: string | Date) => {
  const dateObj = new Date(dateString);
  return dateObj.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
};

const clearSelection = () => {
  selectedDate.value = null;
  selectedEvent.value = null;
};

onMounted(async () => {
  await eventStore.loadEvents();
}); 
</script>

<template>
  <component :is="'style'">{{ eventCssClasses }}</component>
  
  <div class="d-flex flex-column fill-height">
    <div class="d-flex flex-column fill-height bg-grey-lighten-4 position-relative">
      
      <div class="bg-surface elevation-1 z-10" style="position: sticky; top: 0; z-index: 10;">
        <v-toolbar density="compact" color="transparent" elevation="0">
          <v-toolbar-title class="text-subtitle-1 font-weight-bold">
            <v-icon start color="primary">mdi-calendar-star</v-icon> Eventos
          </v-toolbar-title>
          <v-spacer></v-spacer>
          
          <v-btn v-if="selectedEvent" size="small" variant="tonal" color="primary" @click="clearSelection" prepend-icon="mdi-arrow-left" class="mr-2 text-none">
            Voltar ao Calendário
          </v-btn>
        </v-toolbar>
      </div>

      <div class="bg-surface-light border-b px-4 py-3 d-flex justify-center" style="min-height: 350px;">
        <v-date-picker 
          v-model="selectedDate" 
          :allowed-dates="allowedDates"
          color="primary" 
          hide-header
          elevation="0"
          width="100%"
          class="w-100 border rounded-lg"
        ></v-date-picker>
      </div>

      <div class=" bg-surface-light flex-grow-1 overflow-y-auto pa-3">
        <v-slide-y-transition mode="out-in">
          
          <div v-if="selectedEvent" :key="'content-' + selectedEvent._id">
            <div class="bg-surface d-flex align-center justify-space-between mb-3 bg-white pl-2 pr-2 rounded-lg border-sm elevation-1">
              <div class="overflow-hidden mr-2">
                <h3 class="text-subtitle-1 font-weight-bold text-truncate" :title="selectedEvent.name">{{ selectedEvent.name }}</h3>
                 <!-- <span class="text-caption text-grey-darken-1 d-block text-truncate">
                  <v-icon size="x-small" start>mdi-music-clef-treble</v-icon> Repertório de Músicas
                </span> -->
              </div>
              <v-chip size="small" color="primary" variant="tonal" class="flex-shrink-0">
                {{ eventStore.songsByEvent.length }} Músicas
              </v-chip>
            </div>

            <v-card v-if="eventStore.songsByEvent.length > 0" class="border-sm rounded-lg" elevation="0">
              <v-list density="compact" class="bg-transparent pa-0">
                <v-list-item 
                  v-for="(song, index) in eventStore.songsByEvent" 
                  :key="song._id"
                  class="border-b"
                >
                  <template v-slot:prepend>
                    <div class="text-caption text-grey font-weight-bold mr-3" style="width: 20px;">{{ index + 1 }}</div>
                  </template>
                  
                  <v-list-item-title class="font-weight-bold text-subtitle-2">{{ song.fullName  }}</v-list-item-title>
                  <v-list-item-subtitle class="text-caption">{{ song.writerBy }}</v-list-item-subtitle>
                  
                  <template v-slot:append>
                    <v-chip v-if="song.tone" size="x-small" color="secondary" variant="flat" class="font-weight-bold mr-2">{{ song.tone }}</v-chip>
                    <v-btn icon="mdi-play-circle-outline" size="small" color="primary" variant="text" @click="musicStore.setCustomSong(song)"></v-btn>
                  </template>
                </v-list-item>
              </v-list>
            </v-card>

            <div v-else class="text-center pa-6 bg-white rounded-lg border-sm border-dashed">
              <v-icon size="40" color="grey-lighten-2" class="mb-2">mdi-music-off</v-icon>
              <p class="text-caption text-grey-darken-1">Nenhuma música adicionada a este evento ainda.</p>
              <v-btn size="small" color="primary" variant="tonal" class="mt-3" prepend-icon="mdi-plus">Adicionar Música</v-btn>
            </div>
          </div>

          <div v-else :key="'no-selection'" class="h-100 d-flex flex-column align-center justify-center text-center mt-10">
            <v-icon size="64" color="grey-lighten-2" class="mb-4">mdi-gesture-tap</v-icon>
            <h3 class="text-h6 font-weight-bold text-grey-darken-2">Selecione uma Data</h3>
            <p class="text-body-2 text-grey px-6 mt-2">
              Clique em um dia no calendário marcado com um <strong>ponto azul</strong> para visualizar os eventos e carregar o repertório.
            </p>
          </div>
        </v-slide-y-transition>
      </div>

    </div>

    <v-dialog v-model="showEventPopup" max-width="400">
      <v-card  class="rounded-lg">
        <v-toolbar color="primary" density="compact">
          <v-toolbar-title class="text-subtitle-1 font-weight-bold">
            Eventos do Dia
          </v-toolbar-title>
          <v-spacer></v-spacer>
          <v-btn icon="mdi-close" variant="text" @click="showEventPopup = false"></v-btn>
        </v-toolbar>

        <div class="bg-variant-light px-4 py-2 text-caption text-center font-weight-medium text-grey-darken-2 text-uppercase">
          {{ selectedDate ? formatDate(selectedDate) : '' }}
        </div>

        <v-card-text class="pa-3 bg-variant-light">
          <v-slide-y-transition group>
            <v-card 
              v-for="ev in eventsOnSelectedDate" 
              :key="ev._id"
              color="surface"
              class="mb-3 border-sm cursor-pointer transition-all elevation-1"
              hover
              @click="handleSelectEvent(ev)"
            >
              <div class="pa-3 d-flex align-center">
                <v-avatar color="primary" size="40" variant="tonal" class="mr-3">
                  <v-icon>mdi-calendar-check</v-icon>
                </v-avatar>
                <div class="flex-grow-1 overflow-hidden">
                  <div class="text-subtitle-2 font-weight-bold text-truncate">{{ ev.name }}</div>
                  <div v-if="ev.description" class="text-caption text-grey text-truncate">{{ ev.description }}</div>
                </div>
                <v-icon color="grey-lighten-1">mdi-chevron-right</v-icon>
              </div>
            </v-card>
          </v-slide-y-transition>
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

/* Garante que o botão permita que a bolinha apareça */
:deep(.v-date-picker-month__day .v-btn) {
  position: relative !important;
}
</style>