/**
 * Core types for tools framework
 */

import { ProjectTier } from '@shared/types/api/project'
import { DebugSettings } from '@shared/types/project/debug-settings'

import { ToolExecutionMode } from './execution'

/**
 * Workflow configuration
 */
export interface WorkflowConfig {
  retry?: {
    backoff?: {
      initialDelay?: number
      maxDelay?: number
      type: 'exponential' | 'fixed'
    }
    enabled: boolean
    maxAttempts?: number
  }
  taskQueue?: string
  timeout?: {
    execution?: number
    task?: number
  }
  /**
   * Custom workflow ID
   * If not provided, will default to ao:{toolName}:{runId}
   */
  workflowId?: string
  workflowIdConflictPolicy?: 'fail' | 'terminate_existing' | 'use_existing'
  workflowIdReusePolicy?: 'allow_duplicate' | 'allow_duplicate_failed_only' | 'reject_duplicate'
  /**
   * Workflow type name (for AutoWorkflowTool)
   * If not provided, will default to 'AutoToolWorkflow'
   */
  workflowType?: string
}

/**
 * Standard tool-impl dependencies that can be injected
 */
export interface StandardToolDependencies {
  [key: string]: unknown

  cache?: unknown
  db?: unknown
  logger?: unknown
  s3?: unknown
}

/**
 * Local tool-impl retry strategy
 */
export interface LocalRetryStrategy {
  backoffFactor?: number
  enabled: boolean
  initialDelayMs?: number
  maxAttempts?: number
  maxDelayMs?: number
  retriableErrorNames?: string[]
  shouldRetry?: (error: unknown, attempt: number) => boolean
}

/**
 * Tool cache options
 */
export interface ToolCacheOptions {
  /**
   * Keys to ignore from input when generating cache key
   * Applied to top-level keys only
   */
  ignoreKeys?: string[]
  /**
   * Cache Time To Live in seconds
   * If 0 or undefined, cache never expires (unless evicted)
   */
  ttlSeconds?: number
}

/**
 * Local tool metadata
 */
export interface LocalToolMetadata {
  /**
   * Whether to enable automatic caching for this tool
   * If true, results will be cached based on input hash and reused on subsequent runs
   * Default: true
   */
  cacheable?: boolean
  /**
   * Cache configuration options
   */
  cacheOptions?: ToolCacheOptions
  category?: string
  /**
   * Message to display after successful tool completion
   * Will be shown as a reasoning chunk with checkmark
   * Example: "Generated video script successfully"
   */
  completionMessage?: string
  description?: string
  /**
   * Estimated duration in minutes for this tool execution
   * Used for progress calculation
   */
  estimatedDurationMinutes?: number
  invocationMode?: 'async' | 'sync'
  name: string
  retry?: LocalRetryStrategy
  timeout?: {
    execution?: number
    total?: number
  }
}

/**
 * Auto Workflow Tool metadata
 * For tools that automatically wrap run() method as a workflow
 */
export interface AutoWorkflowToolMetadata {
  /**
   * Whether to enable automatic caching for this tool
   * Default: true
   */
  cacheable?: boolean
  /**
   * Cache configuration options
   */
  cacheOptions?: ToolCacheOptions
  category?: string
  description?: string
  invocationMode?: 'async' | 'sync'
  name: string
  workflowConfig: WorkflowConfig
}

/**
 * Project Preference
 * Project-level configuration and metadata passed to tools via ToolContext
 * Contains user selections (avatar, voice, style) and uploaded files
 */
export interface ProjectPreference {
  avatarId?: string
  blockedSites?: string[]
  createdAt: number // Project creation timestamp (milliseconds)
  debugSettings?: DebugSettings
  enableCaption?: boolean
  hookTemplateName?: string
  initPrompt?: string
  modelSwitch?: Record<string, Record<string, string>>
  projectTier?: ProjectTier
  /**
   * Regeneration token for cache invalidation.
   * When provided, planners will check if `regeneration_marker/{regenerationToken}.json` exists.
   * If not exists, checkCompleted will return false (ignore cache).
   */
  regenerationToken?: string
  script?: string
  stage?: string
  styleId?: string
  uploadedFiles?: Array<{
    id: string
    mime: string
    name: null | string
    previewImageUrl: null | string
    uri: string
  }>
  voiceId?: string
  voiceName?: string
  voiceType?: string
  youtubeFilter?: string
}

/**
 * Workflow Tool metadata
 * For tools with user-defined workflows and activities
 */
export interface WorkflowToolMetadata {
  /**
   * Whether to enable automatic caching for this tool
   * Default: true
   */
  cacheable?: boolean
  /**
   * Cache configuration options
   */
  cacheOptions?: ToolCacheOptions
  category?: string
  description?: string
  invocationMode?: 'async' | 'sync'
  name: string
  taskQueue?: string
}

/**
 * Phase-level shared context
 * - Initialized by the first tool in the phase
 * - Persisted and reused by subsequent tools in the same phase
 * - MUST contain 'name' field with the agent/phase name (e.g., 'Researcher', 'Hook Designer')
 */
export interface PhaseContext extends Record<string, unknown> {
  name: string
}

/**
 * Activity execution metadata
 * Only present when tool is executed as an activity
 */
export interface ActivityInfo {
  /**
   * Current attempt number (1-based)
   * Example: 1 for first attempt, 2 for first retry, etc.
   */
  attempt: number
  /**
   * Whether this is the last attempt based on retry configuration
   * Used to determine if onError or onFinalError should be called
   */
  isLastAttempt: boolean
}

export interface EvalToolContext {
  evalMode?: boolean
  /** sandboxId is used by eval framework to ensure consistent local cache paths */
  sandboxId?: string
}
/**
 * Tool Execution Context
 */
export interface ToolContext extends EvalToolContext {
  /**
   * Activity execution metadata (only present when executed as an activity)
   * Contains attempt number and retry information
   */
  activityInfo?: ActivityInfo
  orgId?: string

  /**
   * Variables shared across the phase
   */
  phaseContext: PhaseContext
  /**
   * Results from previous level tools
   * Each item contains the tool-impl result spread at top level with toolName
   */
  previousResults?: Array<Record<string, unknown> & { toolName: string }>
  projectId: string
  projectPref?: ProjectPreference
  runId: string
  userEmail: string
  userId: string
  userQuery: string
}

/**
 * Tool execution result - unified return structure
 */
export interface ToolResult<TData = unknown> {
  /** Execution metadata */
  _meta?: {
    attempts: number
    durationMs: number
    executionMode: ToolExecutionMode
    extras?: Record<string, unknown>
    invocationId: string
    timestamp?: number
  }
  /** Modified phase context (if tool modified it during execution) */
  _phaseContext?: Record<string, unknown>
  /** Business data */
  data?: TData
  /** Error info (only when status is error) */
  error?: {
    category: string
    cause?: unknown
    code: string
    isUserFacing?: boolean
    message: string
    retriable: boolean
    tag?: string
  }
  /** Human-readable message */
  message?: string
  /** Execution status */
  status: 'error' | 'success'
}

/**
 * Validation result
 */
export interface ValidationResult<T = unknown> {
  data?: T
  error?: {
    code: string
    message: string
  }
  success: boolean
}
