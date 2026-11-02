import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { appConfig } from './src/config/app';

/** Fills %APP_*% placeholders in index.html from the one config file. */
function brandHtml(): Plugin {
  return {
    name: 'handyos-brand-html',
    transformIndexHtml: (html) =>
      html
        .replaceAll('%APP_NAME%', appConfig.name)
        .replaceAll('%APP_DESCRIPTION%', appConfig.description)
        .replaceAll('%APP_THEME_COLOR%', appConfig.themeColor),
  };
}

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    brandHtml(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: appConfig.name,
        short_name: appConfig.shortName,
        description: appConfig.description,
        theme_color: appConfig.themeColor,
        background_color: appConfig.backgroundColor,
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { navigateFallback: '/index.html', globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] },
    }),
  ],
});
