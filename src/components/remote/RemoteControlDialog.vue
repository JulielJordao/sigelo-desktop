<script setup lang="ts">
// Janela "Controle remoto": liga o servidor na rede local e mostra o QR code
// / código para parear o celular (ver stores/remoteControlStore.ts).
import { computed, ref } from 'vue';
import { ask } from '@tauri-apps/plugin-dialog';
import { useRemoteControlStore } from '../../stores/remoteControlStore';

const model = defineModel<boolean>({ default: false });
const remote = useRemoteControlStore();
const copied = ref(false);

const enabled = computed({
  get: () => remote.isRunning,
  set: async (value: boolean) => {
    if (value) await remote.start();
    else await remote.stop();
  },
});

const pinFormatted = computed(() => {
  const pin = remote.info?.pin || '';
  return pin.length === 6 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin;
});

const copyUrl = async () => {
  if (!remote.info?.url) return;
  try {
    await navigator.clipboard.writeText(remote.info.url);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch { /* ignora */ }
};

const regenerate = async () => {
  const ok = await ask(
    'Os celulares pareados serão desconectados e precisarão escanear o novo QR code. Continuar?',
    { title: 'Sigelo', kind: 'warning', okLabel: 'Gerar novo código', cancelLabel: 'Cancelar' }
  );
  if (ok) await remote.regeneratePairing();
};
</script>

<template>
  <v-dialog v-model="model" max-width="460" transition="dialog-bottom-transition">
    <v-card rounded="xl">
      <v-card-title class="d-flex align-center justify-space-between pa-4">
        <div class="d-flex align-center">
          <v-icon color="primary" class="mr-2">mdi-cellphone-link</v-icon>
          <span class="text-h6 font-weight-bold">Controle remoto</span>
        </div>
        <v-btn icon="mdi-close" variant="text" density="comfortable" @click="model = false"></v-btn>
      </v-card-title>
      <v-divider></v-divider>

      <v-card-text class="pa-5">
        <p class="text-body-2 text-medium-emphasis mb-4">
          Controle slides, versículos, vídeos, músicas e programações pelo celular.
          O celular precisa estar <strong>no mesmo Wi-Fi</strong> deste computador.
        </p>

        <v-switch v-model="enabled" :loading="remote.isStarting" color="primary" inset hide-details
          :label="remote.isRunning ? 'Ligado' : 'Desligado'" class="mb-2"></v-switch>

        <v-alert v-if="remote.error" type="error" variant="tonal" density="compact" class="mb-3">
          {{ remote.error }}
        </v-alert>

        <template v-if="remote.isRunning && remote.info">
          <div class="d-flex flex-column align-center my-3">
            <!-- SVG gerado no Rust a partir do endereço de pareamento -->
            <div class="qr-box" v-html="remote.info.qrSvg"></div>
            <div class="text-caption text-medium-emphasis mt-2">
              Aponte a câmera do celular para o QR code
            </div>
          </div>

          <v-divider class="my-4"></v-divider>

          <div class="text-caption text-medium-emphasis mb-1">Ou abra no navegador do celular:</div>
          <div class="d-flex align-center mb-3">
            <code class="url flex-grow-1">{{ remote.info.url }}</code>
            <v-btn :icon="copied ? 'mdi-check' : 'mdi-content-copy'" variant="text" size="small"
              @click="copyUrl"></v-btn>
          </div>

          <div class="text-caption text-medium-emphasis mb-1">e digite o código:</div>
          <div class="pin mb-4">{{ pinFormatted }}</div>

          <div class="d-flex align-center justify-space-between">
            <v-chip :color="remote.connectedClients > 0 ? 'success' : 'grey'" variant="tonal" size="small"
              prepend-icon="mdi-cellphone">
              {{ remote.connectedClients }}
              {{ remote.connectedClients === 1 ? 'celular conectado' : 'celulares conectados' }}
            </v-chip>
            <v-btn variant="text" size="small" prepend-icon="mdi-refresh" @click="regenerate">
              Novo código
            </v-btn>
          </div>
        </template>

        <p v-else class="text-caption text-medium-emphasis mt-2">
          Se o Windows perguntar sobre o firewall, permita o acesso em redes privadas.
        </p>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.qr-box {
  width: 220px;
  height: 220px;
  padding: 8px;
  background: #fff;
  border-radius: 12px;
}
.qr-box :deep(svg) {
  width: 100%;
  height: 100%;
}
.url {
  font-size: 0.95rem;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.12);
  word-break: break-all;
}
.pin {
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  font-variant-numeric: tabular-nums;
}
</style>
