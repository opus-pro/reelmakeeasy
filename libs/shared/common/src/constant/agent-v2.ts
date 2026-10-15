/**
 * Agent V2 (HITL + Engine) Constants and Utilities
 */

/**
 * Environment variable name for enabling Agent V2 mode
 * When set to 'true', uses HITL + Engine architecture with the file store
 * When not set or 'false', uses V1 Director architecture with local storage
 */
export const ENV_AGENT_V2 = 'AO_V2'

/**
 * Check if running in agent V2 mode (the file store)
 *
 * @returns true if agent V2 mode is enabled (AO_V2='true'), false otherwise (local mode)
 *
 * @example
 * ```typescript
 * if (isAgentV2()) {
 *   // Use the file store
 *   const storage = await createStorage(projectId)
 *   await storage.writeFile(relativePath, content)
 * } else {
 *   // Use local filesystem
 *   await fs.writeFile(absolutePath, content)
 * }
 * ```
 */
export function isAgentV2(): boolean {
  return process.env[ENV_AGENT_V2] === 'true'
}
