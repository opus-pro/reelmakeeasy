// Read with dot access so the web build inlines it (Next.js only replaces
// `process.env.NEXT_PUBLIC_*` written that way).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      NEXT_PUBLIC_ASSETS_URL?: string
    }
  }
}

/**
 * Base URL of the shared read-only assets (icons, animations, images, caption
 * fonts, effect templates). Browser-safe: no Node imports. By default the web
 * app serves them from its own `apps/web/public/static` folder; point
 * PUBLIC_ASSETS_URL (NEXT_PUBLIC_ASSETS_URL in the web app) at an absolute URL
 * to serve them from somewhere else.
 */
export const PUBLIC_CDN_BASE_URL = (
  (typeof process !== 'undefined' &&
    (process.env['PUBLIC_ASSETS_URL'] || process.env.NEXT_PUBLIC_ASSETS_URL)) ||
  '/static'
).replace(/\/$/, '')

/**
 * Shared read-only assets kept as stored files under `public/`. Nothing ships
 * there yet: the caption cover and the watermark that point here resolve to
 * missing files.
 */
export const PUBLIC_STORE_PREFIX = 'store://public'
