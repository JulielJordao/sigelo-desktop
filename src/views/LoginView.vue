<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import routes from "../routes/index"

import  { useUserStore } from "../stores/userStore";

const router = useRouter();
const userRoute = routes.user();
const email = ref("");
const password = ref("");
const showPassword = ref(false);
const errLogin = ref("");

const userStore = useUserStore()
 
const login = async () => {
  errLogin.value = "";
  
  const response =  await userRoute.login(email.value, password.value)

  if(response.success) {
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

onMounted(async() => {
  await userStore.init()
  if(userStore.userId) {
      redirect()
    }
  }
)
</script>

<template>
  <v-container 
    fluid 
    class="fill-height desktop-bg d-flex align-center justify-center app-region"
    data-tauri-drag-region
  >
    
    <v-card 
      width="100%" 
      max-width="400" 
      elevation="24" 
      class="pa-8 rounded-xl bg-white desktop-card"
    >
      
      <div class="text-center mb-8" data-tauri-drag-region>
        <v-avatar color="primary" size="72" class="mb-5 elevation-3">
           <v-icon icon="mdi-music-clef-treble" color="white" size="36"></v-icon>
        </v-avatar>
        <h2 class="text-h4 font-weight-black text-grey-darken-4 tracking-tight">Sigelo</h2>
        <p class="text-body-2 text-grey-darken-1 mt-1 font-weight-medium">Sistema de Projeção</p>
      </div>

      <v-form @submit.prevent="login" class="no-drag">
        <v-text-field
          v-model="email"
          label="E-mail"
          prepend-inner-icon="mdi-email-outline"
          variant="outlined"
          color="primary"
          density="comfortable"
          class="mb-3"
          hide-details="auto"
        ></v-text-field>

        <v-text-field
          v-model="password"
          label="Senha"
          prepend-inner-icon="mdi-lock-outline"
          :type="showPassword ? 'text' : 'password'"
          :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
          @click:append-inner="showPassword = !showPassword"
          variant="outlined"
          color="primary"
          density="comfortable"
          hide-details="auto"
        ></v-text-field>

        <v-expand-transition>
          <v-alert 
            v-if="errLogin" 
            type="error" 
            variant="tonal" 
            density="compact" 
            class="mt-4 text-caption"
            icon="mdi-alert-circle-outline"
          >
            {{ errLogin }}
          </v-alert>
        </v-expand-transition>

        <v-btn
          type="submit"
          block
          color="primary"
          size="x-large"
          class="font-weight-bold text-none mt-6 rounded-lg"
          elevation="4"
        >
          Entrar
        </v-btn>
      </v-form>

      <div class="d-flex align-center my-6 no-drag">
        <v-divider></v-divider>
        <span class="mx-4 text-caption text-grey-lighten-1 font-weight-bold">OU</span>
        <v-divider></v-divider> 
      </div>

      <v-btn 
        block 
        variant="tonal" 
        color="grey-darken-3" 
        size="large"
        class="text-none font-weight-medium rounded-lg no-drag"
      >
        Configurar Servidor Local
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
</style>