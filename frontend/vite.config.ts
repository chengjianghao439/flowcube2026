import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import legacy from '@vitejs/plugin-legacy'

const isCapacitorBundle = process.env.VITE_CAPACITOR === '1'
const isElectronBundle = process.env.VITE_ELECTRON === '1'
const isPDA = process.env.BUILD_TARGET === 'pda' || isCapacitorBundle
const skipPwa = isPDA || isElectronBundle

export default defineConfig({
  // Capacitor / Electron 本地文件加载时需相对资源路径
  base: isCapacitorBundle || isElectronBundle ? './' : '/',
  plugins: [
    react(),
    // PDA 打包时跳过 PWA（Capacitor 原生壳不需要 Service Worker）
    !skipPwa && VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'FlowCube',
        short_name: 'FlowCube',
        description: 'FlowCube ERP + WMS 一体化系统',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        background_color: '#ffffff',
        theme_color: '#002FA7',
        lang: 'zh-CN',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
    // PDA 打包时生成 ES5 兼容代码，支持 Android 5.x WebView
    isPDA && legacy({
      targets: ['Android >= 5'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      modernPolyfills: true,
    }),
  ].filter(Boolean),
  build: {
    // PDA 模式目标 ES2015，确保旧设备兼容
    target: isPDA ? 'es2015' : 'modules',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
