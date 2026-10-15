type Schema = Record<string, unknown>

const NULL_SCHEMA: Schema = { type: 'null' }
const COMBINATORS = ['anyOf', 'oneOf', 'allOf'] as const

const isRecord = (value: unknown): value is Schema =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isObjectSchema = (schema: Schema): boolean =>
  schema['type'] === 'object' || isRecord(schema['properties'])

/** True when the schema already accepts null. */
function allowsNull(schema: Schema): boolean {
  const type = schema['type']
  if (type === 'null' || (Array.isArray(type) && type.includes('null'))) return true
  const anyOf = schema['anyOf']
  return Array.isArray(anyOf) && anyOf.some((member) => isRecord(member) && allowsNull(member))
}

function strictNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictNode)
  if (!isRecord(node)) return node
  const { nullable, ...rest } = node
  const out: Schema = { ...rest }
  for (const key of COMBINATORS) {
    const members = out[key]
    if (Array.isArray(members)) out[key] = members.map(strictNode)
  }
  if (out['items'] !== undefined) out['items'] = strictNode(out['items'])
  // A record (`additionalProperties: <schema>`) can't be made strict; it stays as it is and
  // Codex rejects the schema, which the caller answers by retrying without one.
  if (isRecord(out['additionalProperties']))
    out['additionalProperties'] = strictNode(out['additionalProperties'])
  const properties = out['properties']
  if (isRecord(properties)) {
    const required = new Set(Array.isArray(out['required']) ? out['required'] : [])
    const strict: Schema = {}
    for (const [name, child] of Object.entries(properties)) {
      const node = strictNode(child)
      strict[name] = required.has(name) ? node : withNull(node)
    }
    out['properties'] = strict
    out['required'] = Object.keys(strict)
  }
  if (isObjectSchema(out) && !isRecord(out['additionalProperties']))
    out['additionalProperties'] = false
  return nullable === true ? withNull(out) : out
}

/** The schema, also accepting null: `type: [T, 'null']` for a plain primitive, else anyOf. */
function withNull(schema: unknown): unknown {
  if (!isRecord(schema) || allowsNull(schema)) return schema
  const constrained = schema['enum'] !== undefined || schema['const'] !== undefined
  const type = schema['type']
  const combinators = COMBINATORS.filter((key) => schema[key] !== undefined)
  if (combinators.length === 1 && combinators[0] === 'anyOf' && type === undefined)
    return { ...schema, anyOf: [...(schema['anyOf'] as unknown[]), NULL_SCHEMA] }
  if (!constrained && !combinators.length && typeof type === 'string' && type !== 'object')
    return { ...schema, type: [type, 'null'] }
  if (!constrained && !combinators.length && Array.isArray(type) && !type.includes('object'))
    return { ...schema, type: [...(type as unknown[]), 'null'] }
  return { anyOf: [schema, NULL_SCHEMA] }
}

/** OpenAI "strict" form: every object gets additionalProperties:false and requires all its
 *  properties; a property that was optional becomes nullable (type [T,'null'] or anyOf with
 *  {type:'null'}). openApi3's `nullable: true` is rewritten the same way. Pure; never
 *  mutates the input. */
export function strictifySchema(schema: Record<string, unknown>): Record<string, unknown> {
  return strictNode(schema) as Record<string, unknown>
}

function stripAllNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAllNulls)
  if (!isRecord(value)) return value
  const out: Schema = {}
  for (const [key, child] of Object.entries(value)) {
    if (child !== null) out[key] = stripAllNulls(child)
  }
  return out
}

/** The member of an anyOf/oneOf that describes `value`, or the schema itself. */
function pickSchema(value: unknown, schema: Schema): Schema | undefined {
  const members = (schema['anyOf'] ?? schema['oneOf']) as undefined | unknown[]
  if (!Array.isArray(members)) return schema
  const candidates = members.filter(isRecord)
  if (Array.isArray(value))
    return candidates.find((m) => m['type'] === 'array' || m['items'] !== undefined)
  if (!isRecord(value)) return undefined
  return candidates.find(
    (m) =>
      isRecord(m['properties']) &&
      Object.keys(value).every((key) => key in (m['properties'] as Schema)),
  )
}

function stripOptionalNulls(value: unknown, original: unknown): unknown {
  if (!isRecord(original)) return value
  const schema = pickSchema(value, original)
  if (!schema) return value
  if (Array.isArray(value)) return value.map((item) => stripOptionalNulls(item, schema['items']))
  const properties = schema['properties']
  if (!isRecord(value) || !isRecord(properties)) return value
  const required = new Set(Array.isArray(schema['required']) ? schema['required'] : [])
  const out: Schema = {}
  for (const [key, child] of Object.entries(value)) {
    if (child === null && !required.has(key)) continue
    out[key] = stripOptionalNulls(child, properties[key])
  }
  return out
}

/** Removes object keys whose value is null, recursively (arrays keep their items). Undoes the
 *  nullable-optional encoding so the original (loose) zod schema accepts the reply. Given the
 *  original schema, only optional properties lose their nulls, so a required `.nullable()`
 *  field keeps its null. */
export function stripNulls(value: unknown, originalSchema?: Record<string, unknown>): unknown {
  return originalSchema ? stripOptionalNulls(value, originalSchema) : stripAllNulls(value)
}
