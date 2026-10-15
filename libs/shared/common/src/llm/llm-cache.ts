/**
 * LLM Cache -- local cache for LLM responses.
 *
 * Caches every LLM call (text, image, video) for determinism and faster iteration,
 * on the local filesystem (tmp/cache/llm/, 28-day TTL). Disabled in production.
 *
 * Enabled when: (isDev() || isStg()) && LLM_SKIP_CACHE !== '1'
 *
 * Binary responses (video files) are stored as separate .bin.N files alongside
 * the JSON metadata. Image base64 is small enough to live in JSON directly.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { getLogger } from '../logger'
import { isDev, isStg } from '../utils/env'
import { stableStringify } from '../utils/stable-json'

const logger = getLogger('llm-cache')

// --- Constants ---

const LOCAL_CACHE_DIR = path.join(process.cwd(), 'tmp', 'cache', 'llm')
const LOCAL_TTL_MS = 28 * 24 * 60 * 60 * 1000

// --- Types ---

export interface BinaryData {
  data: Buffer
  ext?: string // file extension without dot, e.g. 'mp4', 'png'
  index: number
  originalPath?: string
}

export interface BinaryRef {
  ext?: string
  index: number
  originalPath?: string
  size: number
}

export interface CacheEntry<T> {
  binaries?: BinaryRef[]
  createdAt: number
  params: Record<string, unknown>
  result: T
}

// --- Local FS store ---

async function ensureLocalCacheDir(): Promise<void> {
  await fs.promises.mkdir(LOCAL_CACHE_DIR, { recursive: true })
}

function isExpired(entry: CacheEntry<unknown>): boolean {
  return Date.now() - entry.createdAt > LOCAL_TTL_MS
}

function localBinPath(key: string, index: number, ext?: string): string {
  const suffix = ext ? `.${ext}` : ''
  return path.join(LOCAL_CACHE_DIR, `${key}.bin.${index}${suffix}`)
}

function localJsonPath(key: string): string {
  return path.join(LOCAL_CACHE_DIR, `${key}.json`)
}

const localFs = {
  async readBin(key: string, index: number, ext?: string): Promise<Buffer | undefined> {
    try {
      return await fs.promises.readFile(localBinPath(key, index, ext))
    } catch {
      return undefined
    }
  },

  async readJson<T>(key: string): Promise<CacheEntry<T> | undefined> {
    try {
      const raw = await fs.promises.readFile(localJsonPath(key), 'utf8')
      const entry = JSON.parse(raw) as CacheEntry<T>
      if (isExpired(entry)) {
        return undefined
      }
      return entry
    } catch {
      return undefined
    }
  },

  readJsonSync<T>(key: string): CacheEntry<T> | undefined {
    try {
      const raw = fs.readFileSync(localJsonPath(key), 'utf8')
      const entry = JSON.parse(raw) as CacheEntry<T>
      if (isExpired(entry)) {
        return undefined
      }
      return entry
    } catch {
      return undefined
    }
  },

  async streamBinTo(
    key: string,
    index: number,
    targetPath: string,
    ext?: string,
  ): Promise<boolean> {
    const src = localBinPath(key, index, ext)
    try {
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.promises.copyFile(src, targetPath)
      return true
    } catch {
      return false
    }
  },

  async writeBin(key: string, index: number, data: Buffer, ext?: string): Promise<void> {
    await ensureLocalCacheDir()
    await fs.promises.writeFile(localBinPath(key, index, ext), data)
  },

  async writeJson<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    await ensureLocalCacheDir()
    await fs.promises.writeFile(localJsonPath(key), JSON.stringify(entry, null, 2))
  },
}

// --- Core ---

export function buildCacheKey(params: unknown): string {
  return createHash('sha256').update(stableStringify(params)).digest('hex')
}

// Re-export for convenience
export { stableStringify } from '../utils/stable-json'

export function isCacheEnabled(): boolean {
  if (process.env['LLM_SKIP_CACHE'] === '1') {
    return false
  }
  return isDev() || isStg()
}

/**
 * Hash file content for cache keys (e.g. video first/last frame images).
 * Returns a short content hash, or the path string as fallback.
 */
export async function hashFileContent(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) {
    return undefined
  }
  try {
    const content = await fs.promises.readFile(filePath)
    return createHash('sha256').update(content).digest('hex').slice(0, 16)
  } catch {
    return filePath
  }
}

// --- Internal read/write (used by try* helpers, not exported) ---

export async function writeCache<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  await localFs.writeJson(key, entry)
  logger.info(`[llm-cache] wrote ${key.slice(0, 12)} task=${String(entry.params['task'] ?? '?')}`)
}

export async function writeCacheWithBinaries<T>(
  key: string,
  entry: Omit<CacheEntry<T>, 'binaries'>,
  binaries: BinaryData[],
): Promise<void> {
  // Write binaries FIRST, then JSON last (JSON existence = entry complete)
  const refs: BinaryRef[] = []
  for (const bin of binaries) {
    await localFs.writeBin(key, bin.index, bin.data, bin.ext)
    refs.push({
      ext: bin.ext,
      index: bin.index,
      originalPath: bin.originalPath,
      size: bin.data.byteLength,
    })
  }

  const full: CacheEntry<T> = { ...entry, binaries: refs }
  await localFs.writeJson(key, full)
  logger.info(
    `[llm-cache] wrote ${key.slice(0, 12)} +${binaries.length} bins task=${String(entry.params['task'] ?? '?')}`,
  )
}

async function readCache<T>(key: string): Promise<CacheEntry<T> | undefined> {
  return localFs.readJson<T>(key)
}

function readCacheSync<T>(key: string): CacheEntry<T> | undefined {
  return localFs.readJsonSync<T>(key)
}

async function readCacheWithBinaries<T>(
  key: string,
): Promise<undefined | { buffers: Buffer[]; entry: CacheEntry<T> }> {
  const entry = await localFs.readJson<T>(key)
  if (!entry?.binaries?.length) {
    return undefined
  }

  const results = await Promise.all(
    entry.binaries.map((bin) => localFs.readBin(key, bin.index, bin.ext)),
  )
  if (results.some((buf) => !buf)) {
    return undefined // missing .bin file, treat as cache miss
  }

  return { entry, buffers: results as Buffer[] }
}

// --- Public API: JSON cache ---

/** Read cached JSON result; returns undefined if disabled / miss / expired. */
export async function tryRead<T>(params: Record<string, unknown>): Promise<T | undefined> {
  if (!isCacheEnabled()) {
    return undefined
  }
  const key = buildCacheKey(params)
  const start = Date.now()
  const entry = await readCache<T>(key)
  const hit = !!entry
  logHitMiss(key, params, hit)
  return entry?.result
}

/** Synchronous convenience - only for stream() which must return synchronously. */
export function tryReadSync<T>(params: Record<string, unknown>): T | undefined {
  if (!isCacheEnabled()) {
    return undefined
  }
  const key = buildCacheKey(params)
  const start = Date.now()
  const entry = readCacheSync<T>(key)
  const hit = !!entry
  logHitMiss(key, params, hit)
  return entry?.result
}

/** Fire-and-forget JSON cache write; no-op if disabled. */
export function tryWrite<T>(params: Record<string, unknown>, result: T): void {
  if (!isCacheEnabled()) {
    return
  }
  const key = buildCacheKey(params)
  writeCache(key, { createdAt: Date.now(), params, result }).catch(() => undefined)
}

// --- Public API: Binary cache (in-memory buffers) ---

/** Read cached binary result with all buffers loaded in memory. Use for small
 *  payloads that need in-process access (e.g. base64 encoding).
 *  For large files that just need to land on disk, prefer tryReadBinaryMeta +
 *  saveCachedBinaryToFile. */
export async function tryReadBinary<T>(
  params: Record<string, unknown>,
): Promise<undefined | { buffers: Buffer[]; result: T }> {
  if (!isCacheEnabled()) {
    return undefined
  }
  const key = buildCacheKey(params)
  const start = Date.now()
  const cached = await readCacheWithBinaries<T>(key)
  const hit = !!cached
  logHitMiss(key, params, hit, 'binary')
  if (!cached) {
    return undefined
  }
  return {
    buffers: cached.buffers,
    result: cached.entry.result,
  }
}

/** Fire-and-forget binary cache write; no-op if disabled. */
export function tryWriteBinary<T>(
  params: Record<string, unknown>,
  result: T,
  binaries: BinaryData[],
): void {
  if (!isCacheEnabled()) {
    return
  }
  const key = buildCacheKey(params)
  writeCacheWithBinaries(key, { createdAt: Date.now(), params, result }, binaries).catch(
    () => undefined,
  )
}

// --- Public API: Binary cache (streaming to file, no in-memory buffer) ---

/** Read only the metadata for a binary cache entry. Returns the cache key and
 *  binary refs so the caller can stream individual files to disk via
 *  saveCachedBinaryToFile without loading them into memory. */
export async function tryReadBinaryMeta<T>(
  params: Record<string, unknown>,
): Promise<undefined | { binaries: BinaryRef[]; key: string; result: T }> {
  if (!isCacheEnabled()) {
    return undefined
  }
  const key = buildCacheKey(params)
  const start = Date.now()
  const entry = await localFs.readJson<T>(key)
  const hit = !!entry?.binaries?.length
  logHitMiss(key, params, hit, 'binary-meta')
  if (!entry?.binaries?.length) {
    return undefined
  }
  return { binaries: entry.binaries, key, result: entry.result }
}

/** Stream a cached binary directly to a local file path, bypassing Node.js
 *  memory. For storage this uses download-to-file; for local FS this uses copyFile.
 *  Returns true on success, false if the binary was not found. */
export async function saveCachedBinaryToFile(
  key: string,
  index: number,
  targetPath: string,
  ext?: string,
): Promise<boolean> {
  return localFs.streamBinTo(key, index, targetPath, ext)
}

// --- Utilities ---

/**
 * Normalize contents for cache key stability by stripping the project-specific part
 * of a stored file's address or URL: the project folder `/projects/{id}/` and its
 * former name (`ao` in place of `projects`) both reduce to the same placeholder, so an entry cached for an older
 * address keeps hitting once the file is addressed as `store://projects/<id>/<path>`.
 */
const URL_FIELDS: Record<string, string> = {
  audio_url: 'audioUrl',
  image_url: 'imageUrl',
  video_url: 'videoUrl',
}

export function normalizeContentsForDevCache(contents: undefined | unknown[]): unknown {
  if (!contents?.length || !isCacheEnabled()) {
    return contents
  }
  return contents.map((c) => {
    if (typeof c !== 'object' || c === null) {
      return c
    }
    const item = c as Record<string, unknown>
    const field = URL_FIELDS[item['type'] as string]
    if (field && typeof item[field] === 'string') {
      return { ...item, [field]: stripProjectPrefix(item[field] as string) }
    }
    return c
  })
}

function stripProjectPrefix(uri: string): string {
  const m = uri.match(/\/(?:projects|ao)\/[^/]+\/(.+)$/)
  return m ? `*/${m[1]}` : uri
}

// --- Internals ---

function logHitMiss(
  key: string,
  params: Record<string, unknown>,
  hit: boolean,
  suffix?: string,
): void {
  const tag = String(params['task'] ?? params['_type'] ?? '?')
  const extra = suffix ? ` (${suffix})` : ''
  logger.debug(`[llm-cache] ${hit ? 'HIT ' : 'MISS'} key=${key.slice(0, 12)} task=${tag}${extra}`)
}
