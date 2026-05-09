<template>
  <v-container fluid class="fill-height bg-background pa-0">
    <v-row density="compact" align="center" justify="center" class="fill-height">
      <v-col cols="12" sm="10" md="10" lg="10" xl="10">
        
        <v-card class="mx-auto pa-4 pa-md-8 rounded-xl elevation-12" border>

          <v-card-text>
            <TutorialView :noIcon="false"/>
          </v-card-text>

          <v-divider class="my-4"></v-divider>

          <v-card-actions class="flex-column flex-md-row justify-space-between px-4">
            <v-checkbox
              v-model="dontShowAgain"
              label="Não mostrar este guia ao iniciar"
              color="primary"
              hide-details
              density="comfortable"
              class="mb-4 mb-md-0"
            ></v-checkbox>

            <v-btn
              color="primary"
              variant="flat"
              size="x-large"
              rounded="pill"
              min-width="200"
              @click="finishOnboarding"
              append-icon="mdi-chevron-right-circle"
              class="font-weight-bold elevation-4"
            >
              Começar agora
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import TutorialView from '../components/TutorialView.vue';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const dontShowAgain = ref(false);

const finishOnboarding = () => {
  if (dontShowAgain.value) {
    localStorage.setItem('hideOnboarding', 'true');
  }
  // Rota de destino
  router.push('/app/musicas');
};
</script>

<style>
/* Estilo Global para arredondar os botões do carrossel (opcional) */
.v-carousel__controls__item.v-btn {
  color: rgb(var(--v-theme-primary)) !important;
}
</style>