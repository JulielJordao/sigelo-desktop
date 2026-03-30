import {defineStore} from 'pinia'
import {ref} from 'vue'
import routes from "../routes/index"
import { getLinkImageByName } from '../utils/convertData'

export const useUserStore = defineStore('user', () => {
    const userRoute = routes.user()
    const settingsRoute = routes.settings()
    const settings = ref()
    const isLoaded = ref(false)
    const onLoading = ref(false)
    const profileImage = ref("")
    const userId = ref("")
    const fullName = ref("")
    const groupUserId = ref("")
    const isAdmin = ref(false)
    const isLoading = ref(false)
    const permissions = ref({})
    
    const init = async () => {
        if(isLoaded.value || onLoading.value) return 
        onLoading.value = true
        await loadUserData()
    }

    const loadUserData = async () => {
        try {
            onLoading.value = true;
            const userToken = await routes.apiFetch("me");
            const responseJson = await userToken.json();
            const userResponse = await userRoute.getUserById(responseJson.id);

            userId.value = userResponse._id;
            profileImage.value = getLinkImageByName(userResponse.image);
            fullName.value = userResponse.fullName;
            groupUserId.value = userResponse.groupUserId;

            //await reloadPermissions();
            await loadSettings();

            console.log("loaded")
            
        } catch (error) {
            console.log(error)
            clearUser()
            console.error("Erro ao carregar os dados do usuário", error);
        } finally {
            isLoading.value = false; // Desativa o loading
        }
    }

    const clearUser = () => {
        userId.value = ''
        fullName.value = ''
        profileImage.value = ''
        groupUserId.value = ''
        permissions.value = {}
        isAdmin.value = false
        settings.value = {}
    }

    const logout = async() => {
        const response = await userRoute.logout();
        localStorage.removeItem("userToken");

        if(response.ok) {
            clearUser()
            isLoaded.value = false
            isLoading.value = false
            return true
        } else {
            return false
        }
    }


    const loadSettings = async () => {
        try {    
            const response = await settingsRoute.get();
            settings.value = response.response;
            isLoaded.value = true;
        
        } catch (error) {
        // handleError(error, nuxtApp);
        } finally {
        isLoading.value = false;
        isLoaded.value = true;
        }
      };



    return {
        settings,
        userId,
        init,
        logout
    }



})
