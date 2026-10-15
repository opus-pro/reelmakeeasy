import { JobContext } from '../job-context'

/**
 * Derive breaker isolation scope from the current execution context.
 * Works in both workflow activity and API request contexts.
 *
 * Priority:
 * 1. aoProjectEnv (environment, e.g. "prod", "stg", "dev")
 * 2. "default" (fallback for tests / direct calls)
 */
export function resolveBreakerScope(): string {
  return JobContext.getFullContext({}).aoProjectEnv || 'default'
}
