import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { logger } from '@reelmakeeasy/common/logger'
import type { RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import { isDev, isStg } from '@reelmakeeasy/common/utils/env'
import { uploadToStore } from '@reelmakeeasy/common/storage/stored-files'
import { stableStringify } from '@reelmakeeasy/common/utils/stable-json'

// --- Constants ---

const LOCAL_CACHE_DIR = path.join(process.cwd(), 'tmp', 'cache', 'render')

// --- Types ---

export interface RenderCacheParams {
  aspectRatio?: string
  config?: Record<string, unknown>
  fps?: string
  segmentTimeRange?: [number, number]
}

/**
 * Identity scope mixed into every cache key. Without it the key is content-only,
 * and the render plan's per-segment URIs are reduced to non-unique basenames
 * (transition_0.mp4, ...) shared across all projects, so two different
 * projects/renders with the same plan shape collide and one is served the other's
 * cached video. videoId is a fresh UUID per render, so scoping by it
 * guarantees no cross-render/cross-project hit while still letting a retry of the
 * same render reuse its cached output. projectId is kept for readable namespacing.
 */
export interface RenderCacheScope {
  projectId: string
  videoId: string
}

// --- Enable ---

export function isRenderCacheEnabled(): boolean {
  return isDev() || isStg()
}

// --- Cache key computation ---

export function computeRenderCacheKey(
  renderPlan: unknown,
  params: RenderCacheParams,
  scope: RenderCacheScope,
): string {
  const {
    rootDir: _,
    id: __,
    ...planWithoutVolatile
  } = renderPlan as RenderPlan & { rootDir?: string }

  return createHash('sha256')
    .update(stableStringify({ plan: planWithoutVolatile, params, scope }))
    .digest('hex')
}

/** Fast input hash from render payload (no render plan needed) */
export function computeInputHash(payload: unknown, scope: RenderCacheScope): string {
  return createHash('sha256').update(stableStringify({ payload, scope })).digest('hex')
}

// --- Input-to-cache-key mapping (local FS, fast path to skip prepareLocalRenderPlan) ---

export function lookupCacheKey(inputHash: string): string | undefined {
  try {
    return fs.readFileSync(keymapPath(inputHash), 'utf8').trim()
  } catch {
    return undefined
  }
}

export function saveCacheKeyMapping(inputHash: string, cacheKey: string): void {
  try {
    fs.mkdirSync(path.dirname(keymapPath(inputHash)), { recursive: true })
    fs.writeFileSync(keymapPath(inputHash), cacheKey)
  } catch {
    // non-critical
  }
}

function keymapPath(inputHash: string): string {
  return path.join(LOCAL_CACHE_DIR, 'keymap', inputHash)
}

// --- Local FS paths ---

function localMetadataPath(cacheKey: string): string {
  return path.join(LOCAL_CACHE_DIR, 'videos', cacheKey, 'metadata.json')
}

function localVideoPath(cacheKey: string): string {
  return path.join(LOCAL_CACHE_DIR, 'videos', cacheKey, 'video.mp4')
}

// --- Cache operations ---

/**
 * Try to restore a cached video to the destination store address.
 * Returns true on cache hit.
 */
export async function tryRestoreFromCache(
  cacheKey: string,
  destinationUri: string,
): Promise<boolean> {
  try {
    const vPath = localVideoPath(cacheKey)
    if (fs.existsSync(localMetadataPath(cacheKey)) && fs.existsSync(vPath)) {
      // The restored per-run object is as transient as a fresh render's
      // (the cache store itself stays durable) - stamp it or cache hits
      // bypass the lifecycle reclamation.
      await uploadToStore(vPath, destinationUri)
      return true
    }
  } catch (error) {
    logger.warn({ error }, `Render cache restore failed for ${cacheKey.slice(0, 12)}`)
  }
  return false
}

/**
 * Write rendered video to cache. Binary first, then metadata (atomicity marker).
 * Never throws - cache write failure should not fail the render.
 */
export async function writeRenderCache(args: {
  cacheKey: string
  localVideoPath: string
  projectId: string
  videoId: string
}): Promise<void> {
  try {
    const metadata = JSON.stringify({
      cacheKey: args.cacheKey,
      createdAt: new Date().toISOString(),
      sourceProjectId: args.projectId,
      sourceVideoId: args.videoId,
    })

    // Synchronous, so it lands before the render's files are cleaned up.
    const dir = path.dirname(localVideoPath(args.cacheKey))
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(args.localVideoPath, localVideoPath(args.cacheKey))
    fs.writeFileSync(localMetadataPath(args.cacheKey), metadata)

    logger.info(`Render cache written for ${args.cacheKey.slice(0, 12)}`)
  } catch (error) {
    logger.warn({ error }, `Render cache write failed for ${args.cacheKey.slice(0, 12)}`)
  }
}
