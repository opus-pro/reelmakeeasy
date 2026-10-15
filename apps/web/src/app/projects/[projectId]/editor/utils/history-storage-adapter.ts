import { Logger } from '@reelmakeeasy/common/utils/logger'

import type { EditorHistory } from '../stores/editor-history.store'

import { IndexedDBHistoryStorage } from './idb-history-storage'

const nsLogger = Logger.get('project.history-storage-adapter')

class MemoryStorage<T> {
  private cache = new Map<string, T>()

  clear(): void {
    this.cache.clear()
  }

  delete(projectId: string): void {
    this.cache.delete(projectId)
  }

  get(projectId: string): null | T {
    return this.cache.get(projectId) || null
  }

  getAll(): Record<string, T> {
    const result: Record<string, T> = {}
    for (const [projectId, history] of this.cache.entries()) {
      result[projectId] = history
    }
    return result
  }

  set(projectId: string, history: T): void {
    this.cache.set(projectId, history)
  }

  setAll(histories: Record<string, T>): void {
    this.cache.clear()
    for (const [projectId, history] of Object.entries(histories)) {
      this.cache.set(projectId, history)
    }
  }
}

export class HistoryStorageAdapter<T extends { past: unknown[] } = EditorHistory> {
  private enableIndexedDB: boolean
  private indexedDB: IndexedDBHistoryStorage<T>
  private initPromise: null | Promise<void> = null
  private isInitialized = false
  private memory: MemoryStorage<T>
  private useIndexedDB = true

  constructor(enableIndexedDB = true) {
    this.enableIndexedDB = enableIndexedDB
    this.indexedDB = new IndexedDBHistoryStorage<T>()
    this.memory = new MemoryStorage<T>()
    this.initPromise = this.initialize()
  }

  async cleanup(projectId: string, maxSnapshots: number): Promise<void> {
    if (this.useIndexedDB) {
      await this.ensureReady()
      await this.indexedDB.cleanup(projectId, maxSnapshots)
    }
  }

  clear(): void {
    this.memory.clear()

    if (this.useIndexedDB) {
      this.ensureReady().then(async () => {
        try {
          await this.indexedDB.clear()
        } catch (error) {
          nsLogger.error('Failed to clear IndexedDB:', error)
        }
      })
    }
  }

  getAll(): Record<string, T> {
    return this.memory.getAll()
  }

  async getAllAsync(): Promise<Record<string, T>> {
    await this.ensureReady()
    return this.memory.getAll()
  }

  isReady(): boolean {
    return this.isInitialized
  }

  isUsingIndexedDB(): boolean {
    return this.useIndexedDB
  }

  setAll(histories: Record<string, T>): void {
    this.memory.setAll(histories)

    if (this.useIndexedDB) {
      this.ensureReady().then(async () => {
        try {
          await this.indexedDB.setAll(histories)
        } catch (error) {
          nsLogger.error('Failed to persist to IndexedDB:', error)
        }
      })
    }
  }

  async waitForInitialization(): Promise<void> {
    await this.ensureReady()
  }

  private async ensureReady(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise
    }
  }

  private async initialize(): Promise<void> {
    if (!this.enableIndexedDB) {
      this.useIndexedDB = false
      this.isInitialized = true
      return
    }

    this.useIndexedDB = this.indexedDB.isSupported() && (await this.indexedDB.isReady())

    if (!this.useIndexedDB) {
      nsLogger.warn('IndexedDB not available, using memory-only mode')
      this.isInitialized = true
      return
    }

    try {
      const data = await this.indexedDB.getAll()
      this.memory.setAll(data)
    } catch (error) {
      nsLogger.error('Failed to load data from IndexedDB during initialization:', error)
    } finally {
      this.isInitialized = true
    }
  }
}
