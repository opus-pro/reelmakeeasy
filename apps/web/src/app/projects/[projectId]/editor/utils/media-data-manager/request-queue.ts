import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

import { logger } from './logger'
import { MinHeap } from './min-heap'
import type { CacheItem, QueueItem } from './types'
import { getDeviceCapability, isFullRange } from './utils'

export class RequestPriorityQueue {
  activeRequests = 0
  concurrentCount: number

  private abortController = new AbortController()
  private heap: MinHeap<QueueItem>

  constructor() {
    const { tier } = getDeviceCapability()
    this.concurrentCount = tier === 'low' ? 2 : tier === 'high' ? 5 : 3
    this.heap = new MinHeap<QueueItem>((a, b) => a.priority - b.priority)
    logger.debug('RequestPriorityQueue initialized', { concurrentCount: this.concurrentCount })
  }

  abortAll() {
    this.abortController.abort()
    this.abortController = new AbortController()

    const items = this.heap.toArray()
    items.forEach((item) => item.reject(new Error('Aborted')))
    this.heap.clear()

    this.activeRequests = 0
  }

  async push(item: CacheItem, priority: number): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      this.heap.push({ ...item, priority, resolve, reject })
      this.processQueue()
    })
  }

  private async fetchRange(item: CacheItem): Promise<ArrayBuffer> {
    const headers: HeadersInit = {}
    if (item.start < item.end) {
      headers['Range'] = `bytes=${item.start}-${item.end}`
    }

    const response = await fetch(item.url, {
      headers,
      signal: this.abortController.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${item.url}`)
    }

    return response.arrayBuffer()
  }

  private async processQueue() {
    if (this.activeRequests >= this.concurrentCount || this.heap.length === 0) {
      return
    }

    const nextItem = this.heap.pop()
    if (!nextItem) {
      return
    }

    const controller = this.abortController
    this.activeRequests++
    try {
      const result = await this.fetchRange(nextItem)
      nextItem.resolve(result)

      const remainingItems = this.heap.toArray()
      this.heap.clear()

      for (const item of remainingItems) {
        if (isFullRange(item)) {
          this.heap.push(item)
          continue
        }
        if (
          item.url === nextItem.url &&
          (isFullRange(nextItem) || (item.start >= nextItem.start && item.end <= nextItem.end))
        ) {
          // When nextItem is full-range, data starts at byte 0, so offset = item.start
          // When nextItem is a range request, data starts at nextItem.start
          const offset = isFullRange(nextItem) ? item.start : item.start - nextItem.start
          const length = item.end - item.start + 1
          item.resolve(result.slice(offset, offset + length))
        } else {
          this.heap.push(item)
        }
      }
    } catch (error) {
      const err = ensureError(error)
      nextItem.reject(err)
    } finally {
      if (controller === this.abortController) {
        this.activeRequests--
        this.processQueue()
      }
    }
  }
}
