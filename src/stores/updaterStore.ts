import { defineStore } from 'pinia';
import { ref, computed, shallowRef } from 'vue';
import {
  checkForUpdate,
  downloadAndInstall,
  type AnyUpdate,
} from '../services/updater';

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'ready'
  | 'up-to-date'
  | 'error';

export const useUpdaterStore = defineStore('updater', () => {
  const update = shallowRef<AnyUpdate | null>(null);
  const state = ref<UpdateState>('idle');
  const progress = ref(0);
  const downloadedBytes = ref(0);
  const totalBytes = ref(0);
  const error = ref<string | null>(null);
  const dismissed = ref(false);

  const hasUpdate = computed(
    () => update.value !== null && !dismissed.value && state.value !== 'up-to-date'
  );

  const isBusy = computed(() =>
    ['checking', 'downloading', 'installing'].includes(state.value)
  );

  async function check() {
    if (isBusy.value) return;

    state.value = 'checking';
    error.value = null;

    try {
      const result = await checkForUpdate();
      if (result) {
        update.value = result;
        state.value = 'available';
      } else {
        update.value = null;
        state.value = 'up-to-date';
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      state.value = 'error';
    }
  }

  async function install() {
    if (!update.value) return;

    state.value = 'downloading';
    progress.value = 0;
    error.value = null;

    try {
      await downloadAndInstall(update.value, (downloaded, total) => {
        downloadedBytes.value = downloaded;
        totalBytes.value = total;
        progress.value = total ? (downloaded / total) * 100 : 0;
      });

      state.value = 'ready';
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      state.value = 'error';
    }
  }

  function dismiss() {
    dismissed.value = true;
  }

  function reset() {
    update.value = null;
    state.value = 'idle';
    progress.value = 0;
    downloadedBytes.value = 0;
    totalBytes.value = 0;
    error.value = null;
    dismissed.value = false;
  }

  return {
    update,
    state,
    progress,
    downloadedBytes,
    totalBytes,
    error,
    dismissed,
    hasUpdate,
    isBusy,
    check,
    install,
    dismiss,
    reset,
  };
});