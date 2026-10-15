/**
 * Loads `reelmakeeasy.models.json`, applies env overrides and caches the result.
 * Node only.
 */
import fs from 'node:fs'
import path from 'node:path'

// The registry fallback when no file is found at runtime; esbuild inlines it into the API bundle.
// eslint-disable-next-line @nx/enforce-module-boundaries
import bundledModels from '../../../../reelmakeeasy.models.json'
import { llmConfig } from '../config'

import { currentGenerationProvider } from './generation-provider'
import { legacyTarget } from './legacy'
import {
  adHocEntry,
  adHocWarning,
  createModelResolver,
  matchModel,
  type ModelResolver,
} from './resolve'
import {
  ModelRegistryError,
  type ModelRegistryFile,
  parseModelRegistry,
  type Role,
  ROLE_KIND,
  ROLES,
} from './schema'

export const MODELS_FILE_NAME = 'reelmakeeasy.models.json'

export interface LoadedModelRegistry {
  registry: ModelRegistryFile
  /** The file path, or `bundled defaults`. */
  source: string
}

export interface LoadModelRegistryOptions {
  /** Where to start looking for `reelmakeeasy.models.json`. Defaults to `process.cwd()`. */
  cwd?: string
  env?: NodeJS.ProcessEnv
  logger?: LoaderLogger
}

interface LoaderLogger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
}

/** `video.firstLast` becomes `VIDEO_FIRSTLAST_MODEL`. */
export const roleEnvVar = (role: Role): string => `${role.toUpperCase().replace(/\./g, '_')}_MODEL`

/** Compatibility variables that set several roles at once. Role variables win over these. */
const GROUP_VARS: Record<string, Role[]> = {
  IMAGE_MODEL: ['image.generate', 'image.edit', 'image.fast'],
  MUSIC_MODEL: ['music'],
  VIDEO_MODEL: ['video.text', 'video.image', 'video.firstLast'],
}

const CHAT_TIER_VARS: Record<string, Role> = {
  LLM_MODEL_FLASH: 'chat.flash',
  LLM_MODEL_LITE: 'chat.lite',
  LLM_MODEL_PRO: 'chat.pro',
}

const DEPRECATED_KEYFRAME_VAR = 'LONG_TAKE_KEYFRAME_MODEL'

export function findModelsFile(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): null | string {
  const explicitVar = 'MODELS_FILE'
  const explicit = env[explicitVar]?.trim()
  if (explicit) {
    const file = path.resolve(cwd, explicit)
    if (!fs.existsSync(file))
      throw new ModelRegistryError(`${explicitVar} points at ${file}, which doesn't exist`)
    return file
  }
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, MODELS_FILE_NAME)
    if (fs.existsSync(candidate)) return candidate
    if (path.dirname(dir) === dir) return null
  }
}

function readRegistryFile(file: string): ModelRegistryFile {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new ModelRegistryError(`Can't read ${file}: ${reason}`)
  }
  return parseModelRegistry(raw, file)
}

const envValue = (env: NodeJS.ProcessEnv, name: string): string | undefined =>
  env[name]?.trim() || undefined

/** A setting's value and the variable it came from (for error messages), or undefined. */
function setting(
  env: NodeJS.ProcessEnv,
  name: string,
): undefined | { value: string; varName: string } {
  const value = envValue(env, name)
  return value ? { value, varName: name } : undefined
}

/**
 * Applies env overrides to a validated registry and re-validates it.
 * Precedence, lowest to highest: group vars (`IMAGE_MODEL`, ...),
 * `LONG_TAKE_KEYFRAME_MODEL`, `LLM_MODEL_<TIER>`, then `<ROLE>_MODEL`.
 */
export function applyEnvOverrides(
  file: ModelRegistryFile,
  env: NodeJS.ProcessEnv,
  logger: Pick<LoaderLogger, 'warn'>,
): ModelRegistryFile {
  const registry: ModelRegistryFile = structuredClone(file)
  let changed = false

  /** Resolves an env value to a registry key, adding an ad-hoc entry when needed. */
  const keyFor = (role: Role, value: string, varName: string): string => {
    const kind = ROLE_KIND[role]
    const match = matchModel(registry, kind, value)
    if (match) return match.key
    const adHoc = adHocEntry(kind, value)
    if (!adHoc) {
      throw new ModelRegistryError(
        `${varName}="${value}" is not a ${kind} model key, alias or fal endpoint id in the model registry`,
      )
    }
    const key = registry.models[value] ? `${kind}:${value}` : value
    registry.models[key] = adHoc
    if (kind !== 'chat') logger.warn(`${adHocWarning(value, adHoc)} (from ${varName})`)
    return key
  }

  const set = (role: Role, value: string, varName: string) => {
    const key = keyFor(role, value, varName)
    if (registry.models[key]?.provider === 'google') {
      // A Gemini entry changes the role only while Gemini makes pictures and clips.
      registry.providerRoles = {
        ...registry.providerRoles,
        google: { ...registry.providerRoles?.google, [role]: key },
      }
    } else {
      registry.roles[role] = key
    }
    changed = true
  }

  for (const [name, roles] of Object.entries(GROUP_VARS)) {
    const found = setting(env, name)
    if (found) for (const role of roles) set(role, found.value, found.varName)
  }

  const keyframe = envValue(env, DEPRECATED_KEYFRAME_VAR)
  if (keyframe) {
    logger.warn(
      `[models] ${DEPRECATED_KEYFRAME_VAR} is deprecated; set ${roleEnvVar('image.generate')} instead`,
    )
    if (matchModel(registry, 'image', keyframe) || adHocEntry('image', keyframe)) {
      set('image.generate', keyframe, DEPRECATED_KEYFRAME_VAR)
    } else {
      const note = legacyTarget('image', keyframe)
        ? 'a legacy id that maps to the image.generate default'
        : 'not a known image model'
      logger.warn(`[models] ignoring ${DEPRECATED_KEYFRAME_VAR}="${keyframe}": ${note}`)
    }
  }

  for (const [name, role] of Object.entries(CHAT_TIER_VARS)) {
    const value = envValue(env, name)
    if (value) set(role, value, name)
  }

  for (const role of ROLES) {
    const found = setting(env, roleEnvVar(role))
    if (found) set(role, found.value, found.varName)
  }

  return changed ? parseModelRegistry(registry, 'model registry after env overrides') : registry
}

/** Reads, validates and env-overrides the registry. Uncached; see `modelRegistry()`. */
export function loadModelRegistry(options: LoadModelRegistryOptions = {}): LoadedModelRegistry {
  const env = options.env ?? process.env
  const logger = options.logger ?? llmConfig().logger
  const file = findModelsFile(options.cwd, env)
  const base = file
    ? readRegistryFile(file)
    : parseModelRegistry(bundledModels, `bundled ${MODELS_FILE_NAME}`)
  const source = file ?? 'bundled defaults'
  const registry = applyEnvOverrides(base, env, logger)
  logger.info(`[models] loaded model registry from ${source}`)
  return { registry, source }
}

let cached: null | { registry: ModelRegistryFile; resolver: ModelResolver; source: string } = null

function load() {
  if (!cached) {
    const { registry, source } = loadModelRegistry()
    cached = {
      registry,
      resolver: createModelResolver(registry, {
        generationProvider: currentGenerationProvider,
        logger: llmConfig().logger,
      }),
      source,
    }
  }
  return cached
}

/** The process-wide registry, loaded on first use. Restart to pick up changes. */
export function modelRegistry(): ModelRegistryFile {
  return load().registry
}

export function modelRegistrySource(): string {
  return load().source
}

export function modelResolver(): ModelResolver {
  return load().resolver
}

export function resetModelRegistryForTesting(): void {
  cached = null
}
