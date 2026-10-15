import fs from 'node:fs'
import path from 'node:path'

import { type ModelRegistryFile, parseModelRegistry, stripMetaKeys } from './schema'

export const REPO_ROOT = path.resolve(__dirname, '../../../..')

export const readRootJson = (name: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, name), 'utf8')) as Record<string, unknown>

/** A fresh, stripped copy of the checked-in default registry, as plain JSON. */
// Tests mutate the raw JSON freely to build invalid files.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawJson = Record<string, any>

export const rawDefaults = (): RawJson =>
  stripMetaKeys(readRootJson('reelmakeeasy.models.json')) as RawJson

export const defaultRegistry = (): ModelRegistryFile =>
  parseModelRegistry(readRootJson('reelmakeeasy.models.json'))

export const quietLogger = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn() })
