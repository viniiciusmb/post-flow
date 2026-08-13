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
        'forgot-password': path.resolve(__dirname, 'forgot-password.html'),
        'reset-password': path.resolve(__dirname, 'reset-password.html'),
        admin: path.resolve(__dirname, 'admin.html'),
        client: path.resolve(__dirname, 'client.html'),
        'youtube-channels': path.resolve(__dirname, 'youtube-channels.html'),
        'videos-clips': path.resolve(__dirname, 'videos-clips.html'),
        'client-settings': path.resolve(__dirname, 'client-settings.html'),
        'admin-clients': path.resolve(__dirname, 'admin-clients.html'),
        'admin-postings': path.resolve(__dirname, 'admin-postings.html'),
        'admin-queue': path.resolve(__dirname, 'admin-queue.html'),
        'tiktok-account': path.resolve(__dirname, 'tiktok-account.html'),
        'admin-metrics': path.resolve(__dirname, 'admin-metrics.html'),
        tunnel: path.resolve(__dirname, 'tunnel.html'),
        bandwidth: path.resolve(__dirname, 'bandwidth.html'),
        'client-billing': path.resolve(__dirname, 'client-billing.html'),
        'admin-billing': path.resolve(__dirname, 'admin-billing.html'),
        'client-commissions': path.resolve(__dirname, 'client-commissions.html'),
        'admin-commissions': path.resolve(__dirname, 'admin-commissions.html'),
        'admin-errors': path.resolve(__dirname, 'admin-errors.html'),
      },
    },
  },
})
