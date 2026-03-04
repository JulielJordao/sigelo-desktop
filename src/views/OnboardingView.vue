<template>
  <v-container class="fill-height d-flex flex-column align-center justify-center">
    <h1>Bem-vindo ao Sigelo</h1>
    <p>Aqui estão as instruções de uso...</p>
    <v-checkbox v-model="dontShowAgain" label="Não mostrar novamente"></v-checkbox>
    <v-btn color="primary" @click="finishOnboarding">Começar a usar</v-btn>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const dontShowAgain = ref(false);

const finishOnboarding = () => {
  if (dontShowAgain.value) {
    localStorage.setItem('hideOnboarding', 'true');
  }
  router.push('/app/musicas');
};
</script>