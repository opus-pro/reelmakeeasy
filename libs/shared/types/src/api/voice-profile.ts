import { z } from 'zod'

export const VoiceProfileGenderSchema = z.enum(['female', 'male', 'unknown'])
export const VoiceProfileAgeRangeSchema = z.enum([
  'child',
  'teen',
  '20s',
  '30s',
  '40s',
  '50_plus',
  'unknown',
])
export const VoiceProfileSourceSchema = z.enum(['audio_analysis', 'preset_metadata'])
export const VoiceProfileSourceKindSchema = z.enum(['preset', 'uploaded_audio', 'voice_clone'])

export const VoiceProfileSchema = z.object({
  ageRange: VoiceProfileAgeRangeSchema.optional(),
  localeLabel: z.string().min(1).optional(),
  perceivedGender: VoiceProfileGenderSchema,
  rawDescription: z.string().min(1).optional(),
  source: VoiceProfileSourceSchema,
  sourceKind: VoiceProfileSourceKindSchema,
  tags: z.array(z.string().min(1)).max(6).default([]),
})

// This schema is the responseFormat for the pre-voiceover voice-character LLM
// call (analyzeLongTakeVoiceCharacter), which UIP-v2 spawns. OpenAI strict
// structured outputs reject a bare `.optional()` field (throws client-side in
// zodResponseFormat, killing the fallback chain), so optional fields
// use `.nullable().default(null).transform(...)`: strict-safe, still omit/null
// tolerant, and the null->undefined transform keeps the inferred type exactly
// `T | undefined` so no shared VoiceProfileAnalysis consumer has to change.
export const VoiceProfileAnalysisSchema = z.object({
  ageRange: VoiceProfileAgeRangeSchema.nullable()
    .default(null)
    .transform((value) => value ?? undefined)
    .describe('Estimated age range from the voice alone. Use unknown or omit if unclear.'),
  perceivedGender: VoiceProfileGenderSchema.describe(
    'Perceived vocal presentation only. Use unknown if unclear.',
  ),
  rawDescription: z
    .string()
    .min(1)
    .nullable()
    .default(null)
    .transform((value) => value ?? undefined)
    .describe('A concise description of the voice, suitable for prompts or UI tooltips.'),
  tags: z
    .array(z.string().min(1))
    .max(6)
    .default([])
    .describe('Short, lower-case voice qualities such as warm, calm, authoritative, bright.'),
})

export type VoiceProfile = z.infer<typeof VoiceProfileSchema>
export type VoiceProfileAgeRange = z.infer<typeof VoiceProfileAgeRangeSchema>
export type VoiceProfileAnalysis = z.infer<typeof VoiceProfileAnalysisSchema>
export type VoiceProfileGender = z.infer<typeof VoiceProfileGenderSchema>
export type VoiceProfileSource = z.infer<typeof VoiceProfileSourceSchema>
export type VoiceProfileSourceKind = z.infer<typeof VoiceProfileSourceKindSchema>

const PRESET_AGE_BY_LABEL: Partial<Record<string, VoiceProfileAgeRange>> = {
  baby: 'child',
  child: 'child',
  teen: 'teen',
}

const PRESET_GENDER_BY_LABEL: Partial<Record<string, VoiceProfileGender>> = {
  female: 'female',
  male: 'male',
}

export function buildPresetVoiceProfile(labels: string[]): VoiceProfile {
  const [localeLabel, demographicLabel, ...rest] = labels
  const normalizedDemographic = demographicLabel?.trim().toLowerCase()
  const perceivedGender = normalizedDemographic
    ? PRESET_GENDER_BY_LABEL[normalizedDemographic] || 'unknown'
    : 'unknown'
  const ageRange = normalizedDemographic ? PRESET_AGE_BY_LABEL[normalizedDemographic] : undefined

  const tags = [
    ...(normalizedDemographic &&
    !PRESET_GENDER_BY_LABEL[normalizedDemographic] &&
    !PRESET_AGE_BY_LABEL[normalizedDemographic]
      ? [normalizedDemographic]
      : []),
    ...rest,
  ]

  const descriptionParts = [
    normalizedDemographic && PRESET_GENDER_BY_LABEL[normalizedDemographic]
      ? normalizedDemographic
      : undefined,
    normalizedDemographic && PRESET_AGE_BY_LABEL[normalizedDemographic]
      ? normalizedDemographic
      : undefined,
    ...rest,
  ]
    .map((part) => compactString(part))
    .filter((part): part is string => Boolean(part))

  return normalizeVoiceProfile({
    ...(ageRange ? { ageRange } : {}),
    ...(compactString(localeLabel) ? { localeLabel: compactString(localeLabel) } : {}),
    ...(descriptionParts.length > 0 ? { rawDescription: descriptionParts.join(', ') } : {}),
    perceivedGender,
    source: 'preset_metadata',
    sourceKind: 'preset',
    tags,
  })
}

export function buildVoiceProfileFromAnalysis(params: {
  analysis: VoiceProfileAnalysis
  sourceKind: Extract<VoiceProfileSourceKind, 'uploaded_audio' | 'voice_clone'>
}): VoiceProfile {
  const { analysis, sourceKind } = params

  return normalizeVoiceProfile({
    ...(analysis.ageRange ? { ageRange: analysis.ageRange } : {}),
    ...(compactString(analysis.rawDescription)
      ? { rawDescription: compactString(analysis.rawDescription) }
      : {}),
    perceivedGender: analysis.perceivedGender,
    source: 'audio_analysis',
    sourceKind,
    tags: analysis.tags,
  })
}

export function normalizeVoiceProfile(profile: VoiceProfile): VoiceProfile {
  const dedupedTags = Array.from(
    new Set(profile.tags.map(normalizeTag).filter((tag): tag is string => Boolean(tag))),
  ).slice(0, 6)

  return {
    ...profile,
    ...(compactString(profile.localeLabel)
      ? { localeLabel: compactString(profile.localeLabel) }
      : {}),
    ...(compactString(profile.rawDescription)
      ? { rawDescription: compactString(profile.rawDescription) }
      : {}),
    tags: dedupedTags,
  }
}

function compactString(value: null | string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeTag(tag: string): string | undefined {
  const trimmed = tag.trim().toLowerCase()
  if (!trimmed) {
    return undefined
  }

  return trimmed.replace(/\s+/g, ' ')
}
