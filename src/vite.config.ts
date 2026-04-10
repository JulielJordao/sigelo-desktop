   import { defineConfig } from 'vite'
   import vue from '@vitejs/plugin-vue'
   import path from 'path'

   export default defineConfig({
     plugins: [vue()],
     resolve: {
       alias: {
         '@': path.resolve(__dirname, './src'),
       },
     },
     build: {
      chunkSizeWarningLimit: 1000, // Aumenta o limite para 1MB para sumir o aviso
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Move as bibliotecas pesadas para arquivos (chunks) separados
            if (id.includes('node_modules')) {
              if (id.includes('vuetify')) return 'vendor-vuetify';
              if (id.includes('pptxgenjs')) return 'vendor-pptx';
              if (id.includes('printpdf')) return 'vendor-pdf';
              return 'vendor'; // Outras bibliotecas
            }
          }
        }
      }
    }
   })