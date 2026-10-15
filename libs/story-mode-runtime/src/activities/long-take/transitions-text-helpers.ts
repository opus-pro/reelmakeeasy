import type { LongTakeTransitionPromptRefinementInput } from '../../workflows/long-take/types'

export function detectSameSubject(transition: LongTakeTransitionPromptRefinementInput): boolean {
  if (transition.fromPrompt.trim() === transition.toPrompt.trim()) {
    return true
  }

  const fromTokens = tokenizeForOverlap(
    `${transition.fromKeyframePrompt} ${transition.fromPrompt}`.toLowerCase(),
  )
  const toTokens = tokenizeForOverlap(
    `${transition.toKeyframePrompt} ${transition.toPrompt}`.toLowerCase(),
  )
  return jaccardOverlap(fromTokens, toTokens) >= 0.34
}

export function estimateSemanticJump(transition: LongTakeTransitionPromptRefinementInput): number {
  const fromTokens = tokenizeForOverlap(
    `${transition.fromKeyframePrompt} ${transition.fromPrompt}`.toLowerCase(),
  )
  const toTokens = tokenizeForOverlap(
    `${transition.toKeyframePrompt} ${transition.toPrompt}`.toLowerCase(),
  )
  return 1 - jaccardOverlap(fromTokens, toTokens)
}

export function formatThreePartPrompt(
  sceneAAction: string,
  transitionMovement: string,
  sceneBAction: string,
): string {
  return [
    sceneAAction ? `Scene A: ${sceneAAction}` : '',
    transitionMovement ? `Transition: ${transitionMovement}` : '',
    sceneBAction ? `Scene B: ${sceneBAction}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function hasHeadlineText(keyframePrompt: string): boolean {
  if (/\b(headline|title\s+card|typograph(y|ic))\b/i.test(keyframePrompt)) {
    return true
  }
  if (/(large|massive)[,\s]+bold/i.test(keyframePrompt)) {
    return !/\b(icon|question\s+mark|exclamation\s+point)\b/i.test(keyframePrompt)
  }
  return false
}

export function jaccardOverlap(a: string[], b: string[]): number {
  const aSet = new Set(a)
  const bSet = new Set(b)
  const intersection = [...aSet].filter((token) => bSet.has(token)).length
  const union = new Set([...aSet, ...bSet]).size
  return union === 0 ? 0 : intersection / union
}

export function tokenizeForOverlap(text: string): string[] {
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'as',
    'at',
    'for',
    'in',
    'into',
    'of',
    'on',
    'the',
    'to',
    'with',
  ])

  return text
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopWords.has(token))
}
