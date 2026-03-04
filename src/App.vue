<script setup lang="ts">
// No App.vue, geralmente não precisamos de muita lógica, 
// pois ela fica dentro de cada View (Login, Músicas, etc.)
</script>

<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<style>
/* Estilos Globais para o seu Desktop App */
html {
  /* Impede que o usuário selecione texto em partes indesejadas do app (comum em apps desktop) */
  user-select: none;
  overflow: hidden; /* O scroll será controlado internamente pelos componentes */
}

:root {
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
}

/* Garante que o app ocupe 100% da janela do Tauri */
#app {
  height: 100vh;
  width: 100vw;
}

/* Personalização da barra de rolagem para ficar mais elegante no Mac */
::-webkit-scrollbar {
  width: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #bdbdbd;
  border-radius: 10px;
}
::-webkit-scrollbar-thumb:hover {
  background: #9e9e9e;
}
</style>