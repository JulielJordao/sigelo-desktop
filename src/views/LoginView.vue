<script setup lang="ts">
import iconTheme from '../assets/icon_theme.svg'
import { ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@tauri-apps/plugin-dialog"
import routes from "../routes/index"
import { useUserStore } from "../stores/userStore";

const router = useRouter();
const userRoute = routes.user();
const userStore = useUserStore();

// Estados da Interface
const isChecking = ref(true); // Começa como true para não piscar o login
const email = ref("");
const password = ref("");
const showPassword = ref(false);
const errLogin = ref("");

// Funções de Navegação
const redirect = () => {
  const jaViOnboarding = localStorage.getItem("hideOnboarding") === "true";
  if (!jaViOnboarding) {
    router.push("/onboarding");
  } else {
    router.push("/musicas");
  }
}

// Otimização: Função invocada IMEDIATAMENTE no setup (mais rápido que onMounted)
const checkAuthStatus = async () => {
  try {
    await userStore.init();
    
    if (userStore.userId && userStore.userId !== "") {
      redirect();
      // Não mudamos o isChecking para false aqui, pois a tela já vai mudar
    } else {
      // Apenas se não tiver usuário, revelamos o form de login
      isChecking.value = false;
    }
  } catch (error) {
    console.error("Erro ao checar auth:", error);
    isChecking.value = false; // Em caso de erro, libera a tela de login
  }
};

checkAuthStatus(); // Inicia a verificação milissegundos antes do DOM renderizar

// Ações do Usuário
const login = async () => {
  errLogin.value = "";
  const response = await userRoute.login(email.value, password.value)

  if (response.success) {
    userStore.syncUserWithApi()
    
    redirect()
  } else {
    errLogin.value = response.msg
  }
};

const goWithoutAccount = async () => {
  await message('Não implementado! Acesse as funções via login!', { title: 'Aviso', kind: 'warning' });
}
</script>

<template>
  <v-container fluid class="fill-height desktop-bg d-flex align-center justify-center app-region"
    data-tauri-drag-region>

    <v-fade-transition hide-on-leave>
      <div v-if="isChecking" class="d-flex flex-column align-center justify-center text-center no-drag" key="loading">
        <v-avatar color="transparent" size="90" class="mb-6 pulse-animation">
          <v-img :src="iconTheme"></v-img>
        </v-avatar>
        <v-progress-circular indeterminate color="primary" size="32" width="3" class="mb-4"></v-progress-circular>
        <span class="text-caption text-grey-darken-1 font-weight-medium text-uppercase tracking-widest">
          Iniciando Sigelo...
        </span>
      </div>

      <v-card v-else key="login" width="100%" max-width="420" class="pa-8 pa-sm-10 rounded-xl desktop-card border"
        style="box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.08) !important;">

        <div class="text-center mb-8" data-tauri-drag-region>
          <v-avatar color="grey-lighten-4" size="80" class="mb-4 border"
            style="border-color: rgba(0,0,0,0.05) !important;">
            <v-img :src="iconTheme" class="pa-2"></v-img>
          </v-avatar>

          <h2 class="text-h5 font-weight-bold text-primary tracking-tight mb-1">
            Bem-vindo ao Sigelo
          </h2>
          <p class="text-body-2 text-grey-darken-1 font-weight-regular">
            Faça login no sistema de projeção
          </p>
        </div>

        <v-form @submit.prevent="login" class="no-drag">

          <v-text-field v-model="email" label="E-mail" placeholder="seu@email.com" prepend-inner-icon="mdi-email-outline"
            variant="outlined" color="primary" base-color="grey-lighten-1" density="comfortable" class="mb-4 rounded-lg"
            hide-details="auto"></v-text-field>

          <v-text-field v-model="password" label="Senha" placeholder="••••••••" prepend-inner-icon="mdi-lock-outline"
            :type="showPassword ? 'text' : 'password'" :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
            @click:append-inner="showPassword = !showPassword" variant="outlined" color="primary"
            base-color="grey-lighten-1" density="comfortable" class="rounded-lg" hide-details="auto"></v-text-field>

          <v-expand-transition>
            <v-alert v-if="errLogin" type="error" variant="flat" color="error"
              class="mt-5 text-body-2 rounded-lg bg-red-lighten-5 text-red-darken-3" icon="mdi-alert-circle">
              {{ errLogin }}
            </v-alert>
          </v-expand-transition>

          <v-btn type="submit" block color="primary" size="x-large" class="font-weight-bold text-none mt-8 rounded-lg"
            flat style="box-shadow: 0 4px 12px rgba(var(--v-theme-primary), 0.3) !important;">
            Entrar
          </v-btn>
        </v-form>

        <div class="d-flex align-center my-8 no-drag opacity-70">
          <v-divider></v-divider>
          <span class="mx-4 text-caption text-grey-darken-1 font-weight-medium text-uppercase tracking-widest text-no-wrap">
            ou continue com
          </span>
          <v-divider></v-divider> 
        </div>

        <v-btn block variant="outlined" color="grey-darken-2" @click="goWithoutAccount" size="large"
          class="text-none font-weight-medium rounded-lg no-drag border-opacity-50 hover-bg-light">
          <v-icon start icon="mdi-server-network" color="grey-darken-1" class="mr-2"></v-icon>
           Acesso sem conta
        </v-btn>

      </v-card>
    </v-fade-transition>
  </v-container>
</template>

<style scoped>
/* Impede a seleção de texto acidental */
.app-region {
  user-select: none;
  -webkit-user-select: none;
}

/* Fundo com gradiente sutil */
.desktop-bg {
  background: linear-gradient(135deg, #ece9e6 0%, #ffffff 100%);
}

/* Ajuste fino na borda do card */
.desktop-card {
  border: 1px solid rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(10px);
}

/* Impede que o Tauri arraste no form */
.no-drag {
  -webkit-app-region: no-drag;
}

.hover-bg-light:hover {
  background-color: #f5f5f5;
  transition: background-color 0.2s ease;
}

.tracking-widest {
  letter-spacing: 0.1em !important;
}

/* Animação suave para a logo carregando */
@keyframes pulse-soft {
  0% { transform: scale(0.98); opacity: 0.8; }
  50% { transform: scale(1.02); opacity: 1; }
  100% { transform: scale(0.98); opacity: 0.8; }
}

.pulse-animation {
  animation: pulse-soft 2s infinite ease-in-out;
}
</style>