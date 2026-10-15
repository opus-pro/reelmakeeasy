import { z, type ZodRawShape, type ZodTypeAny } from 'zod'

type Prop = Record<string, unknown>

function numberOf(p: Prop): ZodTypeAny {
  let n = p['type'] === 'integer' ? z.number().int() : z.number()
  if (typeof p['minimum'] === 'number') n = n.min(p['minimum'])
  if (typeof p['maximum'] === 'number') n = n.max(p['maximum'])
  return n
}

function propToZod(name: string, p: Prop): ZodTypeAny {
  let out: ZodTypeAny
  if (p['type'] === 'string' && Array.isArray(p['enum'])) {
    out = z.enum(p['enum'] as [string, ...string[]])
  } else if (p['type'] === 'string') {
    out = z.string()
  } else if (p['type'] === 'number' || p['type'] === 'integer') {
    out = numberOf(p)
  } else if (p['type'] === 'boolean') {
    out = z.boolean()
  } else {
    throw new Error(`Tool property "${name}" has a type the Claude bridge does not convert`)
  }
  return typeof p['description'] === 'string' ? out.describe(p['description']) : out
}

/** A ReelMakeEasy tool's JSON Schema (a flat object of strings, enums, numbers and booleans) as
 *  the zod shape the Agent SDK's `tool()` takes. Throws on anything else, so a new tool with a
 *  richer schema fails its test instead of reaching Claude half-described. */
export function jsonSchemaToZodShape(schema: Record<string, unknown>): ZodRawShape {
  const props = (schema['properties'] ?? {}) as Record<string, Prop>
  const required = new Set((schema['required'] as string[] | undefined) ?? [])
  const shape: ZodRawShape = {}
  for (const [name, p] of Object.entries(props)) {
    const t = propToZod(name, p)
    shape[name] = required.has(name) ? t : t.optional()
  }
  return shape
}
