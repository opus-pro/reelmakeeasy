import { Logger } from '@reelmakeeasy/common/utils/logger'
import { type IDBPDatabase, openDB } from 'idb'

import type { EditorHistory } from '../stores/editor-history.store'

const nsLogger = Logger.get('project.idb-history-storage')

const DB_NAME = 'editor-history-db'
const DB_VERSION = 1
const STORE_NAME = 'histories'

interface HistoryRecord<T> {
  history: T
  projectId: string
  timestamp: number
}

export class IndexedDBHistoryStorage<T extends { past: unknown[] } = EditorHistory> {
  private db: IDBPDatabase | null = null
  private initPromise: null | Promise<boolean> = null

  constructor() {
    this.initPromise = this.initialize()
  }

  async cleanup(projectId: string, maxSnapshots: number): Promise<void> {
    const ready = await this.isReady()
    if (!ready || !this.db) {
      return
    }

    try {
      const history = await this.get(projectId)
      if (!history) {
        return
      }

      const totalSnapshots = history.past.length + 1

      if (totalSnapshots > maxSnapshots) {
        const excessCount = totalSnapshots - maxSnapshots
        history.past = history.past.slice(excessCount)
        await this.set(projectId, history)
      }
    } catch (error) {
      nsLogger.error(`Failed to cleanup history for project ${projectId}:`, error)
    }
  }

  async clear(): Promise<void> {
    const ready = await this.isReady()
    if (!ready || !this.db) {
      return
    }

    try {
      await this.db.clear(STORE_NAME)
    } catch (error) {
      nsLogger.error('Failed to clear histories:', error)
    }
  }

  async delete(projectId: string): Promise<void> {
    const ready = await this.isReady()
    if (!ready || !this.db) {
      return
    }

    try {
      await this.db.delete(STORE_NAME, projectId)
    } catch (error) {
      nsLogger.error(`Failed to delete history for project ${projectId}:`, error)
    }
  }

  async get(projectId: string): Promise<null | T> {
    const ready = await this.isReady()
    if (!ready || !this.db) {
      return null
    }

    try {
      const record = (await this.db.get(STORE_NAME, projectId)) as HistoryRecord<T> | undefined
      return record?.history || null
    } catch (error) {
      nsLogger.error(`Failed to get history for project ${projectId}:`, error)
      return null
    }
  }

  async getAll(): Promise<Record<string, T>> {
    const ready = await this.isReady()
    if (!ready || !this.db) {
      return {}
    }

    try {
      const records = (await this.db.getAll(STORE_NAME)) as HistoryRecord<T>[]
      const result: Record<string, T> = {}

      for (const record of records) {
        result[record.projectId] = record.history
      }

      return result
    } catch (error) {
      nsLogger.error('Failed to get all histories:', error)
      return {}
    }
  }

  async isReady(): Promise<boolean> {
    if (!this.initPromise) {
      this.initPromise = this.initialize()
    }
    return this.initPromise
  }

  isSupported(): boolean {
    return typeof indexedDB !== 'undefined'
  }

  async set(projectId: string, history: T): Promise<void> {
    const ready = await this.isReady()
    if (!ready || !this.db) {
      throw new Error('IndexedDB is not available')
    }

    try {
      const record: HistoryRecord<T> = {
        projectId,
        history,
        timestamp: Date.now(),
      }
      await this.db.put(STORE_NAME, record)
    } catch (error) {
      nsLogger.error(`Failed to set history for project ${projectId}:`, error)
      throw error
    }
  }

  async setAll(histories: Record<string, T>): Promise<void> {
    const ready = await this.isReady()
    if (!ready || !this.db) {
      throw new Error('IndexedDB is not available')
    }

    try {
      const tx = this.db.transaction(STORE_NAME, 'readwrite')
      const promises: Promise<IDBValidKey>[] = []

      for (const [projectId, history] of Object.entries(histories)) {
        const record: HistoryRecord<T> = {
          projectId,
          history,
          timestamp: Date.now(),
        }
        promises.push(tx.store.put(record))
      }

      await Promise.all([...promises, tx.done])
    } catch (error) {
      nsLogger.error('Failed to set all histories:', error)
      throw error
    }
  }

  private async initialize(): Promise<boolean> {
    if (!this.isSupported()) {
      nsLogger.warn('IndexedDB is not supported')
      return false
    }

    try {
      this.db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'projectId' })
            store.createIndex('timestamp', 'timestamp')
          }
        },
      })
      return true
    } catch (error) {
      nsLogger.error('Failed to initialize IndexedDB:', error)
      return false
    }
  }
}
