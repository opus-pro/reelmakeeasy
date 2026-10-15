/**
 * Claude's structured output takes only a JSON schema whose top level is an object (the API
 * answers 400 otherwise, and the SDK still reports the turn as a success with that error as
 * its text). A schema with another top level (an array, an anyOf) is sent wrapped as
 * `{ value: <schema> }` and the answer unwrapped.
 */
export function claudeOutputSchema(schema: Record<string, unknown>): {
  schema: Record<string, unknown>
  unwrap: (output: unknown) => unknown
} {
  if (schema['type'] === 'object') return { schema, unwrap: (output) => output }
  return {
    schema: { properties: { value: schema }, required: ['value'], type: 'object' },
    unwrap: (output) => (output as null | { value?: unknown })?.value,
  }
}

/** A finished query's structured answer as JSON text; throws when there is none (the reply
 *  text then says why, e.g. an API error). */
export function structuredAnswer(
  result: Record<string, unknown>,
  unwrap: (output: unknown) => unknown,
): string {
  const output =
    result['structured_output'] === undefined ? undefined : unwrap(result['structured_output'])
  if (output === undefined)
    throw new Error(
      `Claude gave no structured answer: ${String(result['result'] ?? '').slice(0, 300)}`,
    )
  return JSON.stringify(output)
}
