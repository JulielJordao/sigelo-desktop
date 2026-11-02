<script setup lang="ts">
// Editor de atalhos (Configurações → Atalhos).
// Mostra o atalho no formato do sistema (⌘K no Mac, Ctrl+K no Windows/Linux),
// permite trocar e avisa quando a combinação não funciona em algum sistema.
import { ref, computed, onBeforeUnmount } from 'vue';
import {
  useShortcutStore,
  FIXED_SHORTCUTS,
  OS_LABEL,
  bindingParts,
  bindingStatusByOs,
  eventToBinding,
  isModifierOnly,
  validateBinding,
  type Binding,
  type ShortcutId,
} from '../../stores/shortcutStore';

const store = useShortcutStore();

const editing = ref<{ id: ShortcutId; label: string } | null>(null);
const captured = ref<Binding | null>(null);
const foreignMod = ref(false);

const osIcon: Record<string, string> = { windows: 'mdi-microsoft-windows', macos: 'mdi-apple', linux: 'mdi-linux' };

/** Situação de cada atalho atual nos 3 sistemas (para os ícones da lista). */
const rows = computed(() =>
  store.bindings.map((item) => ({
    ...item,
    parts: bindingParts(item.binding, store.os),
    status: bindingStatusByOs(item.binding),
  }))
);

const capturedParts = computed(() => (captured.value ? bindingParts(captured.value, store.os) : []));
const capturedStatus = computed(() => (captured.value?.code ? bindingStatusByOs(captured.value) : []));
const conflict = computed(() =>
  editing.value && captured.value?.code ? store.conflictWith(editing.value.id, captured.value) : undefined
);
const currentOsErrors = computed(() =>
  captured.value?.code ? validateBinding(captured.value, store.os).filter((i) => i.level === 'error') : []
);
const canSave = computed(
  () => !!captured.value?.code && !conflict.value && !foreignMod.value && currentOsErrors.value.length === 0
);

const onCaptureKey = (e: KeyboardEvent) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    cancel();
    return;
  }
  const result = eventToBinding(e, store.os);
  foreignMod.value = result.foreignMod;
  // Só modificadores: mostra enquanto segura, espera a tecla final.
  captured.value = isModifierOnly(e) ? { ...result.binding, code: '' } : result.binding;
};

const startEdit = (id: ShortcutId, label: string) => {
  editing.value = { id, label };
  captured.value = null;
  foreignMod.value = false;
  store.isCapturing = true;
  window.addEventListener('keydown', onCaptureKey, true);
};

const stopCapture = () => {
  window.removeEventListener('keydown', onCaptureKey, true);
  store.isCapturing = false;
};

const cancel = () => {
  stopCapture();
  editing.value = null;
  captured.value = null;
};

const save = () => {
  if (!editing.value || !captured.value || !canSave.value) return;
  store.setBinding(editing.value.id, captured.value);
  cancel();
};

const levelColor = (level: string) => (level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'success');
const levelIcon = (level: string) =>
  level === 'error' ? 'mdi-close-circle' : level === 'warning' ? 'mdi-alert' : 'mdi-check-circle';
const statusTip = (s: { os: string; level: string; issues: { message: string }[] }) =>
  `${OS_LABEL[s.os as keyof typeof OS_LABEL]}: ` +
  (s.issues.length ? s.issues.map((i) => i.message).join(' ') : 'funciona normalmente.');

onBeforeUnmount(stopCapture);
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-2">
      <p class="text-body-2 text-medium-emphasis mb-0">
        Atalhos deste computador ({{ OS_LABEL[store.os] }}). As alterações valem na hora.
      </p>
      <v-btn size="small" variant="text" prepend-icon="mdi-restore" class="text-none" @click="store.resetAll()">
        Restaurar padrões
      </v-btn>
    </div>

    <v-table density="compact" class="border rounded-lg">
      <thead>
        <tr>
          <th class="text-left font-weight-bold">Ação</th>
          <th class="text-left font-weight-bold">Atalho</th>
          <th class="text-left font-weight-bold">Sistemas</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>
            <div class="font-weight-medium">{{ row.label }}</div>
            <div class="text-caption text-medium-emphasis">{{ row.description }}</div>
          </td>
          <td class="text-no-wrap">
            <kbd v-for="(p, i) in row.parts" :key="i" class="kbd">{{ p }}</kbd>
            <v-chip v-if="row.isCustom" size="x-small" variant="tonal" color="primary" class="ml-1">alterado</v-chip>
          </td>
          <td class="text-no-wrap">
            <v-tooltip v-for="s in row.status" :key="s.os" location="top" max-width="320">
              <template #activator="{ props }">
                <v-icon v-bind="props" size="18" class="mr-1" :color="s.level === 'ok' ? undefined : levelColor(s.level)">
                  {{ osIcon[s.os] }}
                </v-icon>
              </template>
              {{ statusTip(s) }}
            </v-tooltip>
          </td>
          <td class="text-right text-no-wrap">
            <v-btn size="small" variant="tonal" class="text-none" @click="startEdit(row.id, row.label)">Alterar</v-btn>
            <v-btn v-if="row.isCustom" size="small" variant="text" icon="mdi-restore" class="ml-1"
              v-tooltip:top="'Voltar ao padrão'" @click="store.resetBinding(row.id)" />
          </td>
        </tr>
        <tr v-for="fixed in FIXED_SHORTCUTS" :key="fixed.label" class="text-medium-emphasis">
          <td>{{ fixed.label }}</td>
          <td class="text-no-wrap"><kbd v-for="k in fixed.keys" :key="k" class="kbd">{{ k }}</kbd></td>
          <td colspan="2" class="text-caption">Fixo</td>
        </tr>
      </tbody>
    </v-table>

    <!-- Captura da nova combinação -->
    <v-dialog :model-value="!!editing" max-width="520" persistent @update:model-value="(v: boolean) => !v && cancel()">
      <v-card v-if="editing" rounded="lg">
        <v-card-title class="text-subtitle-1 font-weight-bold pt-4">Novo atalho — {{ editing.label }}</v-card-title>
        <v-card-text>
          <div class="capture-box d-flex align-center justify-center mb-4">
            <template v-if="capturedParts.length && captured?.code">
              <kbd v-for="(p, i) in capturedParts" :key="i" class="kbd kbd-lg">{{ p }}</kbd>
            </template>
            <span v-else class="text-medium-emphasis">
              Pressione a combinação ({{ store.os === 'macos' ? '⌘' : 'Ctrl' }} + tecla recomendado). Esc cancela.
            </span>
          </div>

          <v-alert v-if="foreignMod" type="error" variant="tonal" density="compact" class="mb-2">
            {{ store.os === 'macos'
              ? 'No macOS use ⌘ (Command): Control + letra move o cursor nos campos de texto.'
              : 'A tecla Windows/Super é reservada pelo sistema.' }}
          </v-alert>
          <v-alert v-if="conflict" type="error" variant="tonal" density="compact" class="mb-2">
            Já usado em "{{ conflict.label }}".
          </v-alert>

          <div v-if="capturedStatus.length" class="d-flex flex-column ga-2">
            <div v-for="s in capturedStatus" :key="s.os" class="d-flex align-start ga-2">
              <v-icon size="20" :color="levelColor(s.level)">{{ levelIcon(s.level) }}</v-icon>
              <div>
                <div class="text-body-2 font-weight-medium">
                  <v-icon size="16" class="mr-1">{{ osIcon[s.os] }}</v-icon>{{ OS_LABEL[s.os] }}
                  <span v-if="s.os === store.os" class="text-caption text-medium-emphasis">(este computador)</span>
                </div>
                <div v-if="s.issues.length" class="text-caption text-medium-emphasis">
                  <div v-for="(issue, i) in s.issues" :key="i">{{ issue.message }}</div>
                </div>
                <div v-else class="text-caption text-medium-emphasis">Funciona normalmente.</div>
              </div>
            </div>
          </div>
        </v-card-text>
        <v-card-actions class="px-6 pb-4">
          <v-spacer />
          <v-btn variant="text" class="text-none" @click="cancel">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" class="text-none" :disabled="!canSave" @click="save">Salvar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.kbd {
  display: inline-block;
  min-width: 22px;
  padding: 1px 6px;
  margin-right: 3px;
  border: 1px solid rgba(var(--v-border-color), 0.3);
  border-bottom-width: 2px;
  border-radius: 5px;
  font: 600 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.kbd-lg {
  font-size: 18px;
  padding: 4px 12px;
  min-width: 36px;
}

.capture-box {
  min-height: 72px;
  border: 2px dashed rgba(var(--v-border-color), 0.3);
  border-radius: 10px;
  padding: 12px;
  text-align: center;
}
</style>
