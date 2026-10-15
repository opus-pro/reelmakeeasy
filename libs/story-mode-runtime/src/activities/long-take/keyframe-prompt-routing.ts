import type { LongTakePromptRoute } from '../../long-take-prompt-router'

import {
  detectCrowdScene,
  extractMaxFigureCount,
  type LongTakeCharacterAnchors,
} from './anchor-meta'
import type { LongTakeKeyframeGlobalContext } from './storage'

type LongTakeKeyframePromptBuildResult = {
  crowdScene: boolean
  fieldsUsed: string[]
  keyEntitiesCount: number
  prompt: string
  withTitle: boolean
}

export function buildRoutedLongTakeKeyframePrompt(params: {
  basePrompt: string
  characterAnchors?: LongTakeCharacterAnchors
  fieldsUsed: string[]
  globalContext: LongTakeKeyframeGlobalContext | null
  hasAnchorReference?: boolean
  hasUserFilePropAnchorReference?: boolean
  promptRoute?: LongTakePromptRoute
  styleText?: string
  withTitle: boolean
}): LongTakeKeyframePromptBuildResult | null {
  const { promptRoute } = params
  if (promptRoute === 'abstract') {
    return buildAbstractLongTakeKeyframePrompt(params)
  }
  if (promptRoute === 'ads-tangible' || promptRoute === 'ads-intangible') {
    return buildAdsLongTakeKeyframePrompt({ ...params, promptRoute })
  }
  return null
}

/**
 * Brand-product preservation directive (Layer 2) shared across routed
 * prompts and the general fallback. Appended last so it carries the
 * freshest attention weight. Current keyframe prompt assembly keeps this
 * disabled so IVS-on USER_FILE Prop prompts match the legacy/gate-off path.
 */
const BRAND_PRODUCT_PRESERVATION_DIRECTIVE =
  "Referenced object preservation: For any user-uploaded object or product referenced in this shot, preserve its base colors, label artwork, brand typography, visible brand text, markings, and product variant from the reference image. Do NOT recolor, redraw the label, change the variant, scene-harmonize the object's identity, or invent alternate flavors / product names / label text. Still integrate the object naturally into the shot — perspective, contact shadows, highlights, reflections, atmosphere, and material response are expected. The object's identity must remain faithful to the reference; only the lighting interaction with its surface should respond to the scene."

export { BRAND_PRODUCT_PRESERVATION_DIRECTIVE }

/**
 * Brand-logo-integrity context line, shared by the non-routed fallback prompt
 * (buildKeyframeContextLines) and the routed ads/abstract builders. Without it
 * on the routed paths, a script that names a brand in key_entities but binds no
 * logo asset lets the image model invent a brand logo on graphic shots. The line
 * is self-gating: a shot that does bind the real logo still reproduces it from
 * its reference. Gated on key entities (a named brand is what tempts the model)
 * and skipped for the `music` route. The paired entity-consistency line stays
 * fallback-only, so the routed prompts -- abstract especially -- stay compact.
 */
export function buildBrandLogoIntegrityLines(
  globalContext: LongTakeKeyframeGlobalContext | null,
  promptRoute?: LongTakePromptRoute,
): string[] {
  if (promptRoute === 'music' || !globalContext?.keyEntities.length) {
    return []
  }
  return [
    '- Brand logo integrity: never invent, redraw, or restyle a brand logo, wordmark, or brand-name lockup. Reproduce a brand logo only from a reference image supplied for this shot, matching it exactly; with no logo reference supplied, do not place any brand name as a logo, wordmark, or typographic lockup in the frame.',
  ]
}

/**
 * World-context lines for the non-routed fallback keyframe prompt. The
 * entity-consistency line is fallback-only (routed prompts skip it to stay
 * compact); the brand-logo integrity guard is shared with the routed builders
 * via buildBrandLogoIntegrityLines so every keyframe path carries it.
 */
export function buildKeyframeContextLines(
  globalContext: LongTakeKeyframeGlobalContext | null,
  options: { promptRoute?: LongTakePromptRoute } = {},
): string[] {
  const lines: string[] = []
  if (options.promptRoute !== 'music' && globalContext?.keyEntities.length) {
    lines.push(
      `- Entity consistency (shot description takes priority): ${globalContext.keyEntities.join(', ')}. Only render entities the shot calls for; keep their visual identity stable when they appear.`,
      ...buildBrandLogoIntegrityLines(globalContext, options.promptRoute),
    )
  }
  if (globalContext?.geoScope) {
    lines.push(
      `- Geographic atmosphere (evoke through environment, not text): ${globalContext.geoScope}.`,
    )
  }
  if (globalContext?.timeScope) {
    lines.push(
      `- Time-period anchor (convey through visual style, not date stamps): ${globalContext.timeScope}.`,
    )
  }
  return lines
}

function appendLanguageAndStyleDirectives(
  promptParts: string[],
  globalContext: LongTakeKeyframeGlobalContext | null,
  styleText?: string,
): void {
  const nonEnglishLanguage = resolveNonEnglishScriptLanguage(globalContext?.scriptLanguage)
  if (nonEnglishLanguage) {
    promptParts.push(
      `Text language: Render visible text in ${nonEnglishLanguage}. Keep quoted text above exactly as written.`,
    )
  }
  const normalizedStyleText = normalizeStyleInstructionText(styleText)
  if (normalizedStyleText) {
    promptParts.push(`Visual style: ${normalizedStyleText}`)
  }
}

function appendRouteSpecificCrowdDirective(
  promptParts: string[],
  params: {
    basePrompt: string
    characterAnchors?: LongTakeCharacterAnchors
    hasAnchorReference?: boolean
  },
): boolean {
  const characterAnchorCount = params.characterAnchors?.count ?? 0
  const characterAnchorKeywords = params.characterAnchors?.keywords ?? []
  const explicitFigureCount = extractMaxFigureCount(params.basePrompt, characterAnchorKeywords)
  const crowdScene =
    Boolean(params.hasAnchorReference) &&
    characterAnchorCount > 0 &&
    detectCrowdScene(params.basePrompt, characterAnchorKeywords) &&
    (explicitFigureCount > characterAnchorCount ||
      hasPluralizedAnchorKeyword(params.basePrompt, characterAnchorKeywords))

  if (crowdScene) {
    promptParts.push(
      'Multi-person reference note: if multiple people appear, use the referenced individual at most once and make all other people visually distinct.',
    )
  }
  return crowdScene
}

function buildAbstractLongTakeKeyframePrompt(params: {
  basePrompt: string
  characterAnchors?: LongTakeCharacterAnchors
  fieldsUsed: string[]
  globalContext: LongTakeKeyframeGlobalContext | null
  hasAnchorReference?: boolean
  hasUserFilePropAnchorReference?: boolean
  styleText?: string
  withTitle: boolean
}): LongTakeKeyframePromptBuildResult {
  const promptParts = [params.basePrompt.trim()].filter(Boolean)
  appendLanguageAndStyleDirectives(promptParts, params.globalContext, params.styleText)
  promptParts.push(
    'Abstract explainer directive: keep the frame simple, legible, and editorial. Use only the labels, numbers, arrows, shapes, screenshots, cutouts, or objects explicitly described above. Avoid extra cinematic metaphor, extra symbolic props, and small incidental text.',
    ...buildBrandLogoIntegrityLines(params.globalContext, 'abstract'),
  )
  if (params.hasAnchorReference) {
    promptParts.push(
      'Reference directive: use reference images only for the specifically named person or object; for a product or object, keep its exact material and finish, form, silhouette, proportions, and part structure faithful to the reference (do not swap materials such as metal for glass, and do not reshape its parts) unless the shot explicitly requests a change, and do not copy their layout.',
    )
  }
  const crowdScene = appendRouteSpecificCrowdDirective(promptParts, params)
  if (params.hasUserFilePropAnchorReference) {
    promptParts.push(BRAND_PRODUCT_PRESERVATION_DIRECTIVE)
  }
  return buildResult(params, promptParts, crowdScene, params.withTitle)
}

function buildAdsLongTakeKeyframePrompt(params: {
  basePrompt: string
  characterAnchors?: LongTakeCharacterAnchors
  fieldsUsed: string[]
  globalContext: LongTakeKeyframeGlobalContext | null
  hasAnchorReference?: boolean
  hasUserFilePropAnchorReference?: boolean
  promptRoute: Extract<LongTakePromptRoute, 'ads-intangible' | 'ads-tangible'>
  styleText?: string
}): LongTakeKeyframePromptBuildResult {
  const promptParts = [params.basePrompt.trim()].filter(Boolean)
  appendLanguageAndStyleDirectives(promptParts, params.globalContext, params.styleText)
  promptParts.push(
    buildAdsRouteDirective(params.promptRoute),
    ...buildBrandLogoIntegrityLines(params.globalContext, params.promptRoute),
  )
  if (params.hasAnchorReference) {
    promptParts.push(
      'Reference directive: use reference images only for the named brand, UI, logo, person, product, or object; preserve identity details — for a product or object, keep its exact material and finish, form, silhouette, proportions, and part structure faithful to the reference (do not swap materials such as metal for glass, and do not reshape or restyle its parts) unless the shot explicitly requests a change — and do not copy unrelated layout.',
    )
  }
  const crowdScene = appendRouteSpecificCrowdDirective(promptParts, params)
  if (params.hasUserFilePropAnchorReference) {
    promptParts.push(BRAND_PRODUCT_PRESERVATION_DIRECTIVE)
  }
  return buildResult(params, promptParts, crowdScene, false)
}

function buildAdsRouteDirective(
  promptRoute: Extract<LongTakePromptRoute, 'ads-intangible' | 'ads-tangible'>,
): string {
  if (promptRoute === 'ads-tangible') {
    return 'Product frame directive: keep this as a natural product moment. Use only text or claims explicitly described above; if a reference image is attached, preserve only text already present there. Avoid poster layout and invented ad copy.'
  }
  return 'Product-experience directive: keep this as a clean, believable product or service moment. Use only UI text or copy explicitly described above; if a reference image is attached, preserve only text already present there. Avoid poster layout and unsupported exact UI details.'
}

function buildResult(
  params: { fieldsUsed: string[]; globalContext: LongTakeKeyframeGlobalContext | null },
  promptParts: string[],
  crowdScene: boolean,
  withTitle: boolean,
): LongTakeKeyframePromptBuildResult {
  return {
    crowdScene,
    fieldsUsed: params.fieldsUsed,
    keyEntitiesCount: params.globalContext?.keyEntities.length || 0,
    prompt: promptParts.join('\n'),
    withTitle,
  }
}

/**
 * Whether the shot pluralizes an anchor's own keyword ("sailors" where "sailor"
 * is bound). These keywords come from CHARACTER anchors, so a hit is about
 * people by construction -- which is why the anti-cloning gate trusts it without
 * a separate human-figure test.
 */
export function hasPluralizedAnchorKeyword(basePrompt: string, keywords: string[]): boolean {
  const text = basePrompt?.trim()
  if (!text) {
    return false
  }
  return keywords.some((keyword) => {
    const normalized = keyword.trim()
    if (!normalized) {
      return false
    }
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
    return new RegExp(`\\b${escaped}s\\b`, 'i').test(text)
  })
}

function normalizeStyleInstructionText(styleText?: string): string {
  let normalized = styleText?.trim() || ''
  while (/^stylize the image with\s+/i.test(normalized)) {
    normalized = normalized.replace(/^stylize the image with\s+/i, '').trim()
  }
  return normalized
}

function resolveNonEnglishScriptLanguage(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return undefined
  }
  const lower = trimmed.toLowerCase()
  if (lower === 'en' || lower === 'eng' || lower === 'english' || lower.startsWith('en-')) {
    return undefined
  }
  return trimmed
}
