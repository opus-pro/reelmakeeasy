/**
 * Execution mode and context types
 */

/**
 * Activity dependencies that can be injected into tool-impl execution context
 * These dependencies are available in both Local and Workflow modes
 */
export interface ActivityDependencies {
  [key: string]: unknown
  db?: unknown
  s3?: unknown
}

/**
 * Tool execution mode
 * - local: Execute directly in local environment
 * - workflow: Wrap as a workflow (supports long-running work)
 * - pipeline: Composed of multiple steps
 */
export type ToolExecutionMode = 'local' | 'pipeline' | 'workflow'

/**
 * Invocation mode
 * - sync: Synchronous call (blocking)
 * - async: Asynchronous call (returns Promise)
 * - fire_and_forget: Trigger without waiting for result
 */
export type ToolInvocationMode = 'async' | 'fire_and_forget' | 'sync'

/**
 * Tool execution context
 * Provided to tool-impl implementation
 * Unified interface that works in both Local and Workflow modes
 */
export interface ToolExecutionContext<TInput = unknown> {
  // ===== Basic Information (available in both modes) =====

  /**
   * Abort signal for cancellation
   * - Local mode: uses AbortController
   * - Workflow mode: connected to workflow cancellation
   */
  abortSignal: AbortSignal

  /** Current attempt number (1-based) */
  attempt: number

  /** Optional correlation ID for tracing */
  correlationId?: string

  /**
   * Injected dependencies
   * Access via getDependency() for type safety
   */
  dependencies: ActivityDependencies

  // ===== Project Context (available in both modes) =====

  /** Execution mode (local or workflow) */
  executionMode: ToolExecutionMode

  /**
   * Get typed dependency
   * @throws Error if dependency not found
   */
  getDependency<T = unknown>(key: string): T

  // ===== Dependency Access (available in both modes) =====

  /** Input parameters */
  input: TInput

  /** Unique invocation ID (runId) */
  invocationId: string

  // ===== Cancellation Support (available in both modes) =====

  /**
   * Check if operation has been cancelled
   */
  isCancelled(): boolean

  /**
   * Structured logger
   * - Local mode: uses pino logger
   * - Workflow mode: uses the activity logger
   */
  logger: {
    debug(message: string, meta?: Record<string, unknown>): void
    error(message: string, meta?: Record<string, unknown>): void
    info(message: string, meta?: Record<string, unknown>): void
    warn(message: string, meta?: Record<string, unknown>): void
  }

  /**
   * Original execution options (including previousResults, userQuery, etc.)
   */
  options?: {
    previousResults?: Array<Record<string, unknown> & { toolName: string }>
    userIntent?: string
    userQuery?: string
  }

  /** Organization ID (optional) */
  orgId?: string

  /** Project ID */
  projectId: string

  /**
   * Throw error if cancelled
   * @throws Error if operation has been cancelled
   */
  throwIfCancelled(): void

  /** User email */
  userEmail: string

  /** User ID */
  userId: string

  /**
   * Workflow-specific capabilities
   * Only available in workflow mode
   */
  workflow?: {
    executeActivity<T>(activityType: string, args: unknown[]): Promise<T>
    sleep(durationMs: number): Promise<void>
    startChildWorkflow<T>(workflowType: string, args: unknown[]): Promise<T>
  }
}
