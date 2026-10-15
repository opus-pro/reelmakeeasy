/**
 * Shared "Carried over from previous video" prompt block.
 *
 * Single source of truth used by all four planner prompt builders
 * (monolithic + chain-mode across mode_confirmation + post_confirmation)
 * so the wording cannot drift between surfaces.
 *
 * The block is rendered into the system / stable-rules region of each
 * prompt and is framed as inheritable defaults the user may override.
 * Planner stable-rules sections add the explicit priority rules
 * (latest user prompt wins on conflict, absence is not a negative signal).
 *
 * Pure function: no SessionState traversal, no analytics, no I/O.
 * Returns the empty string when input is falsy so callers can blindly
 * concatenate without conditional branches at every call site.
 *
 */

/**
 * Build the canonical Remix carry-over prompt block.
 *
 * @param remixContext  The descriptive summary string seeded from
 *                      `SessionState.bootstrap.remix_context`. Null,
 *                      undefined, or empty / whitespace-only input
 *                      yields an empty string (no block rendered).
 * @returns             The Markdown carry-over section (a `##` heading
 *                      block) when input is meaningful, else `''`.
 */
export function buildRemixContextBlock(remixContext: null | string | undefined): string {
  if (!remixContext) {
    return ''
  }
  const trimmed = remixContext.trim()
  if (trimmed.length === 0) {
    return ''
  }
  return [
    '## Carried over from previous video',
    '',
    "(Background context from the user's previous Remix source. Treat as",
    'inheritable defaults the user may override based on their prompt and',
    'any messages they send. Absence of a field here is not a negative',
    'signal -- just no carried information.)',
    '',
    trimmed,
  ].join('\n')
}
