/**
 * Generates `schemas/reelmakeeasy.models.schema.json` from the zod schema.
 * Regenerate with `pnpm exec nx run llm:generate-models-schema`.
 */
import zodToJsonSchema from 'zod-to-json-schema'

import { modelRegistrySchema } from './schema'

export const MODELS_SCHEMA_PATH = 'schemas/reelmakeeasy.models.schema.json'

type JsonNode = { [key: string]: unknown }

/**
 * The file allows `$schema` and `$comment` anywhere; the loader strips them.
 * Exempt `$`-keys from every object's `additionalProperties` rule.
 */
export function modelRegistryJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(modelRegistrySchema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as JsonNode
  allowMetaKeys(schema)
  const { $schema, ...rest } = schema
  return {
    $schema,
    $comment:
      'Generated from libs/llm/src/registry/schema.ts. Do not edit; run `pnpm exec nx run llm:generate-models-schema`.',
    title: 'ReelMakeEasy model registry',
    ...rest,
  }
}

function allowMetaKeys(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(allowMetaKeys)
  if (!node || typeof node !== 'object') return
  const obj = node as JsonNode
  if (obj['type'] === 'object' && 'additionalProperties' in obj) {
    obj['patternProperties'] = { '^\\$': {}, ...(obj['patternProperties'] as JsonNode | undefined) }
  }
  Object.values(obj).forEach(allowMetaKeys)
}

export const serializeModelRegistryJsonSchema = (): string =>
  `${JSON.stringify(modelRegistryJsonSchema(), null, 2)}\n`
