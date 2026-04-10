<script setup lang="ts">
import iconTheme from '../assets/icon_theme.svg'
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@tauri-apps/plugin-dialog"
import routes from "../routes/index"

import { useUserStore } from "../stores/userStore";

const router = useRouter();
const userRoute = routes.user();
const email = ref("");
const password = ref("");
const showPassword = ref(false);
const errLogin = ref("");

const userStore = useUserStore()

const login = async () => {
  errLogin.value = "";

  const response = await userRoute.login(email.value, password.value)

  if (response.success) {
    redirect()
  } else {
    errLogin.value = response.msg
  }
};

const redirect = () => {
  const jaViOnboarding = localStorage.getItem("hideOnboarding") === "true";

  if (!jaViOnboarding) {
    router.push("/onboarding");
  } else {
    router.push("/musicas");
  }
}

onMounted(async () => {
  await userStore.init()
  if (userStore.userId) {
    redirect()
  }
}
)

const goWithoutAccount = async () => {
  await message('Não implementado! Acesse as funções via login!', { title: 'Aviso', kind: 'warning' });
}

</script>

<template>
  <v-container fluid class="fill-height desktop-bg d-flex align-center justify-center app-region"
    data-tauri-drag-region>

    <v-card width="100%" max-width="420" class="pa-8 pa-sm-10 rounded-xl desktop-card border"
      style="box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.08) !important;">

      <div class="text-center mb-8" data-tauri-drag-region>
        <v-avatar color="grey-lighten-4" size="80" class="mb-4 border"
          style="border-color: rgba(0,0,0,0.05) !important;">
          <v-img :src="iconTheme" class="pa-2"></v-img>
        </v-avatar>

        <h2 class="text-h5 font-weight-bold text-grey-darken-4 tracking-tight mb-1">
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

      <div class="d-flex align-center my-0 no-drag opacity-70">
        <v-divider></v-divider>
        <div class="d-flex align-center my-8 no-drag opacity-70">
          <v-divider></v-divider>
          <span class="mx-4 text-caption text-grey-darken-1 font-weight-medium text-uppercase tracking-widest text-no-wrap">
            ou continue com
          </span>
          <v-divider></v-divider> 
        </div>
        <v-divider></v-divider>
      </div>

      <v-btn block variant="outlined" color="grey-darken-2" @click="goWithoutAccount" size="large"
        class="text-none font-weight-medium rounded-lg no-drag border-opacity-50 hover-bg-light">
        <v-icon start icon="mdi-server-network" color="grey-darken-1" class="mr-2"></v-icon>
         Acesso sem conta
      </v-btn>

    </v-card>
  </v-container>
</template>

<style scoped>
/* Impede a seleção de texto acidental (comportamento nativo) */
.app-region {
  user-select: none;
  -webkit-user-select: none;
}

/* Fundo com gradiente sutil bem comum em telas de login de macOS */
.desktop-bg {
  background: linear-gradient(135deg, #ece9e6 0%, #ffffff 100%);
}

/* Ajuste fino na borda do card para dar um ar de "janela" */
.desktop-card {
  border: 1px solid rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(10px);
}

/* Impede que o Tauri tente arrastar a janela se o usuário clicar dentro do formulário */
.no-drag {
  -webkit-app-region: no-drag;
}

.hover-bg-light:hover {
  background-color: #f5f5f5;
  transition: background-color 0.2s ease;
}

/* Espaçamento extra entre as letras para o 'OU' */
.tracking-widest {
  letter-spacing: 0.1em !important;
}
</style>