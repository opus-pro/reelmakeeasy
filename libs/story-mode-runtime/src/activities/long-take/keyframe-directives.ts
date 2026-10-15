import type { LongTakeHumanPresence } from '@reelmakeeasy/common/long-take/types'

import type { LongTakePromptRoute } from '../../long-take-prompt-router'

const HUMAN_EXCLUSION_DIRECTIVE =
  'Human exclusion directive: Do not add people, faces, bodies, hands, silhouettes, mannequins, or human-like characters. Keep the frame focused on the described non-human subjects. Anonymous crowds are allowed only when the prompt explicitly asks for a crowd, audience, background people, or group scene.'
const MUSIC_PERFORMANCE_DIRECTIVE =
  'Music performance directive: Do not add microphones, mic stands, headset mics, recording booths, or visible recording gear. Singing/rapping should read through the performer face, posture, movement, camera, lighting, wardrobe, and environment - not microphone props. For non-lip-sync singer close-ups, keep the mouth closed or neutral unless the shot is explicitly selected for lip sync.'
const SCRIPT_LANGUAGE_TAG_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

const HUMAN_FIGURE_PROMPT_REGEX =
  /\b(?:actor|actors|actress|actresses|adult|adults|artist|artists|athlete|athletes|audience|baby|babies|bodies|body|boy|boys|captain|character|characters|child|children|couple|crowd|crowds|customer|customers|dancer|dancers|doctor|employee|employees|face|faces|family|fans|father|figure|figures|friend|friends|girl|girls|group|hand|hands|he|her|hers|herself|him|himself|his|host|hosts|human|humans|influencer|influencers|kid|kids|man|mascot|men|model|models|mother|narrator|nurse|parent|parents|people|performer|performers|person|portrait|protagonist|protesters|rapper|rappers|runner|sailor|scientist|she|silhouette|silhouettes|singer|singers|soldier|speaker|speakers|student|students|teacher|teen|teens|traveler|travelers|woman|women|worker|workers)\b/i
const MUSIC_PERFORMANCE_PROMPT_REGEX =
  /\b(?:mouth singing|sing(?:s|ing)?\b|sang\b|rap(?:s|ping)?\b|vocal performance\b|perform(?:s|ing)?\s+(?:the\s+)?(?:song|chorus|hook|verse|lyric|lyrics|vocal|vocals|rap)\b|perform(?:s|ing)?\s+(?:directly\s+)?to\s+camera\b)/i

export function appendKeyframeDirectives(prompt: string, directives: string[]): string {
  const activeDirectives = directives.filter(Boolean)
  return activeDirectives.length > 0 ? `${prompt}\n${activeDirectives.join('\n')}` : prompt
}

export function appendOptionalKeyframeDirectives<T extends { prompt: string }>(
  result: T,
  directives: string[],
): T {
  const prompt = appendKeyframeDirectives(result.prompt, directives)
  if (prompt === result.prompt) {
    return result
  }
  return { ...result, prompt } as T
}

export function buildLongTakeKeyframeDirectives(params: {
  basePrompt: string
  hasAnchorReference?: boolean
  hasCharacterAnchorReference?: boolean
  humanPresence?: LongTakeHumanPresence
  promptRoute?: LongTakePromptRoute
}): string[] {
  return [
    shouldAppendHumanExclusionDirective({
      basePrompt: params.basePrompt,
      hasAnchorReference: Boolean(params.hasAnchorReference),
      hasCharacterAnchorReference: Boolean(params.hasCharacterAnchorReference),
      humanPresence: params.humanPresence ?? 'unknown',
    })
      ? HUMAN_EXCLUSION_DIRECTIVE
      : '',
    shouldAppendMusicPerformanceDirective({
      basePrompt: params.basePrompt,
      hasCharacterAnchorReference: Boolean(params.hasCharacterAnchorReference),
      humanPresence: params.humanPresence ?? 'unknown',
      promptRoute: params.promptRoute,
    })
      ? MUSIC_PERFORMANCE_DIRECTIVE
      : '',
  ]
}

export function buildScriptLanguageContextDirective(raw: string | undefined): string {
  const scriptLanguage = resolveScriptLanguageContext(raw)
  return scriptLanguage
    ? `Language context: the source song/script language is ${scriptLanguage}. Use this only for singing, lip-sync, and any visible text; it does not imply ethnicity, nationality, skin tone, or facial features.`
    : ''
}

/**
 * Whether the shot mentions a human figure at all.
 *
 * The same regex the human-exclusion directive is gated on, exported so the
 * anti-cloning gate can require it too: a directive about varying faces, builds
 * and facial hair is only worth spending on a shot that has people in it.
 */
export function mentionsHumanFigure(basePrompt: string): boolean {
  const text = basePrompt ?? ''
  if (HUMAN_FIGURE_PROMPT_REGEX.test(text)) {
    return true
  }
  // The list carries plurals for some words ("girls", "people") but not others
  // ("sailor", "scientist", "family"), and `\b` stops a singular entry matching
  // its own plural. A crowd is plural by definition, so the singular pass is the
  // one that matters: "several stylized sailors" has to read as people.
  //
  // Three forms, because one rule does not cover them: a naive `e?s` strip turns
  // "families" into "famili", which matches nothing.
  return [/\b(\w+?)ies\b/gi, /\b(\w+?)es\b/gi, /\b(\w+?)s\b/gi].some((plural, index) =>
    HUMAN_FIGURE_PROMPT_REGEX.test(text.replace(plural, index === 0 ? '$1y' : '$1')),
  )
}

// Returns a validated language hint when the source script language is known.
export function resolveScriptLanguageContext(raw: string | undefined): string | undefined {
  const normalized = raw?.trim().replace(/_/g, '-')
  if (!normalized) {
    return undefined
  }
  const lower = normalized.toLowerCase()
  if (lower === 'english') {
    return 'en'
  }
  if (!SCRIPT_LANGUAGE_TAG_RE.test(normalized)) {
    return undefined
  }
  return normalized
}

// Returns a human-readable language hint when the source script is non-English,
// or undefined when the script is English / unknown (image models default to
// English already, so we only need to override the default for other languages).
export function resolveNonEnglishScriptLanguage(raw: string | undefined): string | undefined {
  const scriptLanguage = resolveScriptLanguageContext(raw)
  if (!scriptLanguage) {
    return undefined
  }
  const lower = scriptLanguage.toLowerCase()
  if (lower === 'en' || lower === 'eng' || lower.startsWith('en-')) {
    return undefined
  }
  return scriptLanguage
}

function shouldAppendHumanExclusionDirective(params: {
  basePrompt: string
  hasAnchorReference: boolean
  hasCharacterAnchorReference: boolean
  humanPresence: LongTakeHumanPresence
}): boolean {
  if (params.humanPresence === 'none') {
    return !params.hasCharacterAnchorReference
  }
  if (params.humanPresence !== 'unknown') {
    return false
  }
  if (params.hasAnchorReference) {
    return false
  }
  return !HUMAN_FIGURE_PROMPT_REGEX.test(params.basePrompt)
}

function shouldAppendMusicPerformanceDirective(params: {
  basePrompt: string
  hasCharacterAnchorReference: boolean
  humanPresence: LongTakeHumanPresence
  promptRoute?: LongTakePromptRoute
}): boolean {
  if (params.promptRoute !== 'music' || !params.hasCharacterAnchorReference) {
    return false
  }
  if (params.humanPresence === 'singer_performance') {
    return true
  }
  if (params.humanPresence !== 'unknown') {
    return false
  }
  return MUSIC_PERFORMANCE_PROMPT_REGEX.test(params.basePrompt)
}
