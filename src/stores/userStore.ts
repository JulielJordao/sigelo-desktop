import { defineStore } from 'pinia'
import { ref } from 'vue'
import routes from "../routes/index"
import { getLinkImageByName } from '../utils/convertData'
import type { Store } from '@tauri-apps/plugin-store';
import { load } from '@tauri-apps/plugin-store';
import { useConnectionStore } from './statusConnectionStore';
import { ask } from '@tauri-apps/plugin-dialog';
import router from '../router';
import { useMenuStore } from './menuStore';

/** Acesso sem conta: fica salvo para abrir direto no próximo início. */
const GUEST_KEY = 'sigelo.guestMode';

interface UserProfile {
    _id: string;
    image: string;
    fullName: string;
    groupUserId: string;
}

export const useUserStore = defineStore('user', () => {
    // Dependências
    const userRoute = routes.user()
    const connectionStore = useConnectionStore()
    const settingsRoute = routes.settings()

    // Estados
    const settings = ref({})
    const isLoaded = ref(false)
    const onLoading = ref(false)
    const isLoading = ref(false)
    
    // Perfil
    const profileImage = ref("")
    const userId = ref("")
    const fullName = ref("")
    const groupUserId = ref("")
    const isAdmin = ref(false)
    const permissions = ref({})

    // Acesso sem conta: músicas locais, Bíblia, mídias, PDF e programações
    // locais funcionam; o que depende da conta (nuvem, eventos, YouTube…) não.
    const isGuest = ref(localStorage.getItem(GUEST_KEY) === '1')

    let tauriStore: Store | null = null;

    const init = async () => {
        if (isLoaded.value || onLoading.value) return;
        onLoading.value = true;
        await loadUserData();
    }

    const loadUserData = async () => {
        try {
            // 1. Inicializa o banco de dados local
            tauriStore = await load('user.json', { autoSave: false, defaults: { user_profile: null } });
            
            // Sem conta: nada de perfil em cache nem sincronização com a API.
            if (isGuest.value) {
                isLoaded.value = true;
                return;
            }

            // 2. CARREGAMENTO OFFLINE-FIRST (Prioridade Máxima)
            const cachedUser = await tauriStore.get<UserProfile>('user_profile');
            
            if (cachedUser && cachedUser._id) {
                userId.value = cachedUser._id;
                profileImage.value = cachedUser.image;
                fullName.value = cachedUser.fullName;
                groupUserId.value = cachedUser.groupUserId;
            }

            // Libera a interface imediatamente! O usuário já pode usar o app.
            isLoaded.value = true; 

            // 3. Verifica a internet real com await (Impede o "hang" da rede falsa)
            const hasInternet = await connectionStore.validateConnection();
            
            // 4. SINCRONIZAÇÃO EM BACKGROUND
            if (hasInternet && userId.value) {
                await syncUserWithApi();
            }

            // 5. Carrega configurações
            await loadSettings();

        } catch (error) {
            console.error("Erro fatal ao inicializar store do usuário:", error);
            // IMPORTANTE: Não damos clearUser() aqui, senão qualquer erro de rede desloga o usuário.
        } finally {
            onLoading.value = false;
            isLoading.value = false;
        }
    }

    // Função separada para manter o código limpo
    const syncUserWithApi = async () => {
        try {
            const userToken = await routes.apiFetch("me");
            
            // Se o token for inválido (ex: 401 Unauthorized), desloga o usuário.
            if (!userToken.ok) throw new Error("Sessão expirada ou inválida");

            const responseJson = await userToken.json();
            const userResponse = await userRoute.getUserById(responseJson.id);

            // Atualiza a memória com dados frescos
            userId.value = userResponse._id;
            profileImage.value = getLinkImageByName(userResponse.image);
            fullName.value = userResponse.fullName;
            groupUserId.value = userResponse.groupUserId;
            
            // Atualiza o cache local silenciosamente
            await saveUser();
        } catch (error) {
            console.error("Falha ao sincronizar com API:", error);
            // Se foi erro de auth, limpamos. Se for erro de rede, mantemos o offline.
            if (error instanceof Error && error.message.includes("Sessão")) {
                await clearUser();
            }
        }
    }

    const saveUser = async () => {
        if (tauriStore && userId.value) {
            const profileData: UserProfile = {
                _id: userId.value, 
                image: profileImage.value, 
                fullName: fullName.value, 
                groupUserId: groupUserId.value
            };
            await tauriStore.set('user_profile', profileData);
            await tauriStore.save(); 
        }     
    }

    // Corrigido: Agora limpa o disco também!
    const clearUser = async () => {
        userId.value = ''
        fullName.value = ''
        profileImage.value = ''
        groupUserId.value = ''
        permissions.value = {}
        isAdmin.value = false
        settings.value = {}
        
        // Apaga o perfil salvo em disco (antes ficava gravado após o logout).
        if (tauriStore) {
            await tauriStore.set('user_profile', null);
            await tauriStore.save();
        }
    }

    /** Entra no acesso sem conta (botão "Acesso sem conta" do login). */
    const enterGuestMode = async () => {
        localStorage.removeItem("userToken");
        if (!tauriStore) {
            try { tauriStore = await load('user.json', { autoSave: false, defaults: { user_profile: null } }); } catch { /* ignora */ }
        }
        await clearUser();
        isGuest.value = true;
        localStorage.setItem(GUEST_KEY, '1');
        isLoaded.value = true;
    }

    /** Sai do acesso sem conta (ao entrar com uma conta). */
    const exitGuestMode = () => {
        if (!isGuest.value) return;
        isGuest.value = false;
        localStorage.removeItem(GUEST_KEY);
        isLoaded.value = false;
    }

    /** Volta para a tela de login (sai do acesso sem conta). */
    const goToLogin = async () => {
        exitGuestMode();
        useMenuStore().toggleMenu('Login');
        await router.push('/');
    }

    /**
     * Bloqueia funções que precisam de conta. Devolve true se pode seguir.
     * No acesso sem conta, avisa e oferece entrar com uma conta.
     */
    const requireAccount = async (feature: string): Promise<boolean> => {
        if (!isGuest.value) return true;
        const goLogin = await ask(
            `${feature} precisa de uma conta Sigelo.\n\n` +
            'No acesso sem conta você pode usar músicas locais, Bíblia, mídias, PDF e programações.',
            { title: 'Disponível com conta', kind: 'info', okLabel: 'Entrar com conta', cancelLabel: 'Agora não' }
        );
        if (goLogin) await goToLogin();
        return false;
    }

    const logout = async () => {
        try {
            // Tenta avisar a API (não importa se der erro de rede)
            await userRoute.logout();
        } catch(e) {
            console.warn("Logout na API falhou, forçando logout local.");
        }
        
        localStorage.removeItem("userToken");
        await clearUser();
        
        isLoaded.value = false;
        return true;
    }

    const loadSettings = async () => {
        if (isGuest.value) return;
        try {
            const response = await settingsRoute.get();
            settings.value = response.response;
        } catch (error) {
            console.warn("Carregamento de configurações falhou (offline?).");
        }
    };

    return {
        settings,
        userId,
        isLoaded,     // Exponha o isLoaded para a tela de Splash
        profileImage, // Sempre bom expor o que vai ser usado na UI
        fullName,
        isGuest,
        syncUserWithApi,
        init,
        logout,
        enterGuestMode,
        exitGuestMode,
        goToLogin,
        requireAccount
    }
})