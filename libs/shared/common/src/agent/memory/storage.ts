import { MemoryManager } from '../../agent-v2/memory/manager'
import { createStorage } from '../../agent-v2/storage/storage'

type AddMessageArgs = LegacyMemoryMessage

type GetMessagesArgs = {
  conversationId: string
  // Legacy callers sometimes pass these; we ignore them safely.
  limit?: number
  role?: LegacyMemoryMessage['role']
  userId?: string
}

type LegacyMemoryMessage = {
  content: string
  createdAt: string
  id: string
  role: 'assistant' | 'system' | 'user'
  type?: string
}

type StorageLike = {
  addMessage: (message: AddMessageArgs, conversationId: string) => Promise<void>
  clearMessages: (args: { conversationId: string }) => Promise<void>
  getMessages: (args: GetMessagesArgs) => Promise<LegacyMemoryMessage[]>
}

/**
 * Legacy Memory storage compatibility layer.
 *
 * Notes:
 * - VoltAgent Postgres storage has been removed.
 * - Agent V2 persists conversation memory in `workspace/context/memory/*` via `MemoryManager`.
 * - This wrapper keeps the old `MemoryStorage.getMessages/addMessage/clearMessages` call sites working.
 */
const createMemoryStorage = (): StorageLike => {
  return {
    async getMessages({
      conversationId,
      role,
      limit,
    }: GetMessagesArgs): Promise<LegacyMemoryMessage[]> {
      const manager = await MemoryManager.create(conversationId)
      const exists = await manager.exists().catch(() => false)
      if (!exists) {
        return []
      }

      const conversation = await manager.loadConversation().catch(() => null)
      const messages = conversation?.messages ?? []

      const filtered = messages
        .filter((m) => (role ? m.role === role : true))
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.timestamp,
          type: 'text',
        }))
      return typeof limit === 'number' && limit > 0 ? filtered.slice(-limit) : filtered
    },

    async addMessage(message: AddMessageArgs, conversationId: string): Promise<void> {
      const manager = await MemoryManager.create(conversationId)
      const exists = await manager.exists().catch(() => false)
      if (!exists) {
        // Best-effort initialization; userId is not always available at this call site.
        await manager.initialize('system', conversationId).catch(() => undefined)
      }

      await manager.appendMessage({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.createdAt || new Date().toISOString(),
      })
    },

    async clearMessages({ conversationId }: { conversationId: string }): Promise<void> {
      const manager = await MemoryManager.create(conversationId)
      const exists = await manager.exists().catch(() => false)
      if (!exists) {
        // If memory doesn't exist yet, nothing to clear.
        return
      }

      // Reset conversation.json while preserving metadata/requirements/execution.
      const storage = await createStorage(conversationId)
      const basePath = 'workspace/context/memory'
      const now = new Date().toISOString()
      const current = await manager.loadConversation().catch(() => null)
      const nextVersion = (current?.version ?? 0) + 1

      await storage.writeJsonFile(`${basePath}/conversation.json`, {
        version: nextVersion,
        updatedAt: now,
        messages: [],
        summaries: [],
        stats: {
          totalMessages: 0,
          userMessages: 0,
          assistantMessages: 0,
        },
      })
    },
  }
}

export const MemoryStorage: StorageLike = createMemoryStorage()
export const MemoryHistoryStorage: StorageLike = createMemoryStorage()

// Legacy export kept for compatibility.
export const MEMORY_LIMIT = 300
