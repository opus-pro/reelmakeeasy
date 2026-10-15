import type { DictationEngine, DictationSetting } from '@shared/types/api/setup'

/** The text box's value with `spoken` put in at `cursor`, a space on either side as needed, and
 *  where the cursor goes after it. */
export function insertSpoken(
  value: string,
  spoken: string,
  cursor: number = value.length,
): { cursor: number; value: string } {
  const text = spoken.trim()
  if (!text) return { cursor, value }
  const at = Math.max(0, Math.min(cursor, value.length))
  const before = value.slice(0, at)
  const after = value.slice(at)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^\s/.test(after) ? ' ' : ''
  const next = `${before}${lead}${text}${trail}${after}`
  return { cursor: before.length + lead.length + text.length + trail.length, value: next }
}

/** `m:ss` for the recording timer. */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** The recording format this browser can make: WebM/Opus (Chrome, Firefox), else MP4 (Safari). */
export function recordingMimeType(
  isSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
): string | undefined {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(isSupported)
}

/** What each engine costs the user: free ones are listed first, paid ones after. */
export const DICTATION_PRICE: Record<DictationEngine, 'free' | 'paid'> = {
  browser: 'free',
  fal: 'paid',
  gemini: 'paid',
  local: 'free',
}

/** The order voice typing's choices are listed in: Auto, the free engines, the paid ones, Off. */
export const DICTATION_MENU_ORDER: DictationSetting[] = [
  'auto',
  'local',
  'browser',
  'gemini',
  'fal',
  'off',
]
