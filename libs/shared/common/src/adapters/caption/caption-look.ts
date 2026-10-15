import type {
  CaptionFontChoice,
  CaptionPresetId,
  CaptionStyleSettings,
} from '@shared/types/api/caption-style'
import { isEqual } from 'lodash-es'

import type { CaptionRenderReference } from './caption-render-preference.zod'
import {
  type CaptionRenderPref,
  DEFAULT_CAPTION_ACCENT,
  readCaptionStyleSettings,
  resolveCaptionRenderPref,
} from './caption-style'
import { getDefaultCaptionRenderPref } from './default-caption-render-pref'

/**
 * The caption look a render draws, and the record it leaves behind so the app can tell whether
 * the delivered file still matches the look the user picked.
 *
 * Every render resolves its look once (`resolveCaptionLook`): the pref both renderers read
 * (`captionRenderPref`) and the settings it came from (`captionStyle`). Both are saved in the
 * video script (`storyboard/video_script.json`), which describes the render being made. Once
 * that render's file is uploaded, the settings are also written to
 * FINAL_VIDEO_CAPTION_STYLE_PATH, which describes the file: the status reports that record as
 * `renderedCaptionStyle`, and `captionLookChanged` compares it with the look wanted now.
 */

/**
 * The look final_video.mp4 has: `{ captionStyle: RenderedCaptionStyle | null }`, written by
 * finalizeRender right after it uploads the file (null: a render that drew the default look
 * without recording settings). A render that fails, or is still running, leaves the record of
 * the file that is there. Absent for files delivered before looks were recorded. It sits beside
 * the file, outside the trees a regenerate clones, so a new video never starts with its
 * source's record.
 */
export const FINAL_VIDEO_CAPTION_STYLE_PATH = 'final_video_caption_style.json'

/** Which default look a video's captions take when nobody chose one: loops Punch, others Classic. */
export type CaptionKind = 'loop' | 'video'

/**
 * The caption settings a render drew with, every default filled in, saved as `captionStyle` in
 * the video script (beside `captionRenderPref`) and, once the file is up, in its record:
 * - `preset`: the style drawn (the kind's default when none was chosen);
 * - `accent`: the highlight as chosen, upper-case `#RRGGBB` (`#04F827` when none was chosen; Punch
 *   still draws a near-white choice in the default);
 * - `position`: the caption centre, % of the frame height from the top, or null for the style's
 *   own (bottom) slot;
 * - `size`: % of the style's base font size (100 when none was chosen);
 * - `font`: the chosen font; absent for the style's own (Montserrat), so a look without one is
 *   recorded exactly as before fonts could be chosen (and such records read as the style's own).
 * Resolving it again gives the same pref, whatever the kind's default becomes later.
 */
export type RenderedCaptionStyle = {
  accent: string
  font?: CaptionFontChoice
  position: null | number
  preset: CaptionPresetId
  size: number
}

/** The look a render draws: the pref both renderers read, and the settings it came from. */
export interface CaptionLook {
  captionRenderPref: CaptionRenderPref
  captionStyle: RenderedCaptionStyle
}

const KIND_DEFAULT_PRESET: Readonly<Record<CaptionKind, CaptionPresetId>> = {
  loop: 'punch',
  video: 'classic',
}

/** Size at 100%: the style's own base size. */
const FULL_SIZE = 100

/** Explainer's animation: the highlight is the box behind the word, not the word's colour. */
const BOXED_HIGHLIGHT = 'word-level_simple_bg-highlight'

/**
 * The frame a video's captions are laid out for: a loop is always delivered at 9:16 (the loop
 * render upscales to 1080x1920), any other video at its own ratio, 9:16 when unknown. Every
 * resolution goes through it (the render, the previews, the Download check), so they agree.
 */
export function captionLayoutRatio(
  kind: CaptionKind,
  aspectRatio: null | string | undefined,
): string {
  return kind === 'loop' || !aspectRatio ? '9:16' : aspectRatio
}

/** The settings a video draws with: what was chosen (read like the saved column), defaults filled. */
export function effectiveCaptionStyle(settings: unknown, kind: CaptionKind): RenderedCaptionStyle {
  const chosen = readCaptionStyleSettings(settings) ?? {}
  return {
    accent: chosen.accent ?? DEFAULT_CAPTION_ACCENT,
    ...(chosen.font ? { font: chosen.font } : {}),
    position: chosen.position ?? null,
    preset: chosen.preset ?? KIND_DEFAULT_PRESET[kind],
    size: chosen.size ?? FULL_SIZE,
  }
}

/**
 * The look a render draws for these settings (the saved ones, or the ones the user was looking
 * at), on this frame (a loop's is always 9:16: captionLayoutRatio), for this kind of video. Null
 * settings on a 9:16 video give exactly `getDefaultCaptionRenderPref()`.
 */
export function resolveCaptionLook(
  settings: unknown,
  opts: { aspectRatio: string; kind: CaptionKind },
): CaptionLook {
  const chosen = readCaptionStyleSettings(settings)
  return {
    captionRenderPref: resolveCaptionRenderPref(chosen, {
      aspectRatio: captionLayoutRatio(opts.kind, opts.aspectRatio),
      kind: opts.kind,
    }),
    captionStyle: effectiveCaptionStyle(chosen, opts.kind),
  }
}

/**
 * The colour a loop's stamps take: the video's highlight as its caption style shows it. Most
 * styles colour the highlighted word with it (Punch after swapping out a near-white one);
 * Explainer paints it as the box behind the word, whose text takes a dark or white ink instead.
 */
export function captionStampColor(pref: CaptionRenderReference): string {
  const animation = pref.captionAnimation
  return animation?.name === BOXED_HIGHLIGHT && animation.bgColor
    ? animation.bgColor
    : pref.highlightColor.primary
}

/**
 * Whether rendering with `wanted` would change what the delivered file (rendered with
 * `rendered`, the status's `renderedCaptionStyle`) shows, so Download must render it again.
 * Both looks are resolved for the video's frame and kind and compared as the renderers draw
 * them, so two settings that draw the same captions (an unset field and its default, or two
 * near-white highlights Punch both draws in green) count as the same.
 *
 * - A file from before looks were recorded (`rendered` null) has the old default caption,
 *   `getDefaultCaptionRenderPref()`: Classic laid out for a 9:16 frame on every frame, loops
 *   included. So a loop nobody styled renders again into Punch, and so does a wide or square
 *   video, whose captions now sit where its own frame wants them (as the previews show); a 9:16
 *   video nobody styled downloads as it is.
 * - With the captions off (`enableCaption`: the export the user wants), the look shows only in a
 *   loop's stamps, which stay on and take the highlight colour (captionStampColor): a loop
 *   compares that colour, any other video nothing. Turning the captions on or off is a change
 *   of its own (the caption switch's), not this one's.
 */
export function captionLookChanged(params: {
  /** The video's frame, as the resolver reads it ('9:16', '16:9', ...); a loop's is always 9:16. */
  aspectRatio: string
  enableCaption: boolean
  kind: CaptionKind
  rendered: unknown
  wanted: unknown
}): boolean {
  const opts = {
    aspectRatio: captionLayoutRatio(params.kind, params.aspectRatio),
    kind: params.kind,
  }
  const wanted = resolveCaptionRenderPref(readCaptionStyleSettings(params.wanted), opts)
  const rendered =
    params.rendered == null
      ? getDefaultCaptionRenderPref()
      : resolveCaptionRenderPref(readCaptionStyleSettings(params.rendered), opts)
  if (params.enableCaption) {
    return !isEqual(wanted, rendered)
  }
  return params.kind === 'loop' && captionStampColor(wanted) !== captionStampColor(rendered)
}

/**
 * The caption settings a record says a render drew with (its `captionStyle`: the delivered
 * file's record, or a video script's), read field by field; null when it doesn't say (rendered
 * before caption looks were recorded).
 */
export function readRenderedCaptionStyle(record: unknown): CaptionStyleSettings | null {
  if (!record || typeof record !== 'object') {
    return null
  }
  return readCaptionStyleSettings((record as { captionStyle?: unknown }).captionStyle)
}
