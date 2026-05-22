<template>
  <v-container fluid class="fill-height bg-background pa-2 pa-md-4">
    <v-row density="comfortable" align="center" justify="center" class="fill-height ma-0" no-gutters>
      <v-col cols="12" sm="11" md="10" lg="9" xl="8" class="d-flex justify-center">
        <v-card class="mx-auto pa-2 pa-md-6 rounded-xl elevation-12 d-flex flex-column onboarding-card" border>
          <v-card-text class="flex-grow-1 overflow-y-auto pa-2 pa-md-4">
            <TutorialView :noIcon="false" />
          </v-card-text>

          <v-divider class="my-2"></v-divider>

          <v-card-actions class="flex-column flex-md-row justify-space-between px-2 px-md-4 flex-shrink-0">
            <v-checkbox v-model="dontShowAgain" label="Não mostrar este guia ao iniciar" color="primary" hide-details
              density="comfortable" class="mb-2 mb-md-0"></v-checkbox>
            <v-btn color="primary" variant="flat" size="large" rounded="pill" min-width="200" @click="finishOnboarding"
              append-icon="mdi-chevron-right-circle" class="font-weight-bold elevation-4">
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
  router.push('/app/musicas');
};
</script>

<style scoped>
.onboarding-card {
  width: 100%;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
}

@media (min-width: 960px) {
  .onboarding-card {
    max-height: calc(100vh - 64px);
  }
}
</style>

<style>
.v-carousel__controls__item.v-btn {
  color: rgb(var(--v-theme-primary)) !important;
}
</style>