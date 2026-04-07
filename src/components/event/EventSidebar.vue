<script setup lang="ts">
import { ref, computed } from 'vue';
import { useMenuStore } from '../../stores/menuStore';

// Tipagens Mockadas (Depois você moverá para o seu eventStore)
interface Song {
  id: string;
  title: string;
  artist: string;
  key?: string; // Tom da música
}

interface AppEvent {
  id: string;
  title: string;
  date: Date;
  description?: string;
  songs: Song[];
}

const menuStore = useMenuStore();
const isOpen = computed(() => menuStore.menuOpened === 'Events'); // Ajuste o nome conforme o seu menu

const selectedDate = ref<Date | null>(null);
const selectedEvent = ref<AppEvent | null>(null);

const closeMenu = () => {
  menuStore.toggleMenu(menuStore.oldMenuOpened);
};

// ==========================================
// DADOS DE TESTE (Substitua pelo seu Store)
// ==========================================
const today = new Date();
const mockEvents = ref<AppEvent[]>([
  {
    id: '1',
    title: 'Culto de Domingo',
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2),
    description: 'Culto da Família - 19h',
    songs: [
      { id: 'm1', title: 'Oceanos (Oceans)', artist: 'Ana Nóbrega', key: 'D' },
      { id: 'm2', title: 'Ruja o Leão', artist: 'Talita', key: 'G' },
      { id: 'm3', title: 'Agnus Dei', artist: 'Michael W. Smith', key: 'A' }
    ]
  },
  {
    id: '2',
    title: 'Ensaio Geral',
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1),
    songs: [
      { id: 'm4', title: 'Lindo És', artist: 'Livres', key: 'E' }
    ]
  },
  {
    id: '3',
    title: 'Culto de Jovens',
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5),
    songs: []
  }
]);

// ==========================================
// LÓGICA DE FILTRAGEM DE DATAS
// ==========================================
const resetTime = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const filteredEvents = computed(() => {
  // 1. Se o usuário clicou em uma data no calendário:
  if (selectedDate.value) {
    const targetTime = resetTime(selectedDate.value);
    return mockEvents.value.filter(e => resetTime(e.date) === targetTime);
  }

  // 2. Se nenhuma data selecionada: Mostrar os últimos 2 dias e os próximos 7 dias
  const now = resetTime(today);
  const minDate = now - (2 * 24 * 60 * 60 * 1000); // -2 dias
  const maxDate = now + (7 * 24 * 60 * 60 * 1000); // +7 dias

  return mockEvents.value
    .filter(e => {
      const eventTime = resetTime(e.date);
      return eventTime >= minDate && eventTime <= maxDate;
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime()); // Ordena cronologicamente
});

// Ao clicar em um evento na lista superior
const handleSelectEvent = (event: AppEvent) => {
  selectedEvent.value = selectedEvent.value?.id === event.id ? null : event;
};

// Função auxiliar para formatar a data na lista
const formatDate = (date: Date) => {
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
};

// Limpa o filtro de data do calendário
const clearDateFilter = () => {
  selectedDate.value = null;
  selectedEvent.value = null;
};
</script>

<template>
  <v-navigation-drawer v-model="isOpen" width="500">
    <div class="d-flex flex-column fill-height bg-grey-lighten-4 position-relative">
      
      <div class="bg-white elevation-1 z-10" style="position: sticky; top: 0; z-index: 10;">
        <v-toolbar density="compact" color="transparent" elevation="0">
          <v-toolbar-title class="text-subtitle-1 font-weight-bold">
            <v-icon start color="primary">mdi-calendar-star</v-icon> Eventos
          </v-toolbar-title>
          <v-spacer></v-spacer>
          
          <v-btn v-if="selectedDate" size="small" variant="text" color="primary" @click="clearDateFilter" class="mr-2 text-none">
            Ver Próximos
          </v-btn>
          <v-btn icon="mdi-close" size="small" variant="text" @click="closeMenu"></v-btn>
        </v-toolbar>
      </div>

      <div class="d-flex bg-white border-b px-2 py-3" style="min-height: 280px;">
        
        <div class="flex-shrink-0 mr-3" style="width: 250px;">
          <v-date-picker 
            v-model="selectedDate" 
            color="primary" 
            density="compact" 
            hide-header
            elevation="0"
            class="border rounded-lg"
          ></v-date-picker>
        </div>

        <div class="flex-grow-1 d-flex flex-column overflow-hidden">
          <div class="text-caption font-weight-bold text-grey-darken-1 mb-2 text-uppercase d-flex align-center">
            <v-icon size="small" class="mr-1">mdi-format-list-bulleted</v-icon>
            {{ selectedDate ? 'Eventos da Data' : 'Últimos e Próximos' }}
          </div>
          
          <div class="overflow-y-auto flex-grow-1 pr-1 custom-scrollbar">
            <v-slide-y-transition group>
              <v-card 
                v-for="ev in filteredEvents" 
                :key="ev.id"
                :color="selectedEvent?.id === ev.id ? 'primary' : 'grey-lighten-4'"
                :variant="selectedEvent?.id === ev.id ? 'flat' : 'flat'"
                class="mb-2 border-sm cursor-pointer transition-all"
                hover
                @click="handleSelectEvent(ev)"
              >
                <div class="pa-2 d-flex flex-column">
                  <div class="d-flex justify-space-between align-center mb-1">
                    <span class="text-caption font-weight-bold text-uppercase" :class="selectedEvent?.id === ev.id ? 'text-white' : 'text-primary'">
                      {{ formatDate(ev.date) }}
                    </span>
                  </div>
                  <span class="text-subtitle-2 font-weight-bold line-clamp-1" :class="selectedEvent?.id === ev.id ? 'text-white' : 'text-grey-darken-4'">
                    {{ ev.title }}
                  </span>
                  <span v-if="ev.description" class="text-caption line-clamp-1" :class="selectedEvent?.id === ev.id ? 'text-white text-opacity-80' : 'text-grey'">
                    {{ ev.description }}
                  </span>
                </div>
              </v-card>
            </v-slide-y-transition>

            <div v-if="filteredEvents.length === 0" class="h-100 d-flex flex-column align-center justify-center text-center pa-2">
              <v-icon size="large" color="grey-lighten-1" class="mb-1">mdi-calendar-blank</v-icon>
              <span class="text-caption text-grey">Nenhum evento aqui.</span>
            </div>
          </div>
        </div>
      </div>

      <div class="flex-grow-1 overflow-y-auto pa-3">
        
        <v-slide-y-transition mode="out-in">
          <div v-if="selectedEvent" :key="'content-' + selectedEvent.id">
            <div class="d-flex align-center justify-space-between mb-3 bg-white pa-3 rounded-lg border-sm elevation-1">
              <div>
                <h3 class="text-subtitle-1 font-weight-bold">{{ selectedEvent.title }}</h3>
                <span class="text-caption text-grey-darken-1"><v-icon size="x-small" start>mdi-music-clef-treble</v-icon> Repertório de Músicas</span>
              </div>
              <v-chip size="small" color="primary" variant="tonal">{{ selectedEvent.songs.length }} Músicas</v-chip>
            </div>

            <v-card v-if="selectedEvent.songs.length > 0" class="border-sm rounded-lg" elevation="0">
              <v-list density="compact" class="bg-transparent pa-0">
                <v-list-item 
                  v-for="(song, index) in selectedEvent.songs" 
                  :key="song.id"
                  class="border-b"
                >
                  <template v-slot:prepend>
                    <div class="text-caption text-grey font-weight-bold mr-3" style="width: 20px;">{{ index + 1 }}</div>
                  </template>
                  
                  <v-list-item-title class="font-weight-bold text-subtitle-2">{{ song.title }}</v-list-item-title>
                  <v-list-item-subtitle class="text-caption">{{ song.artist }}</v-list-item-subtitle>
                  
                  <template v-slot:append>
                    <v-chip v-if="song.key" size="x-small" color="secondary" variant="flat" class="font-weight-bold mr-2">{{ song.key }}</v-chip>
                    <v-btn icon="mdi-play-circle-outline" size="small" color="primary" variant="text"></v-btn>
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
            <v-icon size="64" color="grey-lighten-2" class="mb-4">mdi-playlist-star</v-icon>
            <h3 class="text-h6 font-weight-bold text-grey-darken-2">Repertório</h3>
            <p class="text-body-2 text-grey px-6">
              Selecione um evento na lista superior para visualizar e gerenciar as músicas que serão reproduzidas.
            </p>
          </div>
        </v-slide-y-transition>
        
      </div>
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;  
  overflow: hidden;
}

.transition-all {
  transition: all 0.3s ease;
}

/* Scrollbar mais fina para a lista pequena não ficar feia */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(0,0,0,0.1);
  border-radius: 10px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(0,0,0,0.2);
}
</style>