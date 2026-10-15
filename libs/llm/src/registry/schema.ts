/**
 * The model registry file format (`reelmakeeasy.models.json`).
 *
 * Browser-safe: zod only, no node imports. The JSON Schema in
 * `schemas/reelmakeeasy.models.schema.json` is generated from `modelRegistrySchema`.
 */
import { z } from 'zod'

export const PROVIDERS = ['fal', 'openai-compatible', 'elevenlabs', 'google'] as const
export type Provider = (typeof PROVIDERS)[number]

export const FAL_ADAPTERS = [
  'nano-banana',
  'gpt-image',
  'seedream',
  'veo',
  'minimax-video',
  'lyria',
  'elevenlabs-music',
  'cassetteai-music',
  'minimax-music',
  'ace-step',
  'minimax-speech',
  'minimax-voice-clone',
  'kokoro-tts',
  'qwen3-tts',
  'kling-lipsync',
  'generic',
] as const
export type FalAdapter = (typeof FAL_ADAPTERS)[number]

export const ELEVENLABS_ADAPTERS = [
  'elevenlabs-tts',
  'elevenlabs-align',
  'elevenlabs-scribe',
] as const
export type ElevenLabsAdapter = (typeof ELEVENLABS_ADAPTERS)[number]

/** Adapters for Gemini API (google) entries; they call the Gemini API with GEMINI_API_KEY. */
export const GOOGLE_ADAPTERS = [
  'gemini-image',
  'veo-google',
  'omni-google',
  'lyria-google',
  'gemini-tts',
  'gemini-transcribe',
] as const
export type GoogleAdapter = (typeof GOOGLE_ADAPTERS)[number]

/** Who makes pictures, clips, voices and music: fal, or Google's Gemini API (google). */
export const GENERATION_PROVIDERS = ['fal', 'google'] as const
export type GenerationProvider = (typeof GENERATION_PROVIDERS)[number]

export const ROLES = [
  'chat.lite',
  'chat.flash',
  'chat.pro',
  'image.generate',
  'image.edit',
  'image.fast',
  'image.agentPreview',
  'video.text',
  'video.image',
  'video.firstLast',
  'video.reference',
  'video.lipsync',
  'music',
  'tts',
  'tts.elevenlabs',
  'tts.minimax',
  'tts.kokoro',
  'tts.qwen3',
  'tts.gemini',
  'voice.clone',
  'speech.align',
  'speech.transcribe',
] as const
export type ChatRole = Extract<Role, `chat.${string}`>
export type ImageRole = Extract<Role, `image.${string}`>
export type Role = (typeof ROLES)[number]
export type VideoRole = Exclude<Extract<Role, `video.${string}`>, 'video.lipsync'>

export const VIDEO_MODES = ['text', 'image', 'firstLast', 'reference'] as const
export type VideoMode = (typeof VIDEO_MODES)[number]

export const MODEL_KINDS = [
  'chat',
  'image',
  'video',
  'music',
  'tts',
  'voice-clone',
  'lipsync',
  'align',
] as const
export type ModelKind = (typeof MODEL_KINDS)[number]

/** The entry kind each role must point at. */
export const ROLE_KIND: Record<Role, ModelKind> = {
  'image.agentPreview': 'image',
  'chat.flash': 'chat',
  'chat.lite': 'chat',
  'chat.pro': 'chat',
  'image.edit': 'image',
  'image.fast': 'image',
  'image.generate': 'image',
  music: 'music',
  'speech.align': 'align',
  'speech.transcribe': 'align',
  tts: 'tts',
  'tts.elevenlabs': 'tts',
  'tts.gemini': 'tts',
  'tts.kokoro': 'tts',
  'tts.minimax': 'tts',
  'tts.qwen3': 'tts',
  'video.firstLast': 'video',
  'video.image': 'video',
  'video.lipsync': 'lipsync',
  'video.reference': 'video',
  'video.text': 'video',
  'voice.clone': 'voice-clone',
}

/** The video mode a `video.*` role generates in. */
export const ROLE_VIDEO_MODE: Partial<Record<Role, VideoMode>> = {
  'video.firstLast': 'firstLast',
  'video.image': 'image',
  'video.reference': 'reference',
  'video.text': 'text',
}

/** Adapters (fal, ElevenLabs, Gemini) that can build requests for each kind. */
export const KIND_ADAPTERS: Record<ModelKind, readonly string[]> = {
  align: ['elevenlabs-align', 'elevenlabs-scribe', 'gemini-transcribe'],
  chat: [],
  image: ['nano-banana', 'gpt-image', 'seedream', 'generic', 'gemini-image'],
  lipsync: ['kling-lipsync'],
  music: [
    'lyria',
    'elevenlabs-music',
    'cassetteai-music',
    'minimax-music',
    'ace-step',
    'generic',
    'lyria-google',
  ],
  tts: ['minimax-speech', 'kokoro-tts', 'qwen3-tts', 'elevenlabs-tts', 'gemini-tts'],
  video: ['veo', 'minimax-video', 'generic', 'veo-google', 'omni-google'],
  'voice-clone': ['minimax-voice-clone'],
}

/**
 * Speech to text (`elevenlabs-scribe`, `gemini-transcribe`) or forced alignment (`elevenlabs-align`).
 * `elevenlabs` entries are called directly with ELEVENLABS_API_KEY; `fal`
 * entries name the fal-hosted endpoint used without that key; `google` entries
 * name a Gemini API model id.
 */
export type AlignModelEntry = Base & {
  adapter: 'elevenlabs-align' | 'elevenlabs-scribe' | 'gemini-transcribe'
  /** fal only: the fal-hosted endpoint. */
  endpoints?: { generate: string }
  kind: 'align'
  /** The Gemini API model id (google entries). */
  model?: string
  provider: 'elevenlabs' | 'fal' | 'google'
}

export type ChatModelEntry = Base & { kind: 'chat'; model: string; provider: 'openai-compatible' }

export type ElevenLabsTtsModelEntry = Base & {
  adapter: 'elevenlabs-tts'
  kind: 'tts'
  model: string
  provider: 'elevenlabs'
}

/** The fal TTS adapters. */
export const FAL_TTS_ADAPTERS = ['minimax-speech', 'kokoro-tts', 'qwen3-tts'] as const
export type FalTtsAdapter = (typeof FAL_TTS_ADAPTERS)[number]
/** Adapters a fal TTS entry can use: the fal TTS adapters, plus ElevenLabs voices hosted on fal. */
const FAL_HOSTED_TTS_ADAPTERS: readonly string[] = [...FAL_TTS_ADAPTERS, 'elevenlabs-tts']

export type FalTtsModelEntry = Base & {
  adapter: 'elevenlabs-tts' | FalTtsAdapter
  /**
   * `generate` synthesizes speech. Qwen3-TTS also names the endpoints that
   * design a voice from a description (`design`) and turn reference audio into
   * a reusable speaker embedding (`clone`).
   */
  endpoints: { clone?: string; design?: string; generate: string }
  kind: 'tts'
  provider: 'fal'
}

/** Gemini TTS: a Gemini API model id, prebuilt voices. */
export type GoogleTtsModelEntry = Base & {
  adapter: 'gemini-tts'
  kind: 'tts'
  model: string
  provider: 'google'
}

export interface ImageCaps {
  aspectRatios: string[]
  maxReferenceImages: number
  resolutions: ('1K' | '2K' | '4K')[]
}

export type ImageModelEntry = Base & {
  adapter: FalAdapter | GoogleAdapter
  capabilities: ImageCaps
  endpoints: { edit?: string; generate: string }
  kind: 'image'
  provider: 'fal' | 'google'
}

export interface LipsyncCaps {
  maxVideoSec: number
  minVideoSec: number
}
export type LipsyncModelEntry = Base & {
  adapter: 'kling-lipsync'
  capabilities: LipsyncCaps
  endpoints: { generate: string }
  kind: 'lipsync'
  provider: 'fal'
}
export type ModelCapabilities = ImageCaps | LipsyncCaps | MusicCaps | VideoCaps
export type ModelEntry =
  | AlignModelEntry
  | ChatModelEntry
  | ElevenLabsTtsModelEntry
  | FalTtsModelEntry
  | GoogleTtsModelEntry
  | ImageModelEntry
  | LipsyncModelEntry
  | MusicModelEntry
  | VideoModelEntry
  | VoiceCloneModelEntry
export interface ModelRegistryFile {
  /** Clip models for loop shorts, tried in order, each only when its provider's key is set. */
  beatLoop?: { video: string[] }
  fallbacks?: Partial<Record<Role, string[]>>
  models: Record<string, ModelEntry>
  /** Role maps per generation provider; a role not listed uses `roles` (the fal map). */
  providerRoles?: { google?: Partial<Record<Role, null | string>> }
  roles: Record<Role, null | string>
  version: 1
}
export interface MusicCaps {
  maxDurationSec: number
}
export type MusicModelEntry = Base & {
  adapter: FalAdapter | GoogleAdapter
  capabilities: MusicCaps
  endpoints: { generate: string }
  kind: 'music'
  provider: 'fal' | 'google'
}
export interface VideoCaps {
  aspectRatios: string[]
  audio: boolean
  /**
   * Fast enough to make a video's transitions one after another, each starting
   * from the previous clip's last frame (seamless joins) instead of in parallel.
   */
  chainTransitions?: boolean
  /**
   * [min, max] seconds the API takes as an exact length, beyond the listed
   * `durationsSec` that ordinary clips snap to. Only a caller that asks for an
   * exact length (`exactDurationSeconds`, a loop's 4 s clip) uses it.
   */
  durationRangeSec?: [number, number]
  durationsSec: number[]
  emitsNativeAudio?: boolean
  family?: string
  /**
   * The exact frame size the model renders at each resolution and aspect ratio,
   * as [width, height]. First and last frames are fitted to it before upload,
   * so both match the output canvas and the model never reframes them.
   */
  frameSizes?: Record<string, Record<string, [number, number]>>
  maxReferenceImages?: number
  maxResolution: '480p' | '720p' | '1080p'
  promptMaxChars?: number
  /** Resolutions the user can pick, lowest first (e.g. 480p, 768p, 1080p). */
  resolutions?: string[]
  /** Price per second of generated video at each resolution, for the picker. */
  usdPerSecond?: Record<string, number>
}
export type VideoModelEntry = Base & {
  adapter: FalAdapter | GoogleAdapter
  capabilities: VideoCaps
  endpoints: Partial<Record<VideoMode, string>>
  kind: 'video'
  provider: 'fal' | 'google'
}

export type VoiceCloneModelEntry = Base & {
  adapter: 'minimax-voice-clone'
  endpoints: { generate: string }
  kind: 'voice-clone'
  provider: 'fal'
}

interface Base {
  aliases?: string[]
  /** Extra request fields, merged last into every request to this model. */
  input?: Record<string, unknown>
  label: string
}

// ---------- zod ----------

const endpointId = z
  .string()
  .min(1)
  .describe(
    'fal endpoint id (e.g. "fal-ai/nano-banana-pro"), or the Gemini API model id for google entries',
  )

const base = {
  aliases: z.array(z.string().min(1)).optional().describe('Other ids that resolve to this entry'),
  input: z
    .record(z.unknown())
    .optional()
    .describe('Extra request fields, merged last into every request'),
  label: z.string().min(1).describe('Human-readable name'),
}

const generationAdapter = z.enum([...FAL_ADAPTERS, ...GOOGLE_ADAPTERS])
const generationProvider = z.enum(GENERATION_PROVIDERS)

const imageCaps = z
  .object({
    aspectRatios: z.array(z.string()).min(1),
    maxReferenceImages: z.number().int().min(0),
    resolutions: z.array(z.enum(['1K', '2K', '4K'])).min(1),
  })
  .strict()

const videoCaps = z
  .object({
    aspectRatios: z.array(z.string()).min(1),
    audio: z.boolean(),
    chainTransitions: z
      .boolean()
      .optional()
      .describe(
        "Make transitions one after another, each starting from the previous clip's last frame",
      ),
    durationRangeSec: z
      .tuple([z.number().positive(), z.number().positive()])
      .optional()
      .describe(
        '[min, max] seconds the API takes when a caller asks for an exact length (a loop clip); other clips snap to durationsSec',
      ),
    durationsSec: z.array(z.number().positive()).min(1),
    emitsNativeAudio: z.boolean().optional(),
    family: z.string().optional(),
    frameSizes: z
      .record(z.record(z.tuple([z.number().int().positive(), z.number().int().positive()])))
      .optional()
      .describe(
        'Exact [width, height] the model renders per resolution and aspect ratio, e.g. {"768p": {"9:16": [768, 1344]}}. First and last frames are fitted to it before upload.',
      ),
    maxReferenceImages: z.number().int().min(0).optional(),
    maxResolution: z.enum(['480p', '720p', '1080p']),
    promptMaxChars: z.number().int().positive().optional(),
    resolutions: z.array(z.string()).optional(),
    usdPerSecond: z
      .record(z.number().nonnegative())
      .optional()
      .describe('Price per second of video at each resolution, e.g. {"768p": 0.02}'),
  })
  .strict()

const chatEntry = z
  .object({
    ...base,
    kind: z.literal('chat'),
    model: z.string().min(1),
    provider: z.literal('openai-compatible'),
  })
  .strict()

const imageEntry = z
  .object({
    ...base,
    adapter: generationAdapter,
    capabilities: imageCaps,
    endpoints: z.object({ edit: endpointId.optional(), generate: endpointId }).strict(),
    kind: z.literal('image'),
    provider: generationProvider,
  })
  .strict()

const videoEntry = z
  .object({
    ...base,
    adapter: generationAdapter,
    capabilities: videoCaps,
    endpoints: z
      .object({
        firstLast: endpointId.optional(),
        image: endpointId.optional(),
        reference: endpointId.optional(),
        text: endpointId.optional(),
      })
      .strict(),
    kind: z.literal('video'),
    provider: generationProvider,
  })
  .strict()

const musicEntry = z
  .object({
    ...base,
    adapter: generationAdapter,
    capabilities: z.object({ maxDurationSec: z.number().positive() }).strict(),
    endpoints: z.object({ generate: endpointId }).strict(),
    kind: z.literal('music'),
    provider: generationProvider,
  })
  .strict()

// One object for both TTS providers (a discriminated union needs unique
// discriminators); the provider-specific shape is enforced in superRefine.
const ttsEntry = z
  .object({
    ...base,
    adapter: z.enum([...FAL_TTS_ADAPTERS, 'elevenlabs-tts', 'gemini-tts']),
    endpoints: z
      .object({
        clone: endpointId.optional().describe('qwen3-tts: reference audio -> speaker embedding'),
        design: endpointId.optional().describe('qwen3-tts: voice description -> sample audio'),
        generate: endpointId,
      })
      .strict()
      .optional()
      .describe('fal only'),
    kind: z.literal('tts'),
    model: z.string().min(1).optional().describe('ElevenLabs or Gemini API model id (not fal)'),
    provider: z.enum(['fal', 'elevenlabs', 'google']),
  })
  .strict()

const voiceCloneEntry = z
  .object({
    ...base,
    adapter: z.literal('minimax-voice-clone'),
    endpoints: z.object({ generate: endpointId }).strict(),
    kind: z.literal('voice-clone'),
    provider: z.literal('fal'),
  })
  .strict()

const lipsyncEntry = z
  .object({
    ...base,
    adapter: z.literal('kling-lipsync'),
    capabilities: z
      .object({ maxVideoSec: z.number().positive(), minVideoSec: z.number().min(0) })
      .strict(),
    endpoints: z.object({ generate: endpointId }).strict(),
    kind: z.literal('lipsync'),
    provider: z.literal('fal'),
  })
  .strict()

// One object for every provider, like ttsEntry; checkAlignEntry enforces each provider's shape.
const alignEntry = z
  .object({
    ...base,
    adapter: z.enum(['elevenlabs-align', 'elevenlabs-scribe', 'gemini-transcribe']),
    endpoints: z
      .object({ generate: endpointId })
      .strict()
      .optional()
      .describe('fal only: the fal-hosted endpoint'),
    kind: z.literal('align'),
    model: z.string().min(1).optional().describe('Gemini API model id (google only)'),
    provider: z.enum(['elevenlabs', 'fal', 'google']),
  })
  .strict()

export const modelEntrySchema = z.discriminatedUnion('kind', [
  chatEntry,
  imageEntry,
  videoEntry,
  musicEntry,
  ttsEntry,
  voiceCloneEntry,
  lipsyncEntry,
  alignEntry,
])

const roleKey = z.string().min(1).nullable()
/** Roles added after the registry shipped: a models file without one still loads, with the
 *  role off (null), so a user's own MODELS_FILE keeps working. */
const OPTIONAL_ROLES: ReadonlySet<Role> = new Set<Role>([
  'image.agentPreview',
  'speech.transcribe',
  'tts.elevenlabs',
  'tts.gemini',
])
const rolesShape = Object.fromEntries(
  ROLES.map((r) => [r, OPTIONAL_ROLES.has(r) ? roleKey.default(null) : roleKey]),
) as Record<Role, typeof roleKey>
const fallbacksShape = Object.fromEntries(
  ROLES.map((r) => [r, z.array(z.string().min(1)).optional()]),
) as Record<Role, z.ZodOptional<z.ZodArray<z.ZodString>>>
const providerRolesShape = Object.fromEntries(ROLES.map((r) => [r, roleKey.optional()])) as Record<
  Role,
  z.ZodOptional<typeof roleKey>
>

const baseRegistrySchema = z
  .object({
    beatLoop: z
      .object({ video: z.array(z.string().min(1)).min(1) })
      .strict()
      .optional()
      .describe(
        "Clip models for loop shorts, tried in order; each runs only when its provider's key is set",
      ),
    fallbacks: z
      .object(fallbacksShape)
      .strict()
      .optional()
      .describe('Models to try, in order, when a role fails'),
    models: z.record(modelEntrySchema).describe('Model entries by key'),
    providerRoles: z
      .object({
        google: z
          .object(providerRolesShape)
          .strict()
          .optional()
          .describe(
            'Role -> model key when Gemini (google) makes pictures, clips, voices and music; roles not listed use `roles`',
          ),
      })
      .strict()
      .optional()
      .describe('Role maps per generation provider'),
    roles: z
      .object(rolesShape)
      .strict()
      .describe('The model key each role uses; null disables the role'),
    version: z.literal(1),
  })
  .strict()

type Issue = (message: string, ...sub: string[]) => void
type ParsedEntry = z.infer<typeof modelEntrySchema>
type ParsedFile = z.infer<typeof baseRegistrySchema>
type RoleMap = Partial<Record<Role, null | string>>

const isGoogleAdapter = (adapter: string): boolean =>
  (GOOGLE_ADAPTERS as readonly string[]).includes(adapter)

function checkAlignEntry(entry: Extract<ParsedEntry, { kind: 'align' }>, issue: Issue): void {
  if (entry.provider === 'fal' && !entry.endpoints)
    issue('fal align entries need endpoints.generate', 'endpoints')
  if (entry.provider === 'elevenlabs' && entry.endpoints)
    issue('ElevenLabs align entries are called directly and take no endpoints', 'endpoints')
  if (entry.provider === 'google' && !entry.model)
    issue('Gemini transcription entries need a model id', 'model') // Gemini
}

function checkEntry(key: string, entry: ParsedEntry, ctx: z.RefinementCtx): void {
  const path = ['models', key]
  const issue: Issue = (message, ...sub) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [...path, ...sub] })

  if ('adapter' in entry && !KIND_ADAPTERS[entry.kind].includes(entry.adapter)) {
    issue(
      `adapter "${entry.adapter}" can't serve kind "${entry.kind}" (use ${KIND_ADAPTERS[entry.kind].join(', ')})`,
      'adapter',
    )
  }
  checkProviderAdapter(entry, issue) // Gemini
  if (entry.kind === 'video' && Object.keys(entry.endpoints).length === 0) {
    issue('video entries need at least one endpoint', 'endpoints')
  }
  const range = entry.kind === 'video' ? entry.capabilities.durationRangeSec : undefined
  if (range && range[0] > range[1])
    issue('starts after it ends', 'capabilities', 'durationRangeSec')
  if (entry.kind === 'tts') checkTtsEntry(entry, issue)
  if (entry.kind === 'align') checkAlignEntry(entry, issue)
}

/** Loop models are clip models that go from a first to a last frame. */
function checkBeatLoop(file: ParsedFile, ctx: z.RefinementCtx): void {
  for (const [i, key] of (file.beatLoop?.video ?? []).entries()) {
    const issue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['beatLoop', 'video', String(i)] })
    const entry = file.models[key]
    if (!entry) issue(`"${key}" is not a model key`)
    else if (entry.kind !== 'video')
      issue(`"${key}" is a ${entry.kind} model; loops need video models`)
    else if (!entry.endpoints.firstLast) issue(`"${key}" has no endpoints.firstLast`)
  }
}

function checkFallbacks(file: ParsedFile, ctx: z.RefinementCtx): void {
  for (const [role, keys] of Object.entries(file.fallbacks ?? {}) as [
    Role,
    string[] | undefined,
  ][]) {
    for (const [i, key] of (keys ?? []).entries()) {
      const path = ['fallbacks', role, String(i)]
      const entry = file.models[key]
      if (!entry) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${key}" is not a model key`, path })
      } else if (entry.kind !== ROLE_KIND[role]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${key}" is a ${entry.kind} model; ${role} falls back to ${ROLE_KIND[role]} models only`,
          path,
        })
      }
    }
  }
}

function checkGoogleTtsEntry(entry: Extract<ParsedEntry, { kind: 'tts' }>, issue: Issue): void {
  if (entry.adapter !== 'gemini-tts')
    issue('Gemini TTS entries use adapter "gemini-tts"', 'adapter')
  if (!entry.model) issue('Gemini TTS entries need a model id', 'model')
  if (entry.endpoints) issue('Gemini TTS entries take model, not endpoints', 'endpoints')
}

/** google entries use the Gemini adapters, and only they do. */
function checkProviderAdapter(entry: ParsedEntry, issue: Issue): void {
  if (!('adapter' in entry)) return
  if (entry.provider === 'google' && !isGoogleAdapter(entry.adapter))
    issue(`google entries use a Gemini adapter (${GOOGLE_ADAPTERS.join(', ')})`, 'adapter')
  if (entry.provider !== 'google' && isGoogleAdapter(entry.adapter))
    issue(`adapter "${entry.adapter}" is for google entries`, 'adapter')
}

/** Every role in a role map points at an existing entry of the role's kind (and mode, for video). */
function checkRoleMap(
  file: ParsedFile,
  map: RoleMap,
  prefix: string[],
  ctx: z.RefinementCtx,
): void {
  for (const role of ROLES) {
    const key = map[role]
    if (key === null || key === undefined) continue
    const path = [...prefix, role]
    const entry = file.models[key]
    const expected = ROLE_KIND[role]
    if (!entry) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${key}" is not a model key`, path })
      continue
    }
    if (entry.kind !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${key}" is a ${entry.kind} model; ${role} needs a ${expected} model`,
        path,
      })
      continue
    }
    const mode = ROLE_VIDEO_MODE[role]
    if (mode && entry.kind === 'video' && !entry.endpoints[mode]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${key}" has no endpoints.${mode}`,
        path,
      })
    }
  }
}

function checkTtsEntry(entry: Extract<ParsedEntry, { kind: 'tts' }>, issue: Issue): void {
  if (entry.provider === 'google') {
    checkGoogleTtsEntry(entry, issue) // Gemini
    return
  }
  if (entry.provider === 'fal') {
    if (!FAL_HOSTED_TTS_ADAPTERS.includes(entry.adapter))
      issue(`fal TTS entries use one of: ${FAL_HOSTED_TTS_ADAPTERS.join(', ')}`, 'adapter')
    if (!entry.endpoints) issue('fal TTS entries need endpoints.generate', 'endpoints')
    if (entry.adapter !== 'qwen3-tts' && (entry.endpoints?.clone || entry.endpoints?.design))
      issue('only qwen3-tts entries take endpoints.clone / endpoints.design', 'endpoints')
    if (entry.model) issue('fal TTS entries take endpoints, not model', 'model')
    return
  }
  if (entry.adapter !== 'elevenlabs-tts')
    issue('ElevenLabs TTS entries use adapter "elevenlabs-tts"', 'adapter')
  if (!entry.model) issue('ElevenLabs TTS entries need a model id', 'model')
  if (entry.endpoints) issue('ElevenLabs TTS entries take model, not endpoints', 'endpoints')
}

export const modelRegistrySchema = baseRegistrySchema.superRefine((file, ctx) => {
  for (const [key, entry] of Object.entries(file.models)) checkEntry(key, entry, ctx)
  checkRoleMap(file, file.roles, ['roles'], ctx)
  if (file.providerRoles?.google) {
    checkRoleMap(file, file.providerRoles.google, ['providerRoles', 'google'], ctx)
  }
  checkFallbacks(file, ctx)
  checkBeatLoop(file, ctx)
})

export class ModelRegistryError extends Error {
  override name = 'ModelRegistryError'
}

/** `roles.video.firstLast -> "kling-30" is not a model key` */
export function formatRegistryIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'} -> ${i.message}`)
    .join('; ')
}

/** Removes `$`-prefixed keys (`$schema`, `$comment`) at every depth. */
export function stripMetaKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripMetaKeys) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([k, v]) => (k.startsWith('$') ? [] : [[k, stripMetaKeys(v)]])),
    ) as T
  }
  return value
}

/**
 * Validates a registry file (after `$`-keys are stripped). Throws a
 * `ModelRegistryError` naming every offending path.
 */
export function parseModelRegistry(raw: unknown, source = 'model registry'): ModelRegistryFile {
  const result = modelRegistrySchema.safeParse(stripMetaKeys(raw))
  if (!result.success)
    throw new ModelRegistryError(`Invalid ${source}: ${formatRegistryIssues(result.error)}`)
  return result.data as ModelRegistryFile
}
