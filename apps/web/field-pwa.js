export const fieldPwa = {
  registerType: 'autoUpdate',
  injectRegister: false,
  manifest: {
    name: 'FieldFlow',
    short_name: 'FieldFlow',
    start_url: '/field',
    scope: '/field',
    display: 'standalone',
    theme_color: '#0f172a',
    background_color: '#f8fafc',
    lang: 'ar',
    dir: 'rtl',
    icons: [
      { src: '/field-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/field-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,png,woff2}'],
    // The field installer must not download office-only reporting pages or chart code.
    globIgnores: ['**/Dashboard-*', '**/CampaignReport-*', '**/ReportingUi-*'],
    navigateFallback: '/index.html',
    navigateFallbackAllowlist: [/^\/field(?:[/?]|$)/],
    navigateFallbackDenylist: [/^\/api(?:[/?]|$)/],
    runtimeCaching: [],
  },
};
