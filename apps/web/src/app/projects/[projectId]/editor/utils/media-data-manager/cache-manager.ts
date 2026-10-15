import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { type IDBPDatabase, openDB } from 'idb'
import { debounce, omit, sumBy } from 'lodash-es'

import { intervalDifference, mergeIntervalsWithData } from '../interval-difference'

import {
  DB_NAME,
  DB_VERSION,
  DEBOUNCE_PERSIST_MS,
  DEFAULT_EVICT_RATIO,
  DEFAULT_MAX_CACHE_SIZE,
  DEFAULT_PERSIST_DELAY_MS,
  HIGH_TIER_MAX_CACHE_SIZE,
  HOT_DATA_THRESHOLD_MS,
  LOW_TIER_MAX_CACHE_SIZE,
  MAX_CACHE_COUNT,
  STORE_NAME,
} from './constants'
import { logger } from './logger'
import type { CacheItem, CacheMap, CacheMapItem } from './types'
import { getDeviceCapability, getStorageQuota, isFullRange } from './utils'

export class CacheManager {
  initPromise: Promise<void>

  immediatePersist = async () => {
    if (!this.map || !this.db) {
      return
    }

    const mapSnapshot = { ...this.map }
    try {
      const tx = this.db.transaction(STORE_NAME, 'readwrite')
      const promises: Promise<IDBValidKey>[] = []

      Object.entries(mapSnapshot).forEach(([url, value]) => {
        promises.push(tx.store.put(value, url))
      })

      await Promise.all([...promises, tx.done])
    } catch (err) {
      const error = ensureError(err)
      if (error.name === 'QuotaExceededError') {
        logger.warn('Storage quota exceeded, evicting cache')
        this.evictLRU()
        try {
          await this.immediatePersist()
        } catch (retryErr) {
          logger.error('Failed to persist after eviction', { error: retryErr })
        }
      } else {
        this.evictLRU()
      }
    }
  }

  persist = debounce(() => {
    this.immediatePersist().catch((err) => {
      logger.error('Failed to persist cache', { error: err })
    })
  }, DEBOUNCE_PERSIST_MS)

  private db: IDBPDatabase | null = null
  private initResolve!: (value: PromiseLike<void> | void) => void
  private map: CacheMap | null = null
  private maxCacheSize: number = DEFAULT_MAX_CACHE_SIZE
  private needCleanExpireData = true
  private totalCacheSize = 0

  constructor() {
    this.initPromise = new Promise<void>((resolve) => {
      this.initResolve = resolve
    })
  }

  async appendUrls(urls: string[]) {
    if (!this.db) {
      return
    }

    const uniqueUrls = [...new Set(urls)].filter((url) => !this.map?.[url])

    await Promise.all(
      uniqueUrls.map(async (url) => {
        const db = this.db
        if (!db) {
          return
        }
        const data = (await db.get(STORE_NAME, url)) as CacheMapItem | undefined
        if (data && this.map) {
          const existing = this.map[url]
          const hasNoParts = !existing || !existing.parts || existing.parts.length === 0
          if (hasNoParts && data.parts && data.parts.length > 0) {
            this.map[url] = data
            this.totalCacheSize += sumBy(data.parts, (p) => p.data.byteLength)
          }
        }
      }),
    )
  }

  async cleanAll() {
    // Clear in-memory state first to ensure consistency
    this.map = {}
    this.totalCacheSize = 0

    if (!this.db) {
      return
    }

    const db = this.db
    const keys = await db.getAllKeys(STORE_NAME)
    await Promise.all(
      keys.map(async (key) => {
        await db.delete(STORE_NAME, key as string)
      }),
    )
  }

  async cleanExpireData() {
    if (!this.db) {
      return
    }

    const db = this.db
    const keys = await db.getAllKeys(STORE_NAME)
    await Promise.all(
      keys.map(async (key) => {
        const data = (await db.get(STORE_NAME, key as string)) as CacheMapItem | undefined
        const lastReadTime = data?.lastReadTime ?? 0
        if (lastReadTime + DEFAULT_PERSIST_DELAY_MS / 2 <= Date.now()) {
          await db.delete(STORE_NAME, key as string)
        }
      }),
    )
  }

  destroy() {
    this.persist.flush()
  }

  evictLRU(targetFreeBytes?: number) {
    if (!this.map) {
      return
    }

    const now = Date.now()

    const entries = Object.entries(this.map).map(([url, item]) => ({
      url,
      lastReadTime: item.lastReadTime,
      cachedSize: sumBy(item.parts, (p) => p.data.byteLength),
      isHot: now - item.lastReadTime < HOT_DATA_THRESHOLD_MS,
    }))

    entries.sort((a, b) => {
      if (a.isHot !== b.isHot) {
        return a.isHot ? 1 : -1
      }
      return a.lastReadTime - b.lastReadTime
    })

    const totalCachedSize = sumBy(entries, (e) => e.cachedSize)
    const targetToFree = targetFreeBytes ?? totalCachedSize * DEFAULT_EVICT_RATIO

    let freedSize = 0
    let coldEvicted = 0
    let hotEvicted = 0

    for (const entry of entries) {
      if (freedSize >= targetToFree) {
        break
      }
      delete this.map[entry.url]
      freedSize += entry.cachedSize
      this.totalCacheSize -= entry.cachedSize

      if (entry.isHot) {
        hotEvicted++
      } else {
        coldEvicted++
      }
    }

    logger.debug('LRU eviction completed', {
      freedSize,
      targetToFree,
      coldEvicted,
      hotEvicted,
    })
  }

  getCache(item: CacheItem): ArrayBuffer | undefined {
    const value = this.map?.[item.url]
    if (!value) {
      return undefined
    }

    const fullRangePart = value.parts.find((p) => isFullRange(p))

    value.lastReadTime = Date.now()

    if (isFullRange(item)) {
      return fullRangePart?.data ?? undefined
    }

    const part =
      fullRangePart ?? value.parts.find(({ start: s, end: e }) => item.start >= s && item.end <= e)

    if (part?.data instanceof ArrayBuffer) {
      const sliceStart = item.start - part.start
      const sliceEnd = Math.min(item.end - part.start + 1, part.data.byteLength)
      return part.data.slice(sliceStart, sliceEnd)
    }
  }

  getMissingParts(item: CacheItem): Array<Pick<CacheItem, 'end' | 'start'>> {
    const value = this.map?.[item.url]
    if (!value) {
      return [omit(item, 'url')]
    }
    return intervalDifference(item, value.parts)
  }

  getSize(item: Pick<CacheItem, 'url'>): number | undefined {
    const entry = this.map?.[item.url]
    if (!entry) {
      return undefined
    }
    if (entry.size) {
      return entry.size
    }
    const fullRangePart = entry.parts?.find((p) => isFullRange(p))
    if (fullRangePart?.data) {
      return fullRangePart.data.byteLength
    }
    return undefined
  }

  async getTotalCount() {
    if (!this.db) {
      return 0
    }
    const keys = await this.db.getAllKeys(STORE_NAME)
    return keys.length
  }

  getTotalSize(): number {
    return this.totalCacheSize
  }

  async init(urls: string[]) {
    try {
      const { tier } = getDeviceCapability()
      const quota = await getStorageQuota()

      const baseSize = quota
        ? Math.min(quota.available * 0.3, HIGH_TIER_MAX_CACHE_SIZE)
        : DEFAULT_MAX_CACHE_SIZE

      this.maxCacheSize =
        tier === 'low'
          ? Math.min(baseSize, LOW_TIER_MAX_CACHE_SIZE)
          : tier === 'high'
            ? baseSize
            : Math.min(baseSize, DEFAULT_MAX_CACHE_SIZE)

      logger.info('Cache initialized', {
        tier,
        maxCacheSize: this.maxCacheSize,
        quotaAvailable: quota?.available,
      })

      await this.initialize()
      this.map = {}
      this.totalCacheSize = 0

      await this.appendUrls(urls)

      if (this.needCleanExpireData && this.map) {
        this.needCleanExpireData = false
        await this.cleanExpireData()

        const count = await this.getTotalCount()
        if (count > MAX_CACHE_COUNT) {
          await this.cleanAll()
        }
      }

      this.initResolve()
    } catch (e) {
      const err = ensureError(e)
      logger.error('CacheManager init error', { error: err })
      this.map = {}
      this.totalCacheSize = 0
      // Always resolve to allow graceful degradation to in-memory-only caching
      // when IndexedDB is unavailable (private browsing, storage quota issues, etc.)
      this.initResolve()
    }
  }

  storeCache(item: CacheItem, data: ArrayBuffer) {
    if (!item.url) {
      logger.warn('Attempted to store cache with empty URL')
      return
    }
    if (!this.map) {
      this.map = {}
    }

    if (this.totalCacheSize + data.byteLength > this.maxCacheSize) {
      this.evictLRU(data.byteLength)
    }

    const existing = this.map[item.url]
    const oldSize = existing ? sumBy(existing.parts, (p) => p.data.byteLength) : 0

    if (existing) {
      const interval = mergeIntervalsWithData(
        {
          ...item,
          data,
        },
        existing.parts,
      )
      this.map[item.url] = {
        ...existing,
        lastReadTime: Date.now(),
        parts: interval,
      }
    } else {
      this.map[item.url] = {
        parts: [
          {
            ...omit(item, 'url'),
            data,
          },
        ],
        size: 0,
        lastReadTime: Date.now(),
      }
    }

    const newSize = sumBy(this.map[item.url].parts, (p) => p.data.byteLength)
    this.totalCacheSize += newSize - oldSize

    this.persist()
  }

  storeSize(item: Pick<CacheItem, 'url'>, size: number) {
    if (!item.url) {
      logger.warn('Attempted to store size with empty URL')
      return
    }
    if (!this.map) {
      this.map = {}
    }

    const existing = this.map[item.url]
    if (existing) {
      this.map[item.url] = {
        ...existing,
        lastReadTime: Date.now(),
        size,
      }
    } else {
      this.map[item.url] = {
        parts: [],
        lastReadTime: Date.now(),
        size,
      }
    }

    this.persist()
    return existing?.size
  }

  private async initialize(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      logger.warn('IndexedDB is not supported')
      return
    }

    try {
      this.db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME)
          }
        },
      })
    } catch (error) {
      // Log but don't throw - allows graceful degradation to in-memory caching
      // when IndexedDB fails (private browsing, storage quota issues, etc.)
      logger.error('Failed to initialize IndexedDB', { error })
    }
  }
}
