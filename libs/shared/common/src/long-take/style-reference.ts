import { z } from 'zod'

import type { Storage } from '../agent-v2/storage/storage'
import type { Content } from '../llm/clients/client'

/**
 * A project's style reference: the image from a user's saved image style, which the
 * image model receives next to the style text so pictures copy its look.
 *
 * The API copies the image into the project when a video starts and writes this file;
 * the keyframe and anchor steps read it. Keeping it in the project (not only on the
 * workflow input) means a later keyframe rerun still finds it, even after the saved
 * style is deleted.
 */
export const LONG_TAKE_STYLE_REFERENCE_PATH = 'long_take/style_reference.json'
export const LONG_TAKE_STYLE_REFERENCE_DIR = 'long_take/style_reference'

/** One reference is enough to carry a look, and each one costs input tokens on every picture. */
export const MAX_LONG_TAKE_STYLE_REFERENCES = 2

export const LongTakeStyleReferenceSchema = z.object({
  imageUris: z.array(z.string().min(1)).max(MAX_LONG_TAKE_STYLE_REFERENCES),
})
export type LongTakeStyleReference = z.infer<typeof LongTakeStyleReferenceSchema>

/**
 * Tells the model what the extra image is for. Without it, an image model treats every
 * reference as content to include, and pastes the reference's subject into the shot.
 */
export const STYLE_REFERENCE_INSTRUCTION =
  'Style reference image: render the picture in the same visual style as this image ' +
  '(medium and rendering technique, color palette, lighting, texture and line work). ' +
  'Do not copy its subject, characters, objects, layout or any text in it.'

/** The parts to append to an image request: the instruction, then each reference image. */
export function buildStyleReferenceContents(imageUris: readonly string[]): Content[] {
  const uris = imageUris
    .map((uri) => uri.trim())
    .filter(Boolean)
    .slice(0, MAX_LONG_TAKE_STYLE_REFERENCES)
  if (uris.length === 0) {
    return []
  }
  return [
    { type: 'text', text: STYLE_REFERENCE_INSTRUCTION },
    ...uris.map((imageUrl): Content => ({ type: 'image_url', imageUrl })),
  ]
}

/** Reads the project's style reference images; none when the file is absent or invalid. */
export async function readLongTakeStyleReferenceUris(storage: Storage): Promise<string[]> {
  try {
    if (!(await storage.exists(LONG_TAKE_STYLE_REFERENCE_PATH))) {
      return []
    }
    const parsed = LongTakeStyleReferenceSchema.safeParse(
      await storage.readJsonFile<unknown>(LONG_TAKE_STYLE_REFERENCE_PATH),
    )
    return parsed.success ? parsed.data.imageUris : []
  } catch {
    return []
  }
}
