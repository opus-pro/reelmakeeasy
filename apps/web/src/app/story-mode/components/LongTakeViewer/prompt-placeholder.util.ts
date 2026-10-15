// Preset prompts ship a bracketed blank the user is meant to fill in, e.g.
// 'Regenerate this shot, make it better by improving: [               ]'.
const UNFILLED_PLACEHOLDER = /\[\s*\]/

export function hasUnfilledPlaceholder(prompt: string): boolean {
  return UNFILLED_PLACEHOLDER.test(prompt)
}
