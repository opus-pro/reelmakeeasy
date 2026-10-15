/**
 * Workflow ID builders.
 *
 * Convention:
 *   Project-scoped: ao:{projectId}:{domain}:{...parts}
 *   Global-scoped:  ao:{domain}:{...parts}
 *
 * Domains: agent, s2v, story-mode, motion, eval, system, demo, playground, growth
 */

/** Build a project-scoped workflow ID: `ao:{projectId}:{domain}:{...parts}` */
export function getWorkflowId(projectId: string, domain: string, ...parts: string[]): string {
  return parts.length > 0
    ? `ao:${projectId}:${domain}:${parts.join(':')}`
    : `ao:${projectId}:${domain}`
}

/** Build a global (non-project) workflow ID: `ao:{domain}:{...parts}` */
export function getGlobalWorkflowId(domain: string, ...parts: string[]): string {
  return parts.length > 0 ? `ao:${domain}:${parts.join(':')}` : `ao:${domain}`
}
