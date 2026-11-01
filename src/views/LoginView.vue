<script setup lang="ts">
import iconTheme from '../assets/icon_theme.svg'
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ask, message } from "@tauri-apps/plugin-dialog"
import { openUrl } from "@tauri-apps/plugin-opener"
import { invoke } from "@tauri-apps/api/core"
import routes from "../routes/index"
import { useUserStore } from "../stores/userStore";
import { useMenuStore } from '../stores/menuStore';

const router = useRouter();
const userRoute = routes.user();
const userStore = useUserStore();
const menuStore = useMenuStore();

// URL de cadastro/login no site (abre no navegador do sistema)
const REGISTER_URL = "https://sigelo.cloud/login?mode=register";

// Estados da Interface
const isChecking = ref(true); // Começa como true para não piscar o login
const email = ref("");
const password = ref("");
const showPassword = ref(false);
const errLogin = ref("");
const isGoogleLoading = ref(false);

// Funções de Navegação
const redirect = () => {
  const jaViOnboarding = localStorage.getItem("hideOnboarding") === "true";
  if (!jaViOnboarding) {
    menuStore.toggleMenu('Onboarding')
    router.push("/onboarding");
  } else {
    router.push("/app/musicas");
  }
}

// Otimização: Função invocada IMEDIATAMENTE no setup (mais rápido que onMounted)
const checkAuthStatus = async () => {
  try {
    await userStore.init();

    // Acesso sem conta escolhido antes: entra direto.
    if (userStore.isGuest) {
      redirect();
      return;
    }

    const token = localStorage.getItem("userToken")
    const isValid = userStore.userId && userStore.userId !== "" && !!token

    if (isValid) {
      redirect();
    } else {
      await userStore.logout()
      isChecking.value = false;
    }
  } catch (error) {
    console.log(error)
    await userStore.logout()
    isChecking.value = false;
  }
};

checkAuthStatus(); // Inicia a verificação milissegundos antes do DOM renderizar

// Ações do Usuário
const login = async () => {
  errLogin.value = "";
  const response = await userRoute.login(email.value, password.value)

  if (response.success) {
    userStore.exitGuestMode()
    await userStore.syncUserWithApi()

    redirect()
  } else {
    errLogin.value = response.msg
  }
};

// Login com Google: abre o navegador principal, o usuário entra lá e o app
// recebe o token de volta pelo loopback (comando Rust `google_login`).
// Usa o mesmo backend do resto do app (routes.defaultUrl).
const loginWithGoogle = async () => {
  if (isGoogleLoading.value) return;
  errLogin.value = "";
  isGoogleLoading.value = true;
  try {
    const token = await invoke<string>("google_login", { backendBase: routes.defaultUrl });
    localStorage.setItem("userToken", token);
    userStore.exitGuestMode();
    await userStore.syncUserWithApi();
    redirect();
  } catch (error: any) {
    errLogin.value = typeof error === "string" ? error : "Falha no login com Google.";
  } finally {
    isGoogleLoading.value = false;
  }
};

// Abre a página de cadastro/login do site no navegador padrão do sistema.
const openRegister = async () => {
  try {
    await openUrl(REGISTER_URL);
  } catch (error) {
    console.error(error);
    await message(
      `Não foi possível abrir o navegador. Acesse manualmente:\n${REGISTER_URL}`,
      { title: 'Criar conta', kind: 'warning' }
    );
  }
}

// Acesso sem conta: projeção, músicas locais, Bíblia, mídias e PDF funcionam.
// O que depende da conta (músicas da nuvem, eventos, YouTube) fica de fora.
const goWithoutAccount = async () => {
  const confirmed = await ask(
    'Sem conta você pode projetar músicas locais, Bíblia, mídias, PDF e montar programações.\n\n' +
    'Ficam indisponíveis: músicas e eventos da sua conta (nuvem), importar do YouTube e a galeria de fundos online.\n\n' +
    'Você pode entrar com uma conta a qualquer momento pelo menu lateral.',
    { title: 'Acesso sem conta', kind: 'info', okLabel: 'Continuar sem conta', cancelLabel: 'Voltar' }
  );
  if (!confirmed) return;
  await userStore.enterGuestMode();
  redirect();
}

onMounted(() => {})
</script>

<template>
  <v-container fluid class="fill-height bg-surface-variant d-flex align-center justify-center app-region"
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
            @click:append-inner="showPassword = !showPassword" variant="outlined" color="primary" @keyup.enter="login"
            base-color="grey-lighten-1" density="comfortable" class="rounded-lg" hide-details="auto"></v-text-field>

          <v-expand-transition>
            <v-alert v-if="errLogin && errLogin !== ''" type="error" variant="flat" color="error"
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
          <span class="mx-4 text-caption font-weight-medium text-uppercase tracking-widest text-no-wrap">
            ou continue com
          </span>
          <v-divider></v-divider>
        </div>

        <v-btn block variant="outlined" color="grey-darken-2" size="large" :loading="isGoogleLoading"
          @click="loginWithGoogle"
          class="text-none font-weight-medium rounded-lg no-drag border-opacity-50 hover-bg-light bg-surface-light mb-3">
          <svg class="mr-3" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
          </svg>
          Continuar com Google
          <template #loader>
            <v-progress-circular indeterminate size="18" width="2" class="mr-2" />
            Conclua o login no navegador…
          </template>
        </v-btn>

        <v-btn block variant="outlined" color="grey-darken-2" @click="goWithoutAccount" size="large"
          class="text-none font-weight-medium rounded-lg no-drag border-opacity-50 hover-bg-light bg-surface-light">
          <v-icon start icon="mdi-server-network" color="primary" class="mr-2"></v-icon>
          Acesso sem conta
        </v-btn>

        <!-- Opção de cadastro: abre sigelo.cloud/login no navegador do sistema -->
        <div class="text-center mt-6 no-drag">
          <span class="text-body-2 text-grey-darken-1">Ainda não tem uma conta?</span>
          <v-btn variant="text" color="primary" @click="openRegister"
            class="text-none font-weight-bold px-2 ml-1" append-icon="mdi-open-in-new">
            Criar conta
          </v-btn>
        </div>

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