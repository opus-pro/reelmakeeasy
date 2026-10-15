/**
 * Sample clips in the preset pack, one per way a video can move, so the user can see the
 * difference before picking: the Dynamic and Calm camera styles, and a loop short's
 * hit-hit-freeze-cut. Each is an 8 s silent H.264 MP4, 540px wide, with a JPEG poster of its
 * first frame. `scripts/build-preset-pack.mjs` ships these paths byte for byte (`COPIED_FILES`);
 * load them from the served pack: the web app's NEXT_PUBLIC_PRESET_PACK_URL, or, in the API,
 * their `presetPackUri` addresses (served as URLs on the way out). No `fs` here, so the web app
 * can import it.
 */
import type { CameraStyle } from '../long-take/camera-craft'

export interface CameraSample {
  /** JPEG of the clip's first frame. */
  poster: string
  /** The clip. */
  video: string
}

export type CameraSampleId = 'beat-loop' | CameraStyle

/** In the order a picker shows them. */
export const CAMERA_SAMPLE_IDS: readonly CameraSampleId[] = ['dynamic', 'calm', 'beat-loop']

const sample = (id: CameraSampleId): CameraSample => ({
  poster: `camera-samples/${id}.jpg`,
  video: `camera-samples/${id}.mp4`,
})

/** Paths in the preset pack. */
export const CAMERA_SAMPLES: Readonly<Record<CameraSampleId, CameraSample>> = {
  'beat-loop': sample('beat-loop'),
  calm: sample('calm'),
  dynamic: sample('dynamic'),
}

/** A sample's clip and poster URLs under the served preset pack (`<api>/api/presets/<version>`). */
export function cameraSampleUrls(presetPackUrl: string, id: CameraSampleId): CameraSample {
  const base = presetPackUrl.replace(/\/+$/, '')
  return {
    poster: `${base}/${CAMERA_SAMPLES[id].poster}`,
    video: `${base}/${CAMERA_SAMPLES[id].video}`,
  }
}
