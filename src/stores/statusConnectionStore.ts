import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useConnectionStore = defineStore('connection', () => {
    // ESTADO
    const isNetworkConnected = ref(navigator.onLine); 
    const hasInternet = ref(false); 
    const lastCheck = ref<Date | null>(null);
    let pingInterval: ReturnType<typeof setInterval> | null = null; // Variável do Heartbeat

    // NOVA AÇÃO: Para ser chamada pelo safeFetch e garantir reatividade
    const forceOffline = () => {
        // Derruba as duas variáveis para a toolbar ir para o estado de erro (vermelho) instantaneamente
        hasInternet.value = false;
        isNetworkConnected.value = false; 
        console.warn("Status alterado para OFFLINE pelo interceptador de rede.");
    };

    // AÇÃO: O Ping Real
    const validateConnection = async (): Promise<boolean> => {
        isNetworkConnected.value = navigator.onLine;

        if (!isNetworkConnected.value) {
            hasInternet.value = false;
            return false;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            await fetch('https://1.1.1.1', { 
                mode: 'no-cors', 
                cache: 'no-store',
                signal: controller.signal 
            });
            
            clearTimeout(timeoutId);
            
            hasInternet.value = true;
            lastCheck.value = new Date();
            return true;

        } catch (error) {
            hasInternet.value = false;
            lastCheck.value = new Date();
            return false;
        }
    };

    // LISTENERS DO SISTEMA
    const handleOffline = () => {
        isNetworkConnected.value = false;
        hasInternet.value = false; 
    };

    const handleOnline = async () => {
        isNetworkConnected.value = true;
        await validateConnection(); 
    };

    // INICIALIZAÇÃO COM HEARTBEAT
    const startMonitoring = () => {
        window.addEventListener('offline', handleOffline);
        window.addEventListener('online', handleOnline);
        validateConnection();

        // HEARTBEAT: Checa a internet real a cada 15 segundos (15000 ms)
        // Isso garante que a toolbar atualize sozinha, mesmo se o usuário não clicar em nada
        if (!pingInterval) {
            pingInterval = setInterval(() => {
                if (isNetworkConnected.value) {
                    validateConnection();
                }
            }, 15000);
        }
    };

    const stopMonitoring = () => {
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('online', handleOnline);
        
        // Limpa o heartbeat quando fechar o app
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
    };

    return { 
        isNetworkConnected, 
        hasInternet, 
        lastCheck,
        validateConnection, 
        forceOffline, // <-- Nova ação exposta
        startMonitoring, 
        stopMonitoring 
    };
});