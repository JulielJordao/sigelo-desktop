<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import SearchSongModal from '../songs/SearchSongModal.vue';
import { useMenuStore } from '../../stores/menuStore';
import { useLocalGroupStore } from '../../stores/localGroupStore';
import type { SongCache } from '../../stores/songCacheStore';

interface GroupItem {
  id: string;
  label: string;
  songs: SongCache[];
  isLocal?: boolean;
}

defineProps<{
  groups: Array<GroupItem>;
  selectedId: string | null;
}>();

const emit = defineEmits<{ (e: 'select', id: string): void }>();

const menuStore = useMenuStore()
const localGroupStore = useLocalGroupStore()

const isSearchModalOpen = ref(false)

const selectGroup = (groupId: string) => emit('select', groupId);

// --- Menu de contexto (botão direito) ---
const ctx = ref<{ open: boolean; x: number; y: number; group: GroupItem | null }>({
  open: false, x: 0, y: 0, group: null,
});

const onContextMenu = (e: MouseEvent, group: GroupItem) => {
  if (!group.isLocal) return; // só repertório local é editável
  ctx.value = { open: true, x: e.clientX, y: e.clientY, group };
};

// --- Dialog criar/editar ---
const dialog = ref({
  open: false,
  mode: 'create' as 'create' | 'edit',
  id: '',
  label: '',
});

const openCreate = () => {
  dialog.value = { open: true, mode: 'create', id: '', label: '' };
};

const openEdit = () => {
  const g = ctx.value.group;
  if (!g) return;
  dialog.value = { open: true, mode: 'edit', id: g.id, label: g.label };
};

const saveDialog = async () => {
  const label = dialog.value.label.trim();
  if (!label) return;

  if (dialog.value.mode === 'create') {
    const created = await localGroupStore.createGroup(label);
    selectGroup(created.id);
  } else {
    await localGroupStore.renameGroup(dialog.value.id, label);
  }
  dialog.value.open = false;
};

// --- Exclusão com confirmação ---
const confirmDelete = ref({ open: false, id: '', label: '' });

const askDelete = () => {
  const g = ctx.value.group;
  if (!g) return;
  confirmDelete.value = { open: true, id: g.id, label: g.label };
};

const doDelete = async () => {
  await localGroupStore.deleteGroup(confirmDelete.value.id);
  confirmDelete.value.open = false;
};

// --- Atalho Shift+F ---
const handleKeydown = (e: KeyboardEvent) => {
  if (menuStore.isShiftShortcutLocked) return;
  if (menuStore.menuOpened === 'Media' || menuStore.menuOpened === 'Songs') {
    if (e.shiftKey && e.key.toUpperCase() === 'F') {
      setTimeout(() => { isSearchModalOpen.value = true }, 50);
    }
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <div class="d-flex flex-column fill-height">
    <v-toolbar density="compact" color="surface" elevation="0" class="border-b">
      <v-toolbar-title class="text-subtitle-2 font-weight-bold">Repertórios</v-toolbar-title>

      <v-btn icon density="comfortable" @click="openCreate">
        <v-icon>mdi-plus</v-icon>
        <v-tooltip activator="parent" location="bottom">Novo repertório local</v-tooltip>
      </v-btn>

      <v-btn icon density="comfortable" @click="isSearchModalOpen = true">
        <v-icon>mdi-magnify</v-icon>
      </v-btn>
    </v-toolbar>

    <v-list density="compact" class="flex-grow-1 overflow-y-auto" nav>
      <v-list-item
        v-for="group in groups"
        :key="group.id"
        :value="group.id"
        :active="selectedId === group.id"
        color="primary"
        rounded="lg"
        @click="selectGroup(group.id)"
        @contextmenu.prevent="onContextMenu($event, group)"
      >
        <template v-slot:prepend>
          <v-icon
            :icon="group.isLocal ? 'mdi-folder-edit-outline' : 'mdi-folder-music-outline'"
            size="small"
          />
        </template>

        <v-list-item-title class="text-body-2">{{ group.label }}</v-list-item-title>

        <template v-slot:append>
          <!-- local NÃO recebe ícone de nuvem -->
          <v-icon
            v-if="!group.isLocal && group.songs.length > 0"
            icon="mdi-cloud-check-outline"
            size="small"
            color="success"
          >
            <v-tooltip activator="parent" location="top" open-delay="200">
              Repertório disponível offline
            </v-tooltip>
          </v-icon>
        </template>
      </v-list-item>

      <div v-if="groups.length === 0" class="text-center pa-4 text-caption text-grey">
        Nenhum repertório.
      </div>
    </v-list>

    <!-- Menu do botão direito (só abre em repertório local) -->
    <v-menu v-model="ctx.open" :target="[ctx.x, ctx.y]" location="bottom start">
      <v-list density="compact">
        <v-list-item prepend-icon="mdi-pencil" @click="openEdit">
          <v-list-item-title>Editar nome</v-list-item-title>
        </v-list-item>
        <v-list-item prepend-icon="mdi-delete" base-color="error" @click="askDelete">
          <v-list-item-title>Excluir repertório</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>

    <!-- Criar / renomear -->
    <v-dialog v-model="dialog.open" max-width="420">
      <v-card>
        <v-card-title class="text-subtitle-1">
          {{ dialog.mode === 'create' ? 'Novo repertório local' : 'Editar repertório' }}
        </v-card-title>
        <v-card-text>
          <v-text-field
            v-model="dialog.label"
            label="Nome"
            density="compact"
            variant="outlined"
            autofocus
            hide-details
            @keyup.enter="saveDialog"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.open = false">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" @click="saveDialog">Salvar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Confirmar exclusão -->
    <v-dialog v-model="confirmDelete.open" max-width="420">
      <v-card>
        <v-card-title class="text-subtitle-1">Excluir repertório</v-card-title>
        <v-card-text class="text-body-2">
          Excluir <strong>{{ confirmDelete.label }}</strong> e todas as músicas dele?
          Esta ação não pode ser desfeita.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmDelete.open = false">Cancelar</v-btn>
          <v-btn color="error" variant="flat" @click="doDelete">Excluir</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <SearchSongModal v-model="isSearchModalOpen" />
  </div>
</template>