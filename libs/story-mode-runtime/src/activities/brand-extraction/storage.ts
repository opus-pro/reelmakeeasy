/**
 * Storage helper for the BrandExtractionWorkflow (UIP Brand Extraction).
 *
 * Mirrors `createLongTakeStorage(projectId)` from `../long-take/storage.ts:53`
 * but scopes paths under `brand-extract/${runId}/` so re-extractions don't
 * collide. It lives in the project's own folder, like UIP `persist-session.ts`.
 *
 * Layout (stored file keys):
 *
 *   projects/{projectId}/brand-extract/{runId}/_raw/sections.json
 *   projects/{projectId}/brand-extract/{runId}/_raw/ctas.json
 *   projects/{projectId}/brand-extract/{runId}/_raw/socials.json
 *   projects/{projectId}/brand-extract/{runId}/_raw/origin-candidates.json
 *   projects/{projectId}/brand-extract/{runId}/_raw/additional.json
 *   projects/{projectId}/brand-extract/{runId}/assets/logo/<file>
 *   projects/{projectId}/brand-extract/{runId}/assets/images/<file>
 *   projects/{projectId}/brand-extract/{runId}/assets/fonts/<file>
 *   projects/{projectId}/brand-extract/{runId}/assets/screenshots/<file>
 */

import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'

export function brandExtractionRunPrefix(runId: string): string {
  return `brand-extract/${runId}`
}

export function createBrandExtractionStorage(projectId: string): ProjectStore {
  return new ProjectStore(projectId)
}

export const BRAND_RAW_DIR = '_raw'
export const BRAND_ASSETS_DIR = 'assets'
export const BRAND_LOGOS_DIR = `${BRAND_ASSETS_DIR}/logo`
export const BRAND_IMAGES_DIR = `${BRAND_ASSETS_DIR}/images`
export const BRAND_FONTS_DIR = `${BRAND_ASSETS_DIR}/fonts`
export const BRAND_SCREENSHOTS_DIR = `${BRAND_ASSETS_DIR}/screenshots`

/** Resolve a relative-to-run path under `brand-extract/{runId}/`. */
export function brandRunPath(runId: string, relativePath: string): string {
  return `${brandExtractionRunPrefix(runId)}/${relativePath}`
}
