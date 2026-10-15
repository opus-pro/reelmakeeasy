// Compose the full generation-time style string from a saved style's pieces.
// Display keeps the short reusableStylePrompt; generation uses this
// richer assembly (style prompt + face logic + reproduction guidance + palette)
// so keyframe authoring sees the whole V6 analysis, not just the distilled
// prompt. Pure + defensive: inputs arrive as loosely-typed JSON read back from
// the styleMetadata column / snapshot records, so every field is validated.

export interface StyleGenerationParts {
  analysis?: unknown
  colorPalette?: unknown
  faceDepiction?: unknown
  reusableStylePrompt?: unknown
  summary?: unknown
}

export function buildGenerationStyleText(parts: StyleGenerationParts): string {
  const sections: string[] = []

  const reusable = asString(parts.reusableStylePrompt)
  if (reusable) {
    sections.push(reusable)
  }

  const analysis = asRecord(parts.analysis)

  const intent = asString(analysis?.intent)
  if (intent) {
    sections.push(`Style intent:\n${intent}`)
  }

  const visualRules = asStringArray(analysis?.visualRules)
  if (visualRules.length) {
    sections.push(`Visual rules:\n${bullets(visualRules)}`)
  }

  const face = asString(parts.faceDepiction)
  if (face) {
    sections.push(`Face depiction logic:\n${face}`)
  }

  const guidance: string[] = []
  const stays = asStringArray(analysis?.staysConsistent)
  if (stays.length) {
    guidance.push(`Always keep:\n${bullets(stays)}`)
  }
  const flex = asStringArray(analysis?.canFlex)
  if (flex.length) {
    guidance.push(`Can vary by subject:\n${bullets(flex)}`)
  }
  const fails = asStringArray(analysis?.failureModes)
  if (fails.length) {
    guidance.push(`Avoid:\n${bullets(fails)}`)
  }
  if (guidance.length) {
    sections.push(guidance.join('\n\n'))
  }

  const palette = formatPalette(parts.colorPalette)
  if (palette) {
    sections.push(`Palette: ${palette}`)
  }

  const summary = asString(parts.summary)
  if (summary) {
    sections.push(`Overall: ${summary}`)
  }

  return sections.join('\n\n')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

function bullets(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n')
}

// The analyzer palette groups (primary/secondary/accent) are lists of
// "Name (#hex) - NN%" strings; flatten them into one comma-joined line.
function formatPalette(value: unknown): string {
  const palette = asRecord(value)
  if (!palette) {
    return ''
  }
  return [
    ...asStringArray(palette.primary),
    ...asStringArray(palette.secondary),
    ...asStringArray(palette.accent),
  ].join(', ')
}
