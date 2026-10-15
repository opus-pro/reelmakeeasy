import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { MODELS_SCHEMA_PATH, serializeModelRegistryJsonSchema } from '../src/registry/json-schema'

const out = path.resolve(__dirname, '../../..', MODELS_SCHEMA_PATH)
writeFileSync(out, serializeModelRegistryJsonSchema())
console.log(`Wrote ${path.relative(process.cwd(), out)}`)
