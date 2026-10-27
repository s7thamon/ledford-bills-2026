import type { NitroConfig } from 'nitropack/types'

// Nuxt 4.6 ships an empty Nitro type registry, so `nitro` would only accept a minimal fallback type.
declare module '@nuxt/schema' {
  interface NitroTypes { config: NitroConfig }
}

const nitro = {
  experimental: {
    websocket: true,
    tasks: true
  },
  scheduledTasks: {
    '5 0 * * *': ['bills:generate-recurring'],
    '0 8 3,6 * *': ['bills:unpaid-reminder']
  }
} satisfies NitroConfig

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  modules: ['@nuxt/ui', 'nuxt-auth-utils'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  colorMode: { preference: 'system', fallback: 'light' },

  app: {
    head: {
      title: 'Ledford Bills',
      titleTemplate: 'Bills - %s',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
      ],
      // Installed from the home screen it opens full screen, like an app.
      meta: [
        { name: 'theme-color', content: '#0ea5e9' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'Bills' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }
      ]
    }
  },

  runtimeConfig: {
    session: {
      // Set NUXT_SESSION_PASSWORD (32+ chars) in the environment.
      password: '',
      // Session lives as long as a trusted device; the password is still required after it expires.
      maxAge: 60 * 60 * 24 * 120,
      cookie: { sameSite: 'lax' }
    }
  },

  nitro
})
