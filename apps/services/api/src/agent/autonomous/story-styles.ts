import fs from 'node:fs'

import { presetPackUri, presetPath } from '@reelmakeeasy/common/storage/presets'

const STYLES_FILE = 'story-mode/styles.json'

/** A preset Story Mode style, as autonomous mode starts a video with it. */
export interface StoryStyle {
  id: string
  /** The style's display name (sent as `styleName`). */
  label: string
  styleText: string
  /** The address of the style's thumbnail in the preset pack (`preset://...`): saved as is,
   *  and served as the URL `GET /api/story-mode/styles` gives when it reaches the browser. */
  thumbnailUrl?: string
}

export interface StoryStyleDeps {
  presetPackUri: (key: string) => string
  presetPath: (key: string) => string
}

interface StylesFile {
  styles: { id: string; label: string; styleText?: string; thumbnailUrl?: string }[]
}

const defaultDeps: StoryStyleDeps = { presetPackUri, presetPath }

/**
 * The preset style `id` from the same `presets/story-mode/styles.json` (its `styles` list) the
 * style picker reads through `GET /api/story-mode/styles`, with the thumbnail as its address in
 * the pack; null for an unknown id. Read on every call, like the styles route.
 */
export function findStoryStyle(id: string, deps: StoryStyleDeps = defaultDeps): null | StoryStyle {
  const file = JSON.parse(fs.readFileSync(deps.presetPath(STYLES_FILE), 'utf8')) as StylesFile
  const style = file.styles.find((s) => s.id === id)
  if (!style) return null
  return {
    id: style.id,
    label: style.label,
    styleText: style.styleText ?? '',
    ...(style.thumbnailUrl ? { thumbnailUrl: deps.presetPackUri(style.thumbnailUrl) } : {}),
  }
}
