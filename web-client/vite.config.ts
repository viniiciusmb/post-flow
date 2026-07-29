import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Sem "base" customizado: o padrao do Vite ja gera referencias em
  // "/assets/..." (assetsDir padrao "assets" + base padrao "/"), que bate
  // exatamente com o mount estatico do Express em /assets -> dist/assets.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        login: path.resolve(__dirname, 'login.html'),
        admin: path.resolve(__dirname, 'admin.html'),
        client: path.resolve(__dirname, 'client.html'),
      },
    },
  },
})
