export type CacheItem = {
  end: number
  start: number
  url: string
}

export type CacheMap = {
  [url: string]: CacheMapItem
}

export type CacheMapItem = {
  lastReadTime: number
  parts: Array<{
    data: ArrayBuffer
    end: number
    start: number
  }>
  size: number
}

export interface DeviceCapability {
  cpuCores: number
  memoryGB: number
  tier: 'high' | 'low' | 'mid'
}

export type PrioritizedCacheItem = CacheItem & { priority: number }

export type QueueItem = CacheItem & {
  priority: number
  reject: (reason?: Error) => void
  resolve: (value: ArrayBuffer | PromiseLike<ArrayBuffer>) => void
}

export interface StorageQuota {
  available: number
  quota: number
  usage: number
}
