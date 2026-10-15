// Audio and voiceover meta-tag utilities shared across web components.
//
// Uses a depth-counter paren walker so CDN URLs are handled correctly
// regardless of encoding. Three formats exist in production sessions:
//   legacy      : @audio[My-Song (1).mp4](...|.../My-Song%20(1).mp4)
//   intermediate: @audio[My-Song (1).mp4](...|.../My-Song%20(1%29.mp4)
//   current     : @audio[My-Song (1).mp4](...|.../My-Song%20%281%29.mp4)

/**
 * Finds the index one past the closing `)` of the meta-tag whose label
 * starts at `start`. Returns -1 when the tag is malformed or parens are
 * unbalanced.
 */
function findTagEnd(text: string, start: number): number {
  const labelOpen = text.indexOf('[', start)
  if (labelOpen === -1) {
    return -1
  }
  const labelClose = text.indexOf(']', labelOpen + 1)
  if (labelClose === -1) {
    return -1
  }
  const parenOpen = labelClose + 1
  if (parenOpen >= text.length || text[parenOpen] !== '(') {
    return -1
  }
  let depth = 0
  for (let i = parenOpen; i < text.length; i++) {
    if (text[i] === '(') {
      depth++
    } else if (text[i] === ')' && --depth === 0) {
      return i + 1
    }
  }
  return -1
}

/**
 * Removes all @audio and @vo meta-tags from text, leaving other tag types
 * (img, video, txt, etc.) intact. Handles CDN URLs with parentheses in
 * filenames regardless of whether the parens are literal or percent-encoded.
 */
export function stripAudioVoMetaTags(text: string): string {
  let result = ''
  let cursor = 0

  while (cursor < text.length) {
    const aIdx = text.indexOf('@audio[', cursor)
    const vIdx = text.indexOf('@vo[', cursor)
    if (aIdx === -1 && vIdx === -1) {
      break
    }
    const tagStart = aIdx === -1 ? vIdx : vIdx === -1 ? aIdx : Math.min(aIdx, vIdx)

    result += text.slice(cursor, tagStart)
    const end = findTagEnd(text, tagStart)
    if (end === -1) {
      // Broken/unmatched tag: treat everything from here as part of the tag.
      cursor = text.length
      break
    }
    cursor = end
  }

  result += text.slice(cursor)
  return result.trim()
}

/**
 * Returns true when the message text consists entirely of @audio/@vo
 * file-upload meta-tags (no typed text). Used to suppress the user message
 * bubble when the first UIP message was a pure file upload. The audio chip
 * renders via the audio_asset_list block, so the raw tag text in the bubble
 * would be misleading.
 */
export function isAudioVoUploadOnlyMessage(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && stripAudioVoMetaTags(trimmed).length === 0
}
