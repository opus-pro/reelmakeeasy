import { GlobalConstraints, PacingSchema, PlannerAnchorRequest } from './types'

export function canonicalizeFreeText(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return normalizeWhitespace(value)
}

const SCRIPT_LANGUAGE_TAG_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

export function canonicalizeFreeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const normalized: string[] = []
  for (const item of value) {
    const next = canonicalizeFreeText(item)
    if (!next || seen.has(next)) {
      continue
    }
    seen.add(next)
    normalized.push(next)
  }
  return normalized
}

/**
 * Canonicalize the `style` sub-object. Beyond trimming the seed fields,
 * preserve the NST-derived analysis output (`reusable_prompt`,
 * `style_description`, `key_style_tags`, `color_palette`,
 * `reproduction_guidance`) verbatim so downstream consumers
 * (`normalizeStyleInstruction`, anchor image generation, world bible)
 * actually see the rich style data the `analyze_style` step produced.
 *
 * `color_palette` is preserved as a structured object; the other free-text
 * fields go through `canonicalizeFreeText` for whitespace normalization.
 */
export function canonicalizeGlobalConstraints(constraints: GlobalConstraints): GlobalConstraints {
  return {
    ...constraints,
    brand_scope: canonicalizeFreeText(constraints.brand_scope),
    directives: canonicalizeFreeTextList(constraints.directives),
    geo_scope: canonicalizeFreeText(constraints.geo_scope),
    key_entities: canonicalizeFreeTextList(constraints.key_entities),
    must_not_violate: canonicalizeFreeTextList(constraints.must_not_violate),
    pacing: canonicalizePacingValue(constraints.pacing),
    script_language: canonicalizeScriptLanguage(constraints.script_language),
    script_category:
      constraints.script_category === 'concept_centric' ||
      constraints.script_category === 'object_centric'
        ? constraints.script_category
        : undefined,
    style: canonicalizeStyle(constraints.style),
    target_audience: canonicalizeFreeText(constraints.target_audience),
    time_scope: canonicalizeFreeText(constraints.time_scope),
    tone: canonicalizeFreeText(constraints.tone).toLowerCase(),
    topic: canonicalizeFreeText(constraints.topic),
    video_type: canonicalizeFreeText(constraints.video_type),
  }
}

export function canonicalizeGlobalConstraintValue(
  path: keyof GlobalConstraints | string,
  value: unknown,
): unknown {
  switch (path) {
    case 'brand_scope': {
      return canonicalizeFreeText(value)
    }
    case 'directives': {
      return canonicalizeFreeTextList(value)
    }
    case 'geo_scope': {
      return canonicalizeFreeText(value)
    }
    case 'key_entities': {
      return canonicalizeFreeTextList(value)
    }
    case 'must_not_violate': {
      return canonicalizeFreeTextList(value)
    }
    case 'pacing': {
      return canonicalizePacingValue(value)
    }
    case 'script_category': {
      const normalized = canonicalizeFreeText(value)
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
      return normalized === 'concept_centric' || normalized === 'object_centric' ? normalized : ''
    }
    case 'script_language': {
      return canonicalizeScriptLanguage(value)
    }
    case 'style': {
      return canonicalizeStyle(value)
    }
    case 'target_audience': {
      return canonicalizeFreeText(value)
    }
    case 'time_scope': {
      return canonicalizeFreeText(value)
    }
    case 'tone': {
      return canonicalizeFreeText(value).toLowerCase()
    }
    case 'topic': {
      return canonicalizeFreeText(value)
    }
    case 'video_type': {
      return canonicalizeFreeText(value)
    }
    default: {
      return value
    }
  }
}

/**
 * The only script (voice-over) language ReelMakeEasy produces for now. The caption
 * render fonts in the preset pack cover English only, so a non-English script
 * would render captions with missing glyphs. Multi-language support comes later;
 * until then every spec is pinned here, whatever the planner or the user wrote
 * (see AGENTS.md, "English only for now").
 */
export const ENGLISH_ONLY_SCRIPT_LANGUAGE = 'en'

export function canonicalizeScriptLanguage(value: unknown): string {
  const normalized = canonicalizeFreeText(value).replace(/_/g, '-')
  if (!normalized) {
    return ''
  }
  // English only for now: a valid tag of any language canonicalizes to `en`.
  // Invalid tags stay '' so the field keeps reading as "unset".
  return SCRIPT_LANGUAGE_TAG_RE.test(normalized) ? ENGLISH_ONLY_SCRIPT_LANGUAGE : ''
}

function canonicalizeStyle(value: unknown): GlobalConstraints['style'] {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<
    GlobalConstraints['style']
  >
  const reusablePrompt = canonicalizeFreeText(source.reusable_prompt)
  const styleDescription = canonicalizeFreeText(source.style_description)
  const reproductionGuidance =
    typeof source.reproduction_guidance === 'string'
      ? canonicalizeFreeText(source.reproduction_guidance)
      : null
  const keyStyleTags = Array.isArray(source.key_style_tags)
    ? canonicalizeFreeTextList(source.key_style_tags)
    : undefined
  const colorPalette =
    source.color_palette && typeof source.color_palette === 'object'
      ? (source.color_palette as GlobalConstraints['style']['color_palette'])
      : undefined
  return {
    style_name: canonicalizeFreeText(source.style_name),
    style_text: canonicalizeFreeText(source.style_text),
    style_thumbnail_url: canonicalizeFreeText(source.style_thumbnail_url),
    ...(reusablePrompt && { reusable_prompt: reusablePrompt }),
    ...(styleDescription && { style_description: styleDescription }),
    ...(keyStyleTags && keyStyleTags.length > 0 && { key_style_tags: keyStyleTags }),
    ...(colorPalette && { color_palette: colorPalette }),
    ...(reproductionGuidance !== null && { reproduction_guidance: reproductionGuidance }),
  }
}

/** Validate a pacing value against the three canonical visual-pacing strings. */
export function canonicalizePacingValue(value: unknown): GlobalConstraints['pacing'] {
  if (value == null) {
    return null
  }
  const parsed = PacingSchema.safeParse(value)
  if (!parsed.success) {
    return null
  }
  return parsed.data
}

export function normalizeAnchorRequestsForRuntime(
  anchorRequests: null | PlannerAnchorRequest[] | undefined,
): null | PlannerAnchorRequest[] {
  if (!anchorRequests?.length) {
    return null
  }

  return anchorRequests.map((request) => {
    const sourceAssetIds = Array.from(
      new Set(
        (request.source_asset_ids ?? [])
          .map((value) => canonicalizeFreeText(value))
          .filter((value) => value.length > 0),
      ),
    )
    const primary = canonicalizeFreeText(request.source_asset_id)
    const normalizedPrimary = primary.length > 0 ? primary : (sourceAssetIds[0] ?? null)
    const normalizedIds =
      normalizedPrimary && !sourceAssetIds.includes(normalizedPrimary)
        ? [normalizedPrimary, ...sourceAssetIds]
        : sourceAssetIds

    return {
      ...request,
      anchor_id: canonicalizeFreeText(request.anchor_id),
      edit_instruction:
        canonicalizeFreeText(request.edit_instruction).length > 0
          ? canonicalizeFreeText(request.edit_instruction)
          : null,
      label:
        canonicalizeFreeText(request.label).length > 0 ? canonicalizeFreeText(request.label) : null,
      source_asset_id: normalizedPrimary,
      source_asset_ids: normalizedIds,
      source_update_mode:
        normalizedIds.length > 0
          ? request.source_update_mode === 'APPEND'
            ? 'APPEND'
            : 'REPLACE'
          : null,
    }
  })
}

export function normalizeExactLocks(
  exactLocks: Array<{ shot_id: string; text: string }> | null | undefined,
): Array<{ shot_id: string; text: string }> {
  return (exactLocks ?? [])
    .map((lock) => ({
      shot_id: normalizeShotId(lock.shot_id) ?? lock.shot_id.trim(),
      text: canonicalizeFreeText(lock.text),
    }))
    .filter((lock) => lock.shot_id.length > 0)
}

export function normalizeShotId(value: null | string | undefined): null | string {
  const normalized = canonicalizeFreeText(value)
  if (!normalized) {
    return null
  }

  const shotMatch = normalized.match(/^shot[_\s-]?(\d+)$/i)
  if (shotMatch) {
    return `shot_${Number.parseInt(shotMatch[1], 10)}`
  }

  const shortMatch = normalized.match(/^s(\d+)$/i)
  if (shortMatch) {
    return `shot_${Number.parseInt(shortMatch[1], 10)}`
  }

  return normalized
}

export function normalizeShotIdList(values: null | string[] | undefined): null | string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values ?? []) {
    const shotId = normalizeShotId(value)
    if (!shotId || seen.has(shotId)) {
      continue
    }
    seen.add(shotId)
    normalized.push(shotId)
  }
  return normalized.length > 0 ? normalized : null
}

export function normalizeStringList(values: null | string[] | undefined): null | string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values ?? []) {
    const next = canonicalizeFreeText(value)
    if (!next || seen.has(next)) {
      continue
    }
    seen.add(next)
    normalized.push(next)
  }
  return normalized.length > 0 ? normalized : null
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
