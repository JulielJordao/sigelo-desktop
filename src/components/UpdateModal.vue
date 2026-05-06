<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import { useUpdaterStore } from '../stores/updaterStore';
import { relaunch } from '@tauri-apps/plugin-process';
import { isMockUpdate } from '../services/updater';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const updaterStore = useUpdaterStore();

const isOpen = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

// Configura o marked para um output mais limpo
marked.setOptions({ breaks: true });

const renderedBody = computed(() => {
  const body = updaterStore.update?.body;
  if (!body) return '';
  return marked.parse(body) as string;
});

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const isMock = computed(() => isMockUpdate(updaterStore.update));

const handleInstall = async () => {
  await updaterStore.install();
};

const handleRelaunch = async () => {
  await relaunch();
};

const handleDismiss = () => {
  updaterStore.dismiss();
  isOpen.value = false;
};
</script>

<template>
  <v-dialog v-model="isOpen" max-width="520" persistent scrollable>
    <v-card class="rounded-lg overflow-hidden">

      <div class="bg-success pa-4 text-white d-flex align-center">
        <v-icon size="32" class="mr-3">mdi-rocket-launch</v-icon>
        <div class="flex-grow-1">
          <div class="text-h6 font-weight-bold">Nova versão disponível</div>
          <div class="text-caption opacity-90">
            Sigelo {{ updaterStore.update?.version }}
            <v-chip v-if="isMock" size="x-small" color="warning" variant="flat" class="ml-2">
              SIMULAÇÃO
            </v-chip>
          </div>
        </div>
      </div>

      <v-card-text class="pa-4" style="max-height: 420px; overflow-y: auto;">

        <!-- Notas do CHANGELOG renderizadas em markdown -->
        <div v-if="updaterStore.state === 'available'">
          <div class="text-subtitle-2 font-weight-bold mb-3 d-flex align-center">
            <v-icon size="small" class="mr-1">mdi-text-box-outline</v-icon>
            Novidades
          </div>
          <div
            class="bg-surface-light rounded pa-3 text-body-2 changelog-body"
            v-html="renderedBody"
          ></div>
        </div>

        <!-- Progresso de download -->
        <div v-else-if="updaterStore.state === 'downloading'">
          <div class="text-subtitle-2 font-weight-bold mb-2 d-flex align-center">
            <v-icon size="small" class="mr-1" color="primary">mdi-download</v-icon>
            Baixando atualização...
          </div>
          <v-progress-linear
            :model-value="updaterStore.progress"
            color="primary"
            height="10"
            rounded
            class="mb-2"
          ></v-progress-linear>
          <div class="d-flex justify-space-between text-caption text-medium-emphasis">
            <span>
              {{ formatBytes(updaterStore.downloadedBytes) }} /
              {{ formatBytes(updaterStore.totalBytes) }}
            </span>
            <span class="font-weight-bold">{{ updaterStore.progress.toFixed(0) }}%</span>
          </div>
        </div>

        <!-- Pronto para reiniciar -->
        <div v-else-if="updaterStore.state === 'ready'" class="text-center pa-4">
          <v-icon size="64" color="success" class="mb-3">mdi-check-circle</v-icon>
          <div class="text-h6 mb-2">Atualização instalada!</div>
          <div class="text-body-2 text-medium-emphasis">
            Reinicie o Sigelo para começar a usar a nova versão.
          </div>
        </div>

        <!-- Erro -->
        <div v-else-if="updaterStore.state === 'error'" class="text-center pa-4">
          <v-icon size="64" color="error" class="mb-3">mdi-alert-circle</v-icon>
          <div class="text-h6 mb-2">Erro ao atualizar</div>
          <div class="text-body-2 text-medium-emphasis">{{ updaterStore.error }}</div>
        </div>

      </v-card-text>

      <v-divider></v-divider>

      <v-card-actions class="pa-3">
        <template v-if="updaterStore.state === 'available'">
          <v-btn variant="text" @click="handleDismiss">Depois</v-btn>
          <v-spacer></v-spacer>
          <v-btn color="success" variant="flat" prepend-icon="mdi-download" @click="handleInstall">
            Atualizar agora
          </v-btn>
        </template>

        <template v-else-if="updaterStore.state === 'downloading'">
          <v-spacer></v-spacer>
          <v-btn variant="text" disabled>Aguarde...</v-btn>
        </template>

        <template v-else-if="updaterStore.state === 'ready'">
          <v-spacer></v-spacer>
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-restart"
            @click="handleRelaunch"
            :disabled="isMock"
          >
            {{ isMock ? 'Reiniciaria aqui' : 'Reiniciar agora' }}
          </v-btn>
        </template>

        <template v-else-if="updaterStore.state === 'error'">
          <v-btn variant="text" @click="isOpen = false">Fechar</v-btn>
          <v-spacer></v-spacer>
          <v-btn color="primary" variant="flat" @click="updaterStore.check">
            Tentar novamente
          </v-btn>
        </template>
      </v-card-actions>

    </v-card>
  </v-dialog>
</template>

<style scoped>
/* Estiliza o HTML gerado pelo marked dentro do modal */
.changelog-body :deep(h4) {
  font-size: 0.85rem;
  font-weight: 700;
  margin-top: 12px;
  margin-bottom: 4px;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.changelog-body :deep(h3) {
  font-size: 0.9rem;
  font-weight: 700;
  margin-top: 14px;
  margin-bottom: 6px;
  color: rgb(var(--v-theme-success));
}

.changelog-body :deep(ul) {
  padding-left: 18px;
  margin: 4px 0 8px;
}

.changelog-body :deep(li) {
  margin-bottom: 3px;
  line-height: 1.5;
}

.changelog-body :deep(blockquote) {
  border-left: 3px solid rgb(var(--v-theme-success));
  padding-left: 10px;
  margin: 0 0 10px;
  opacity: 0.75;
  font-style: italic;
}

.changelog-body :deep(p) {
  margin-bottom: 6px;
}

.changelog-body :deep(code) {
  background: rgba(var(--v-theme-on-surface), 0.08);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.85em;
}
</style>