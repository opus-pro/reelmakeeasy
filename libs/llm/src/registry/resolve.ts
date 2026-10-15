/**
 * Resolves roles and requested model ids against a loaded registry. Pure over
 * the registry it's given (no env, no filesystem), so it's browser-safe.
 */
import { type LegacyTarget, legacyTarget } from './legacy'
import {
  type ElevenLabsAdapter,
  type FalAdapter,
  GENERATION_PROVIDERS,
  type GenerationProvider,
  type GoogleAdapter,
  type ImageCaps,
  type ModelCapabilities,
  type ModelEntry,
  type ModelKind,
  ModelRegistryError,
  type ModelRegistryFile,
  type MusicCaps,
  type Provider,
  type Role,
  ROLE_KIND,
  ROLE_VIDEO_MODE,
  ROLES,
  type VideoCaps,
  type VideoMode,
  type VideoRole,
} from './schema'

export interface PublicModel {
  aliases?: string[]
  capabilities?: ModelCapabilities
  kind: ModelKind
  label: string
  provider: Provider
}

export interface PublicRegistry {
  /** The generation provider the listed models and roles are for. */
  generationProvider: GenerationProvider
  models: Record<string, PublicModel>
  roles: Record<Role, null | PublicRoleModel>
  /** Clip models the composer offers, the default first. Gemini only; fal keeps its one transition model. */
  videoChoices: string[]
}

export interface PublicRoleModel {
  capabilities?: ModelCapabilities
  key: string
  label: string
}

export type ResolutionSource = 'alias' | 'endpoint' | 'key' | 'legacy' | 'role' | 'unknown-fallback'

export interface ResolvedModel {
  adapter?: ElevenLabsAdapter | FalAdapter | GoogleAdapter
  capabilities?: ModelCapabilities
  /** The endpoint for the resolved mode (`generate` for non-video fal models). */
  endpoint?: string
  endpoints: Record<string, string>
  /** Extra request fields, merged last into every request. */
  input: Record<string, unknown>
  key: string
  kind: ModelKind
  label: string
  /** The video mode `endpoint` serves. */
  mode?: VideoMode
  /** Provider model id, for chat and ElevenLabs TTS entries. */
  model?: string
  provider: Provider
}

export type ResolvedModelWithSource = ResolvedModel & { source: ResolutionSource }

export interface VideoFrames {
  end?: string
  references?: string[]
  start?: string
}

interface ResolverLogger {
  debug(message: string): void
  warn(message: string): void
}

const silent: ResolverLogger = { debug: () => undefined, warn: () => undefined }

// ---------- matching (shared with the loader) ----------

export interface ModelMatch {
  entry: ModelEntry
  key: string
  source: 'alias' | 'endpoint' | 'key'
}

function entryEndpoints(entry: ModelEntry): string[] {
  if (!('endpoints' in entry) || !entry.endpoints) return []
  return Object.values(entry.endpoints as Record<string, string | undefined>).filter(
    (e): e is string => Boolean(e),
  )
}

/** Finds an entry of `kind` by registry key, alias, then endpoint id. */
export function matchModel(
  registry: ModelRegistryFile,
  kind: ModelKind,
  id: string,
): ModelMatch | null {
  const direct = registry.models[id]
  if (direct?.kind === kind) return { entry: direct, key: id, source: 'key' }
  const ofKind = Object.entries(registry.models).filter(([, e]) => e.kind === kind)
  const alias = ofKind.find(([, e]) => e.aliases?.includes(id))
  if (alias) return { entry: alias[1], key: alias[0], source: 'alias' }
  const endpoint = ofKind.find(([, e]) => entryEndpoints(e).includes(id))
  if (endpoint) return { entry: endpoint[1], key: endpoint[0], source: 'endpoint' }
  return null
}

/** A fal endpoint id (`owner/app/...`), as opposed to a registry key. */
export const isFalEndpointId = (id: string): boolean => id.split('/').filter(Boolean).length >= 2

export function inferFalAdapter(endpoint: string): FalAdapter {
  const id = endpoint.toLowerCase()
  if (id.includes('nano-banana')) return 'nano-banana'
  if (id.includes('seedream')) return 'seedream'
  if (id.startsWith('openai/gpt-image')) return 'gpt-image'
  if (id.includes('veo')) return 'veo'
  if (id.startsWith('minimax/h3')) return 'minimax-video'
  if (id.includes('lyria')) return 'lyria'
  return 'generic'
}

/** Conservative capabilities for fal endpoints the registry doesn't describe. */
export const AD_HOC_CAPABILITIES = {
  image: {
    aspectRatios: ['1:1', '16:9', '9:16'],
    maxReferenceImages: 1,
    resolutions: ['1K'],
  } satisfies ImageCaps,
  music: { maxDurationSec: 30 } satisfies MusicCaps,
  video: {
    aspectRatios: ['16:9', '9:16'],
    audio: false,
    durationsSec: [5],
    maxResolution: '720p',
  } satisfies VideoCaps,
}

/**
 * Builds a registry entry for an id the registry doesn't know: any chat model
 * id, or a raw fal endpoint for image, video and music. Returns null otherwise.
 */
export function adHocEntry(kind: ModelKind, id: string): ModelEntry | null {
  if (kind === 'chat') return { kind: 'chat', label: id, model: id, provider: 'openai-compatible' }
  if (!isFalEndpointId(id)) return null
  const adapter = inferFalAdapter(id)
  if (kind === 'image') {
    return {
      adapter,
      capabilities: { ...AD_HOC_CAPABILITIES.image },
      endpoints: { generate: id },
      kind,
      label: id,
      provider: 'fal',
    }
  }
  if (kind === 'video') {
    return {
      adapter,
      capabilities: { ...AD_HOC_CAPABILITIES.video },
      endpoints: { firstLast: id, image: id, text: id },
      kind,
      label: id,
      provider: 'fal',
    }
  }
  if (kind === 'music') {
    return {
      adapter,
      capabilities: { ...AD_HOC_CAPABILITIES.music },
      endpoints: { generate: id },
      kind,
      label: id,
      provider: 'fal',
    }
  }
  return null
}

export function adHocWarning(id: string, entry: ModelEntry): string {
  const adapter = 'adapter' in entry ? entry.adapter : 'generic'
  return `[models] "${id}" isn't in the model registry; calling it as a raw fal ${entry.kind} endpoint (${adapter} adapter, conservative capabilities)`
}

// ---------- generation provider ----------

/** Kinds a project or a picker stores by id: an id of the other provider resolves through the role. */
const PICKED_KINDS: ReadonlySet<ModelKind> = new Set<ModelKind>(['image', 'music', 'video'])

export const isGenerationProvider = (value: unknown): value is GenerationProvider =>
  (GENERATION_PROVIDERS as readonly unknown[]).includes(value)

/** True for an entry that runs on the other generation provider (fal vs google). */
export function onOtherProvider(
  entry: Pick<ModelEntry, 'provider'>,
  provider: GenerationProvider,
): boolean {
  return isGenerationProvider(entry.provider) && entry.provider !== provider
}

/** The key a role uses on a provider: its providerRoles entry when listed there, else `roles`. */
export function roleKeyFor(
  registry: ModelRegistryFile,
  role: Role,
  provider: GenerationProvider,
): null | string {
  const listed = provider === 'fal' ? undefined : registry.providerRoles?.[provider]?.[role]
  return listed === undefined ? registry.roles[role] : listed
}

/**
 * On google the composer offers every Gemini clip model that animates first to
 * last frame, the default (the `video.firstLast` model) first.
 */
function videoChoicesFor(
  provider: GenerationProvider,
  entries: [string, ModelEntry][],
  defaultKey: null | string,
): string[] {
  if (provider !== 'google') return []
  const keys = entries.flatMap(([key, entry]) =>
    entry.kind === 'video' && entry.provider === 'google' && entry.endpoints.firstLast ? [key] : [],
  )
  return defaultKey && keys.includes(defaultKey)
    ? [defaultKey, ...keys.filter((key) => key !== defaultKey)]
    : keys
}

// ---------- resolution ----------

export function videoModeForFrames(frames: VideoFrames): VideoMode {
  if (frames.start && frames.end) return 'firstLast'
  if (frames.start) return 'image'
  if (frames.references?.length) return 'reference'
  return 'text'
}

/** The role a kind resolves through when nothing more specific is asked for. */
export interface ModelResolver {
  capabilitiesFor(kind: ModelKind, idOrKey: string): ModelCapabilities | null
  fallbacksFor(roleOrKey: string): ResolvedModel[]
  isKnownModel(kind: ModelKind, id: string): boolean
  publicRegistry(): PublicRegistry
  registry: ModelRegistryFile
  resolveModel(kind: ModelKind, requested?: string, opts?: ResolveOptions): ResolvedModelWithSource
  resolveRole(role: Role): null | ResolvedModel
  resolveVideoForFrames(
    requested: string | undefined,
    frames: VideoFrames,
    opts?: { role?: VideoRole },
  ): ResolvedModelWithSource
}

const describeMode = (mode: VideoMode): string =>
  mode === 'text' ? 'from text' : `in ${mode} mode`
const requestedNote = (requested?: string): string =>
  requested ? ` (requested "${requested}")` : ''

export interface ResolveOptions {
  mode?: VideoMode
  /** The role to fall back on when nothing is requested, or the request is a legacy or unknown id. */
  role?: Role
}

export interface ResolverOptions {
  /** The generation provider whose role map and models apply; fal when absent. */
  generationProvider?: () => GenerationProvider
  logger?: ResolverLogger
}

export function defaultRoleFor(kind: ModelKind, mode: VideoMode = 'text'): Role {
  switch (kind) {
    case 'align': {
      return 'speech.align'
    }
    case 'chat': {
      return 'chat.flash'
    }
    case 'image': {
      return 'image.generate'
    }
    case 'lipsync': {
      return 'video.lipsync'
    }
    case 'music': {
      return 'music'
    }
    case 'tts': {
      return 'tts'
    }
    case 'video': {
      return `video.${mode}`
    }
    case 'voice-clone': {
      return 'voice.clone'
    }
  }
}

export function toResolvedModel(key: string, entry: ModelEntry, mode?: VideoMode): ResolvedModel {
  const endpoints = Object.fromEntries(
    Object.entries(
      'endpoints' in entry ? (entry.endpoints as Record<string, string | undefined>) : {},
    ).filter((kv): kv is [string, string] => Boolean(kv[1])),
  )
  const videoMode = entry.kind === 'video' ? (mode ?? 'text') : undefined
  return {
    ...('adapter' in entry ? { adapter: entry.adapter } : {}),
    ...('capabilities' in entry ? { capabilities: entry.capabilities } : {}),
    ...('model' in entry && entry.model ? { model: entry.model } : {}),
    ...(videoMode ? { mode: videoMode } : {}),
    endpoint: videoMode ? endpoints[videoMode] : endpoints['generate'],
    endpoints,
    input: entry.input ?? {},
    key,
    kind: entry.kind,
    label: entry.label,
    provider: entry.provider,
  }
}

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value)

export function createModelResolver(
  registry: ModelRegistryFile,
  options: ResolverOptions = {},
): ModelResolver {
  const logger = options.logger ?? silent
  const provider = options.generationProvider ?? ((): GenerationProvider => 'fal')
  const warned = new Set<string>()
  const warnOnce = (message: string) => {
    if (warned.has(message)) return
    warned.add(message)
    logger.warn(message)
  }
  const keyForRole = (role: Role): null | string => roleKeyFor(registry, role, provider())
  const rolePath = (role: Role): string =>
    provider() === 'fal' ? `roles.${role}` : `providerRoles.${provider()}.${role}`
  const foreign = (kind: ModelKind, entry: ModelEntry): boolean =>
    PICKED_KINDS.has(kind) && onOtherProvider(entry, provider())

  function resolveRole(role: Role): null | ResolvedModel {
    const key = keyForRole(role)
    if (!key) return null
    const entry = registry.models[key]
    if (!entry) throw new ModelRegistryError(`${rolePath(role)} -> "${key}" is not a model key`)
    return toResolvedModel(key, entry, ROLE_VIDEO_MODE[role])
  }

  function fromRole(
    role: Role,
    kind: ModelKind,
    mode: undefined | VideoMode,
    source: ResolutionSource,
  ): ResolvedModelWithSource {
    if (ROLE_KIND[role] !== kind)
      throw new ModelRegistryError(`Role ${role} serves ${ROLE_KIND[role]} models, not ${kind}`)
    const key = keyForRole(role)
    if (!key)
      throw new ModelRegistryError(
        `No model is configured for role ${role} (${rolePath(role)} is null)`,
      )
    const entry = registry.models[key]
    if (!entry) throw new ModelRegistryError(`${rolePath(role)} -> "${key}" is not a model key`)
    return { ...toResolvedModel(key, entry, mode ?? ROLE_VIDEO_MODE[role]), source }
  }

  /** A stored id of the other provider (a fal clip model on Gemini, or back) uses the role. */
  function fromOtherProvider(
    id: string,
    role: Role,
    kind: ModelKind,
    mode: undefined | VideoMode,
  ): ResolvedModelWithSource {
    const resolved = fromRole(role, kind, mode, 'unknown-fallback')
    warnOnce(
      `[models] "${id}" runs on another generation provider; using ${role} (${resolved.key}) on ${provider()}`,
    )
    return resolved
  }

  function fromLegacy(
    kind: ModelKind,
    id: string,
    legacy: LegacyTarget,
    opts: ResolveOptions,
  ): ResolvedModelWithSource {
    if ('key' in legacy) {
      const entry = registry.models[legacy.key]
      if (entry?.kind === kind && !foreign(kind, entry))
        return { ...toResolvedModel(legacy.key, entry, opts.mode), source: 'legacy' }
    }
    // An explicit role describes the call site, so it wins over the legacy id's category.
    const target = opts.role ?? ('role' in legacy ? legacy.role : defaultRoleFor(kind, opts.mode))
    const resolved = fromRole(target, kind, opts.mode, 'legacy')
    logger.debug(`[models] legacy model id ${JSON.stringify({ from: id, to: resolved.key })}`)
    return resolved
  }

  function resolveModel(
    kind: ModelKind,
    requested?: string,
    opts: ResolveOptions = {},
  ): ResolvedModelWithSource {
    const role = opts.role ?? defaultRoleFor(kind, opts.mode)
    const id = requested?.trim()
    if (!id) return fromRole(role, kind, opts.mode, 'role')

    const match = matchModel(registry, kind, id)
    if (match) {
      return foreign(kind, match.entry)
        ? fromOtherProvider(id, role, kind, opts.mode)
        : { ...toResolvedModel(match.key, match.entry, opts.mode), source: match.source }
    }

    const legacy = legacyTarget(kind, id)
    if (legacy) return fromLegacy(kind, id, legacy, opts)

    const adHoc = adHocEntry(kind, id)
    if (adHoc) {
      if (foreign(kind, adHoc)) return fromOtherProvider(id, role, kind, opts.mode)
      if (kind !== 'chat') warnOnce(adHocWarning(id, adHoc))
      return { ...toResolvedModel(id, adHoc, opts.mode), source: 'endpoint' }
    }

    const fallback = fromRole(role, kind, opts.mode, 'unknown-fallback')
    warnOnce(`[models] unknown ${kind} model "${id}"; using ${role} (${fallback.key})`)
    return fallback
  }

  function fallbacksFor(roleOrKey: string): ResolvedModel[] {
    const roles = isRole(roleOrKey) ? [roleOrKey] : ROLES.filter((r) => keyForRole(r) === roleOrKey)
    const out: ResolvedModel[] = []
    for (const role of roles) {
      for (const key of registry.fallbacks?.[role] ?? []) {
        const entry = registry.models[key]
        const mode = ROLE_VIDEO_MODE[role]
        // Only models of the current generation provider: a fal fallback never runs on Gemini.
        if (!entry || foreign(entry.kind, entry)) continue
        if (out.some((r) => r.key === key && r.mode === mode)) continue
        out.push(toResolvedModel(key, entry, mode))
      }
    }
    return out
  }

  function resolveVideoForFrames(
    requested: string | undefined,
    frames: VideoFrames,
    opts: { role?: VideoRole } = {},
  ): ResolvedModelWithSource {
    const wanted = videoModeForFrames(frames)
    // Modes to try, most faithful first: a model without first-last support
    // still animates the first frame; reference-only degrades to text.
    const modes: VideoMode[] =
      wanted === 'firstLast'
        ? ['firstLast', 'image']
        : wanted === 'reference'
          ? ['reference', 'text']
          : [wanted]
    const candidates = modes.flatMap((mode) => {
      const role = opts.role ?? (`video.${mode}` as VideoRole)
      if (!requested?.trim() && !keyForRole(role)) return []
      return [{ mode, primary: resolveModel('video', requested, { mode, role }) }]
    })
    // Stay on the requested model in a lesser mode before switching models.
    const direct = candidates.find((c) => c.primary.endpoint)
    if (direct) return direct.primary
    for (const { mode, primary } of candidates) {
      const fallback = fallbacksFor(`video.${mode}`).find((r) => r.endpoint)
      if (fallback) return { ...fallback, source: primary.source }
    }
    throw new ModelRegistryError(
      `No video model can generate ${describeMode(wanted)}${requestedNote(requested)}`,
    )
  }

  function publicRegistry(): PublicRegistry {
    const current = provider()
    const roles = Object.fromEntries(
      ROLES.map((role) => {
        const key = keyForRole(role)
        const entry = key ? registry.models[key] : undefined
        if (!key || !entry) return [role, null]
        return [
          role,
          {
            key,
            label: entry.label,
            ...('capabilities' in entry ? { capabilities: entry.capabilities } : {}),
          },
        ]
      }),
    ) as PublicRegistry['roles']
    const listed = Object.entries(registry.models).filter(
      ([, entry]) => !onOtherProvider(entry, current),
    )
    const models = Object.fromEntries(
      listed.map(([key, entry]) => [
        key,
        {
          ...(entry.aliases ? { aliases: entry.aliases } : {}),
          ...('capabilities' in entry ? { capabilities: entry.capabilities } : {}),
          kind: entry.kind,
          label: entry.label,
          provider: entry.provider,
        } satisfies PublicModel,
      ]),
    )
    return {
      generationProvider: current,
      models,
      roles,
      videoChoices: videoChoicesFor(current, listed, keyForRole('video.firstLast')),
    }
  }

  return {
    capabilitiesFor: (kind, idOrKey) => resolveModel(kind, idOrKey).capabilities ?? null,
    fallbacksFor,
    isKnownModel: (kind, id) => matchModel(registry, kind, id) !== null,
    publicRegistry,
    registry,
    resolveModel,
    resolveRole,
    resolveVideoForFrames,
  }
}
