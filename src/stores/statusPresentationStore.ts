import { emit } from '@tauri-apps/api/event';
import { defineStore } from 'pinia';
import type { MediaFile } from './mediaStore';

import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';

export type TypeApresentation = 'Media' | 'Slides' | 'Pdf' | 'none' | 'Timer' | 'Biblia';

interface StatusPresentation {
  isRunning: Boolean,
  hasFixedMedia: Boolean,
  isPresentation: TypeApresentation
}

export const useStatusPresentationStore = defineStore('statusPresentation', () => {

  const status = ref<StatusPresentation>({ isRunning: false, hasFixedMedia: false, isPresentation: "none" })
  const projectedFile = ref<MediaFile | null>(null)
  const currentTime = ref<number>(0)
  const updateTime = ref<boolean>(false)

  const isWindowHidden = ref(false)

  const toggleProjectionWindow = async () => {
    if (status.value.isPresentation === 'none') return
    try {
      const visible = await invoke<boolean>('toggle_projection_visibility')
      isWindowHidden.value = !visible
    } catch (err) {
      console.error('Erro ao alternar a janela de projeção:', err)
    }
  }

  const setNewPresentation = async (type: TypeApresentation, selectedMonitor: string) => {
    if(status.value.isPresentation == 'none') {
      try {
        await invoke('prepare_projection_window', { targetMonitor: selectedMonitor })
      } catch (err) {
        console.log(err)
        return
      }
    }
    status.value.isPresentation = type;
    status.value.isRunning = true
  }

  const isProjectingMediaFile = computed(() => {
     return status.value.isPresentation === 'Media' && projectedFile.value?.id
  })

  const clean = async () => {

    try {
        await emit('clear-projection');
        status.value.isRunning = false
        status.value.isPresentation = 'none';
        projectedFile.value = null
        currentTime.value = 0
    } catch (error) {
        console.error("Erro ao parar a projeção:", error);
    }
  }

  const setProjectedMedia = (fileMedia :  MediaFile) => {
    projectedFile.value = fileMedia
  }

  return {
    status,
    currentTime,
    updateTime,
    setNewPresentation,
    setProjectedMedia,
    toggleProjectionWindow,
    isProjectingMediaFile,
    projectedFile,
    clean
  }
});