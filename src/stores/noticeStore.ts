import { defineStore } from 'pinia';
import { ref, watch, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core'; // Ajuste conforme sua versão do Tauri

export const useNoticeStore = defineStore('notice', () => {
  // ==========================================
  // 1. ESTADO PERSISTENTE (Salvo no JSON)
  // ==========================================
  const text = ref('');
  const durationSecs = ref(30);
  const frequencyMins = ref(0);
  
  const format = ref({
    color: '#FFFFFF',
    bgColor: '#D32F2F',
    position: 'bottom',
    style: 'solid',
    animation: 'marquee'
  });

  // ==========================================
  // 2. ESTADO DE EXECUÇÃO (Não vai pro JSON)
  // ==========================================
  const isActive = ref(false);
  const isPaused = ref(false);
  const timeRemaining = ref(0);
  let timerInterval: ReturnType<typeof setInterval> | null = null;

  // ==========================================
  // 3. GERENCIADOR DE PERSISTÊNCIA
  // ==========================================
  const enableAutoSave = ref(true); // Pode ser alterado dinamicamente
  let isInitialized = false;

  // Carrega as configurações salvas no JSON ao abrir o app
  const loadSettings = async () => {
    try {
      const savedData = await invoke<string>('load_notice_settings');
      if (savedData) {
        const parsed = JSON.parse(savedData);
        if (parsed.text) text.value = parsed.text;
        if (parsed.durationSecs) durationSecs.value = parsed.durationSecs;
        if (parsed.frequencyMins !== undefined) frequencyMins.value = parsed.frequencyMins;
        if (parsed.format) format.value = { ...format.value, ...parsed.format };
      }
    } catch (e) {
      console.warn("Nenhum aviso salvo encontrado ou erro ao carregar.");
    } finally {
      isInitialized = true; // Libera o Auto-Save apenas APÓS o primeiro carregamento
    }
  };

  // Observa qualquer mudança nas variáveis persistentes e salva automaticamente
  watch([text, durationSecs, frequencyMins, format], async () => {
    if (!enableAutoSave.value || !isInitialized) return;

    const payload = JSON.stringify({
      text: text.value,
      durationSecs: durationSecs.value,
      frequencyMins: frequencyMins.value,
      format: format.value
    });

    try {
      // O seu backend Rust recebe o JSON, salva no disco e emite um evento para 
      // a janela de projeção saber que as configurações mudaram.
      await invoke('save_notice_settings', { payload });
    } catch (e) {
      console.error("Erro ao salvar configurações do aviso:", e);
    }
  }, { deep: true }); // deep: true é essencial para vigiar os campos dentro do objeto 'format'

  // ==========================================
  // 4. CONTROLES DE REPRODUÇÃO
  // ==========================================
  const formattedTime = computed(() => {
    const m = Math.floor(timeRemaining.value / 60).toString().padStart(2, '0');
    const s = (timeRemaining.value % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  });

  // Função auxiliar para avisar a tela de projeção sobre Play/Pause/Stop
  const syncPlaybackState = async (action: 'play' | 'pause' | 'stop') => {
    try {
      await invoke('sync_notice_playback', { action, isActive: isActive.value, isPaused: isPaused.value });
    } catch (e) {
      console.error("Erro ao sincronizar aviso com a projeção");
    }
  };

  const startNotice = () => {
    if (!text.value) return;
    isActive.value = true;
    isPaused.value = false;
    timeRemaining.value = durationSecs.value;
    
    syncPlaybackState('play'); // Avisa o Rust para acionar a Projeção

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (!isPaused.value) {
        timeRemaining.value--;
        if (timeRemaining.value <= 0) stopNotice();
      }
    }, 1000);
  };

  const togglePause = () => {
    isPaused.value = !isPaused.value;
    syncPlaybackState('pause'); // Sincroniza a pausa
  };

  const stopNotice = () => {
    isActive.value = false;
    isPaused.value = false;
    timeRemaining.value = 0;
    if (timerInterval) clearInterval(timerInterval);
    syncPlaybackState('stop'); // Avisa o Rust para esconder da tela
  };

  // Inicia o carregamento assim que o store for instanciado
  loadSettings();

  return {
    text, durationSecs, frequencyMins, format, enableAutoSave,
    isActive, isPaused, timeRemaining, formattedTime,
    startNotice, togglePause, stopNotice
  };
});