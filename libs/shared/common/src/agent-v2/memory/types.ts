/**
 * Memory Module Types
 * Defines memory-related data structures for project context
 */

/**
 * Message in conversation
 */
export interface Message {
  content: string
  id: string
  metadata?: {
    confidence?: number
    intent?: string
  }
  role: 'assistant' | 'system' | 'user'
  timestamp: string
}

/**
 * Conversation Summary
 */
export interface ConversationSummary {
  filePath: string // "summaries/0-10.txt"
  generatedAt: string
  id: string
  messageRange: [number, number]
}

/**
 * Script Modification Record
 */
export interface ScriptModification {
  modification: string // User's modification request
  timestamp: string
}

/**
 * Project Metadata
 */
export interface ProjectMetadata {
  createdAt: string
  // Script context for regeneration
  originalUserRequest?: string // User's original project request (set once)
  projectId: string
  scriptModifications?: ScriptModification[] // History of script modification requests
  updatedAt: string

  userId: string

  version: number
  // Version pointers for each memory part
  versions: {
    conversation: number
    execution: number
    requirements: number
  }
}

/**
 * Conversation Memory
 */
export interface ConversationMemory {
  messages: Message[]
  // Statistics
  stats: {
    assistantMessages: number
    totalMessages: number
    userMessages: number
  }

  // Summary indices (actual content in summaries/ folder)
  summaries: ConversationSummary[]

  updatedAt: string

  version: number
}

/**
 * Requirements Memory
 */
export interface RequirementsMemory {
  // Change history
  changeLog: Array<{
    changedFields: string[]
    reason: string
    timestamp: string
    triggeredByMessage: string // message id
  }>
  // LLM-extracted structured requirements
  extracted: {
    // Custom fields
    [key: string]: unknown
    audioPrefs?: {
      backgroundMusic?: boolean
      voiceType?: string
    }
    duration?: number
    keyPoints?: string[]
    style?: string
    targetAudience?: string
    topic?: string
    visualStyle?: {
      colorScheme?: string
      pacing?: 'fast' | 'medium' | 'slow'
    }
  }

  updatedAt: string

  version: number
}

/**
 * Plan Reference
 */
export interface PlanReference {
  createdAt: string
  filePath: string // "plans/plan_v1.json"
  planId: string
  status: string
  version: number
}

/**
 * Tool Execution Record
 */
export interface ToolExecutionRecord {
  duration?: number
  executedAt: string
  planId: string
  status: 'failed' | 'success'
  toolName: string
}

/**
 * Execution Memory
 */
export interface ExecutionMemory {
  activePlanId?: string
  // Completed tool executions
  completedTools: ToolExecutionRecord[]

  // Plan history (only indices, details in plans/ directory)
  plans: PlanReference[]

  // Statistics
  stats: {
    completedPlans: number
    failedPlans: number
    totalPlans: number
    totalToolExecutions: number
  }

  updatedAt: string

  version: number
}

/**
 * Full Project Memory
 */
export interface ProjectMemory {
  conversation: ConversationMemory
  execution: ExecutionMemory
  metadata: ProjectMetadata
  requirements: RequirementsMemory
}
