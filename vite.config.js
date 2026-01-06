import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/zeroed/',
  build: {
    outDir: 'dist/zeroed',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        privacy: resolve(__dirname, 'privacy.html'),
      },
    },
  },
})
