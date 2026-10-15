/**
 * Memory Manager
 * Manages project memory with split files for better performance
 */

import { isAgentV2 } from '../../constant/agent-v2'
import { ProjectStore } from '../storage/project-store'
import { LocalStorage } from '../storage/local-storage'
import type { Storage } from '../storage/storage'
import { createStorage } from '../storage/storage'
import type { ToolResult } from '../tool/internal/types'

import type {
  ConversationMemory,
  ExecutionMemory,
  Message,
  ProjectMemory,
  ProjectMetadata,
  RequirementsMemory,
  ScriptModification,
  ToolExecutionRecord,
} from './types'

/**
 * Memory Manager
 * Manages split memory files in workspace/context/memory/
 */
export class MemoryManager {
  private basePath: string
  private storage: Storage

  /**
   * @deprecated Use MemoryManager.create() instead for proper eval sandbox support
   */
  constructor(projectId: string, storage?: Storage) {
    // Use provided storage or fallback to default (without eval sandbox support)
    // For eval sandbox support, use MemoryManager.create() which calls createStorage()
    this.storage =
      storage ?? (isAgentV2() ? new ProjectStore(projectId) : new LocalStorage(projectId))

    this.basePath = 'workspace/context/memory'
  }

  /**
   * Create a MemoryManager instance with proper storage (supports eval sandbox)
   * This is the preferred way to create MemoryManager as it respects JobContext's
   * sandboxId and evalMode for eval isolation.
   */
  static async create(projectId: string): Promise<MemoryManager> {
    const storage = await createStorage(projectId)
    return new MemoryManager(projectId, storage)
  }

  // ========== Read Operations ==========

  /**
   * Add script modification request to history
   */
  async addScriptModification(modification: string): Promise<void> {
    const meta = await this.loadMetadata()
    if (!meta.scriptModifications) {
      meta.scriptModifications = []
    }
    const record: ScriptModification = {
      timestamp: new Date().toISOString(),
      modification,
    }
    meta.scriptModifications.push(record)
    meta.version++
    meta.updatedAt = new Date().toISOString()
    await this.storage.writeJsonFile(`${this.basePath}/metadata.json`, meta)
  }

  /**
   * Add summary reference
   */
  async addSummaryReference(summary: ConversationMemory['summaries'][0]): Promise<void> {
    const conv = await this.loadConversation()
    conv.summaries.push(summary)
    conv.version++
    conv.updatedAt = new Date().toISOString()

    await this.storage.writeJsonFile(`${this.basePath}/conversation.json`, conv)
    await this.updateMetadataVersion('conversation', conv.version)
  }

  /**
   * Append new message
   */
  async appendMessage(message: Message): Promise<void> {
    const conv = await this.loadConversation()

    conv.messages.push(message)
    conv.version++
    conv.updatedAt = new Date().toISOString()
    conv.stats.totalMessages++
    if (message.role === 'user') {
      conv.stats.userMessages++
    }
    if (message.role === 'assistant') {
      conv.stats.assistantMessages++
    }

    await this.storage.writeJsonFile(`${this.basePath}/conversation.json`, conv)
    await this.updateMetadataVersion('conversation', conv.version)
  }

  /**
   * Clean up local cache after activity completes
   * Call this in finally block to ensure cleanup
   */
  async cleanupLocalCache(): Promise<void> {
    await this.storage.cleanupLocalCache?.()
  }

  /**
   * Check if memory exists
   */
  async exists(): Promise<boolean> {
    return await this.storage.exists(`${this.basePath}/metadata.json`)
  }

  /**
   * Get the latest script modification (if any)
   */
  async getLatestScriptModification(): Promise<string | undefined> {
    const modifications = await this.getScriptModifications()
    if (modifications.length === 0) {
      return undefined
    }
    return modifications.at(-1)?.modification
  }

  // ========== Write Operations ==========

  /**
   * Get original user request
   */
  async getOriginalUserRequest(): Promise<string | undefined> {
    const meta = await this.loadMetadata()
    return meta.originalUserRequest
  }

  /**
   * Get all script modifications
   */
  async getScriptModifications(): Promise<ScriptModification[]> {
    const meta = await this.loadMetadata()
    return meta.scriptModifications || []
  }

  /**
   * Initialize memory structure for new project
   */
  async initialize(userId: string, projectId: string): Promise<void> {
    const now = new Date().toISOString()

    await Promise.all([
      // metadata.json
      this.storage.writeJsonFile(`${this.basePath}/metadata.json`, {
        projectId,
        userId,
        version: 1,
        createdAt: now,
        updatedAt: now,
        versions: {
          conversation: 1,
          requirements: 1,
          execution: 1,
        },
      } as ProjectMetadata),

      // conversation.json
      this.storage.writeJsonFile(`${this.basePath}/conversation.json`, {
        version: 1,
        updatedAt: now,
        messages: [],
        summaries: [],
        stats: {
          totalMessages: 0,
          userMessages: 0,
          assistantMessages: 0,
        },
      } as ConversationMemory),

      // requirements.json
      this.storage.writeJsonFile(`${this.basePath}/requirements.json`, {
        version: 1,
        updatedAt: now,
        extracted: {},
        changeLog: [],
      } as RequirementsMemory),

      // execution.json
      this.storage.writeJsonFile(`${this.basePath}/execution.json`, {
        version: 1,
        updatedAt: now,
        plans: [],
        completedTools: [],
        stats: {
          totalPlans: 0,
          completedPlans: 0,
          failedPlans: 0,
          totalToolExecutions: 0,
        },
      } as ExecutionMemory),
    ])
  }

  async loadConversation(): Promise<ConversationMemory> {
    return await this.storage.readJsonFile<ConversationMemory>(`${this.basePath}/conversation.json`)
  }

  async loadExecution(): Promise<ExecutionMemory> {
    return await this.storage.readJsonFile<ExecutionMemory>(`${this.basePath}/execution.json`)
  }

  /**
   * Load full memory (all parts)
   */
  async loadFullMemory(): Promise<ProjectMemory> {
    const [metadata, conversation, requirements, execution] = await Promise.all([
      this.loadMetadata(),
      this.loadConversation(),
      this.loadRequirements(),
      this.loadExecution(),
    ])

    return { metadata, conversation, requirements, execution }
  }

  async loadMetadata(): Promise<ProjectMetadata> {
    return await this.storage.readJsonFile<ProjectMetadata>(`${this.basePath}/metadata.json`)
  }

  async loadRequirements(): Promise<RequirementsMemory> {
    return await this.storage.readJsonFile<RequirementsMemory>(`${this.basePath}/requirements.json`)
  }

  /**
   * Load summary text file
   */
  async loadSummary(summaryId: string): Promise<string> {
    return await this.storage.readTextFile(`${this.basePath}/summaries/${summaryId}.txt`)
  }

  /**
   * Load tool cache
   */
  async loadToolCache<T = unknown>(
    toolName: string,
    cacheKey: string,
  ): Promise<null | ToolResult<T>> {
    const filePath = `${this.basePath}/cache/${toolName}/${cacheKey}.json`
    return await this.storage.readJsonFile<ToolResult<T>>(filePath).catch(() => null)
  }

  /**
   * Record new plan
   */
  async recordPlan(planId: string, planVersion: number, status: string): Promise<void> {
    const exec = await this.loadExecution()

    exec.plans.push({
      planId,
      version: planVersion,
      status,
      createdAt: new Date().toISOString(),
      filePath: `plans/plan_v${planVersion}.json`,
    })

    exec.activePlanId = planId
    exec.stats.totalPlans++
    exec.version++
    exec.updatedAt = new Date().toISOString()

    await this.storage.writeJsonFile(`${this.basePath}/execution.json`, exec)
    await this.updateMetadataVersion('execution', exec.version)
  }

  /**
   * Record tool execution
   */
  async recordToolExecution(record: ToolExecutionRecord): Promise<void> {
    const exec = await this.loadExecution()

    exec.completedTools.push(record)
    exec.stats.totalToolExecutions++
    exec.version++
    exec.updatedAt = new Date().toISOString()

    await this.storage.writeJsonFile(`${this.basePath}/execution.json`, exec)
    await this.updateMetadataVersion('execution', exec.version)
  }

  /**
   * Save summary
   */
  async saveSummary(summaryId: string, content: string): Promise<void> {
    await this.storage.writeFile(`${this.basePath}/summaries/${summaryId}.txt`, content)
  }

  /**
   * Save tool cache
   */
  async saveToolCache(toolName: string, cacheKey: string, output: ToolResult): Promise<void> {
    const filePath = `${this.basePath}/cache/${toolName}/${cacheKey}.json`
    await this.storage.writeJsonFile(filePath, output)
  }

  /**
   * Set original user request (called once when project is created)
   * This is the user's first request that initiated the project
   */
  async setOriginalUserRequest(request: string): Promise<void> {
    const meta = await this.loadMetadata()
    if (!meta.originalUserRequest) {
      // Only set once - don't overwrite
      meta.originalUserRequest = request
      meta.version++
      meta.updatedAt = new Date().toISOString()
      await this.storage.writeJsonFile(`${this.basePath}/metadata.json`, meta)
    }
  }

  /**
   * Update plan status
   */
  async updatePlanStatus(planId: string, status: string): Promise<void> {
    const exec = await this.loadExecution()

    const plan = exec.plans.find((p) => p.planId === planId)
    if (plan) {
      plan.status = status
      exec.version++
      exec.updatedAt = new Date().toISOString()

      // Update stats
      if (status === 'completed') {
        exec.stats.completedPlans++
      } else if (status === 'failed') {
        exec.stats.failedPlans++
      }

      await this.storage.writeJsonFile(`${this.basePath}/execution.json`, exec)
      await this.updateMetadataVersion('execution', exec.version)
    }
  }

  // ========== Private Helpers ==========

  /**
   * Update requirements
   */
  async updateRequirements(
    updates: Partial<RequirementsMemory['extracted']>,
    reason: string,
    messageId: string,
  ): Promise<void> {
    const req = await this.loadRequirements()

    // Record change
    const changedFields = Object.keys(updates)
    req.changeLog.push({
      timestamp: new Date().toISOString(),
      changedFields,
      reason,
      triggeredByMessage: messageId,
    })

    // Apply changes
    Object.assign(req.extracted, updates)
    req.version++
    req.updatedAt = new Date().toISOString()

    await this.storage.writeJsonFile(`${this.basePath}/requirements.json`, req)
    await this.updateMetadataVersion('requirements', req.version)
  }

  private async updateMetadataVersion(
    part: keyof ProjectMetadata['versions'],
    version: number,
  ): Promise<void> {
    const meta = await this.loadMetadata()
    meta.versions[part] = version
    meta.version++
    meta.updatedAt = new Date().toISOString()

    await this.storage.writeJsonFile(`${this.basePath}/metadata.json`, meta)
  }
}
