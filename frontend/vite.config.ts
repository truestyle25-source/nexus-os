import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'NEXUS OS - Gestão, BI & IA',
        short_name: 'NEXUS OS',
        description: 'Plataforma SaaS empresarial que transforma dados em decisões com IA',
        theme_color: '#6366f1',
        background_color: '#020617',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    })
  ],
  server: { port: 5173 },
  build: { outDir: 'dist' }
})