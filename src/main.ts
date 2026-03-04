import { createApp } from "vue";
import App from "./App.vue";

import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { aliases, mdi } from 'vuetify/iconsets/mdi';
import '@mdi/font/css/materialdesignicons.css';

// Router (vamos criar o arquivo no próximo passo)
import router from "./router/index";

const vuetify = createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: 'light',
  }
});

const app = createApp(App);

app.use(vuetify);
app.use(router);

app.mount("#app");
