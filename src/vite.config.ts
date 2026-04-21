import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // Isso diz ao Vue para tratar tags que começam com 'ffmpeg-'
          // como elementos nativos e não tentar resolver como componentes Vue
          isCustomElement: (tag: string) => tag.startsWith("ffmpeg-"),
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000, // Aumenta o limite para 1MB para sumir o aviso
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Move as bibliotecas pesadas para arquivos (chunks) separados
          if (id.includes("node_modules")) {
            if (id.includes("vuetify")) return "vendor-vuetify";
            if (id.includes("pptxgenjs")) return "vendor-pptx";
            if (id.includes("printpdf")) return "vendor-pdf";
            return "vendor"; // Outras bibliotecas
          }
        },
      },
    },
  },
});
