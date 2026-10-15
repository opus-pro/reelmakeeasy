/**
 * Planner logging helpers.
 *
 * Every UIP planner log line should end up in the log viewer's "Message"
 * column with enough inline context to be self-describing. Log viewers render
 * `msg` (pino's final message string) in the Message column but often do NOT
 * show structured pino fields there by default, so a log call like
 *
 *   logger.info({ tool, params }, '[user-intent-planner][...] [tag]')
 *
 * appears in the log viewer as just `[user-intent-planner][...] [tag]` -- which is
 * what we had before and is almost useless when you are paging through log
 * results trying to debug a stuck session.
 *
 * Long-take activities get around this by JSON-stringifying their context
 * into the message itself (see `formatLogFields` in
 * `long-take-generation-record-staging.ts` and the many
 * `[long-take] ... ${formatLogFields({...})}` call sites). We mirror that
 * pattern here.
 *
 * Use `plannerLog(sessionId, '[tag]', { ...context })` to build the message
 * string. Pino fields (first arg) should then be left empty; projectId /
 * userId / userEmail structured fields are already injected by the workflow
 * via `setWorkflowScopedContext`, so dropping the pino-field object does not
 * cost us field-based log searches.
 */

const UIP_LOG_PREFIX = '[user-intent-planner]'

/** Prefix used by every UIP planner log: `[user-intent-planner][sessionid:<id>]`. */
export function sessionLogPrefix(sessionId: string): string {
  return `${UIP_LOG_PREFIX}[sessionid:${sessionId}]`
}

/**
 * JSON-stringify a fields object for inclusion in a log message. Falls back
 * to `String(fields)` on circular references so logging never throws.
 */
export function formatLogFields(fields: Record<string, unknown>): string {
  try {
    return JSON.stringify(fields)
  } catch {
    return String(fields)
  }
}

/**
 * Build a single-line log message that combines the UIP session prefix, a
 * short bracketed tag, and a JSON-serialized context object. Example:
 *
 *   plannerLog('abc', '[planner.tool.execute.start]', { tool: 'x' })
 *     -> '[user-intent-planner][sessionid:abc] [planner.tool.execute.start] {"tool":"x"}'
 *
 * If `fields` is undefined, empty, or serializes to an empty object the
 * JSON suffix is omitted so trivial logs stay readable.
 */
export function plannerLog(
  sessionId: string,
  tag: string,
  fields?: Record<string, unknown>,
): string {
  const base = `${sessionLogPrefix(sessionId)} ${tag}`
  if (!fields) {
    return base
  }
  const keys = Object.keys(fields)
  if (keys.length === 0) {
    return base
  }
  return `${base} ${formatLogFields(fields)}`
}
