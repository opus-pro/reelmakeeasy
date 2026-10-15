import { ModuleName } from '../../wasm/type'
import { PrefetchTask } from '../extract-prefetch-tasks'
import { createMp4Service } from '../mp4box-helpers'

import { CacheManager } from './cache-manager'
import { DEFAULT_PADDING_BYTES, FULL_RANGE_END, FULL_RANGE_START } from './constants'
import { logger } from './logger'
import { RequestPriorityQueue } from './request-queue'
import type { CacheItem } from './types'
import { isFullRange } from './utils'

export class MediaDataManager {
  store: CacheManager

  private isProcessing = false
  private mp4Service: ReturnType<typeof createMp4Service>
  private prefetchQueue: PrefetchTask[] = []
  private processingUrls: Set<string> = new Set()
  private requestQueue: RequestPriorityQueue
  private warmupAborted = false

  constructor() {
    this.requestQueue = new RequestPriorityQueue()
    this.store = new CacheManager()
    this.mp4Service = createMp4Service({
      fetchRange: (item, priority = 0, moduleName: false | ModuleName = false) =>
        this.get(item, priority, moduleName),
      getSize: (url: string) => this.getSize(url),
    })
  }

  abortWarmup() {
    this.warmupAborted = true
    this.prefetchQueue = []
    this.processingUrls.clear()
  }

  clearCache() {
    this.prefetchQueue = []
    this.processingUrls.clear()
    this.mp4Service.clearCache()
  }

  destroy() {
    this.store.destroy()
    this.requestQueue.abortAll()
    this.processingUrls.clear()
    this.prefetchQueue = []
  }

  async enqueue(items: PrefetchTask[]): Promise<void> {
    await this.store.initPromise

    for (const item of items) {
      if (this.processingUrls.has(item.url)) {
        continue
      }
      if (this.store.getCache({ url: item.url, start: FULL_RANGE_START, end: FULL_RANGE_END })) {
        continue
      }
      this.prefetchQueue.push(item)
    }

    this.prefetchQueue.sort((a, b) => a.priority - b.priority)
    this.processQueue()
  }

  async get(item: CacheItem, priority = 0, moduleName: false | ModuleName): Promise<ArrayBuffer> {
    if (!item.url) {
      logger.warn('Invalid empty URL in get()')
      return new ArrayBuffer(0)
    }

    await this.store.initPromise

    try {
      const cache = this.store.getCache(item)
      if (cache) {
        logger.debug('Cache hit', { start: item.start, end: item.end, url: item.url, moduleName })
        return cache
      }

      if (this.processingUrls.has(item.url)) {
        const fullRangeCache = this.store.getCache({
          url: item.url,
          start: FULL_RANGE_START,
          end: FULL_RANGE_END,
        })
        if (fullRangeCache) {
          const offset = item.start
          const length = item.end - item.start + 1
          return fullRangeCache.slice(offset, offset + length)
        }
      }

      await this.requestAndStored(item, priority)
      logger.debug('Cache miss', { start: item.start, end: item.end, url: item.url })

      const data = this.store.getCache(item)
      if (!data) {
        return await this.requestQueue.push(item, priority)
      }

      logger.debug('Buffer loaded', { byteLength: data.byteLength })
      return data
    } catch (error) {
      logger.error('Failed to get media data, returning empty buffer', {
        url: item.url,
        start: item.start,
        end: item.end,
        error,
      })
      return new ArrayBuffer(0)
    }
  }

  async getSize(url: string): Promise<number> {
    if (!url) {
      return 0
    }

    try {
      await this.store.initPromise
      await this.store.appendUrls([url])
      let size = this.store.getSize({ url })
      if (!size) {
        const response = await fetch(url, {
          method: url.startsWith('blob') ? 'GET' : 'HEAD',
        })

        if (!response.ok) {
          logger.warn('Failed to get file size', { url, status: response.status })
          return 0
        }

        size = Number(response.headers.get('Content-Length') ?? 0)
      }
      this.store.storeSize({ url }, size)
      return size
    } catch (error) {
      logger.error('Failed to get file size', { url, error })
      return 0
    }
  }

  async init(urls: string[]) {
    await this.store.init(urls)
  }

  async warmup(tasks: PrefetchTask[]): Promise<void> {
    if (tasks.length === 0) {
      return
    }

    this.warmupAborted = false
    await this.store.initPromise
    await this.store.appendUrls(tasks.map((v) => v.url))
    await this.enqueue(tasks)
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return
    }
    this.isProcessing = true

    while (this.prefetchQueue.length > 0 && !this.warmupAborted) {
      const task = this.prefetchQueue.shift()
      if (!task) {
        break
      }

      if (this.processingUrls.has(task.url)) {
        continue
      }

      const fullRangeItem = { url: task.url, start: FULL_RANGE_START, end: FULL_RANGE_END }
      if (this.store.getCache(fullRangeItem)) {
        logger.debug('Already cached', { url: task.url })
        continue
      }

      this.processingUrls.add(task.url)

      try {
        if (this.warmupAborted) {
          break
        }

        if (task.isTimeRange) {
          const { start, end } = await this.mp4Service.computeRange({
            url: task.url,
            startTime: Math.max(0, task.start),
            endTime: task.end,
            paddingBytes: DEFAULT_PADDING_BYTES,
          })
          await this.requestAndStored({ url: task.url, start, end }, task.priority)
        } else {
          await this.requestAndStored(task, task.priority)
        }
        logger.debug('Prefetch cached', { url: task.url })
      } catch (error) {
        logger.warn('Prefetch failed', { url: task.url, error })
      } finally {
        this.processingUrls.delete(task.url)
      }
    }

    this.isProcessing = false
  }

  private async requestAndStored(item: CacheItem, priority: number) {
    const cached = this.store.getCache(item)
    if (cached) {
      return
    }

    const missingParts = isFullRange(item)
      ? [item]
      : this.store.getMissingParts(item).map((v) => ({
          ...v,
          url: item.url,
        }))

    if (missingParts.length === 0) {
      return
    }

    for (const part of missingParts) {
      const buffer = await this.requestQueue.push(part, priority)
      this.store.storeCache(part, buffer)
    }
  }
}
