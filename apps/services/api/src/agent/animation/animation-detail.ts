import type { AnimationLookId, AnimationStyleId, VideoDetail } from '@shared/types/api/agent'

import { detailBrief } from '../video-detail'

/** What each detail level means for a look's own technique, for `brief.md`: how many parts, how
 *  many particles, how fine the pixel grid (the level itself is in `video-detail`). */
const FOR_LOOK: Record<AnimationLookId, Record<VideoDetail, string>> = {
  '2d': {
    high: 'Shading and highlights on the characters, textured backgrounds with 3 parallax layers, props built from several parts, squash and stretch, follow-through on hair, ears and clothes.',
    low: 'Flat shapes, a plain background, one prop.',
    medium:
      'Soft outlines, a background with 2-3 layers, props that react to the talk, blinks and small gestures.',
    xhigh:
      'Every surface shaded (two tones, a highlight and a rim), patterned or textured backgrounds with 4 or more parallax layers and ambient life (leaves, steam, birds, sparkles), particle bursts on the key words, characters full of secondary motion, and every scene change a designed transition.',
  },
  '3d': {
    high: 'A hero of 80 or more parts with bevels and glowing details, an environment around it (ground detail, props, layers of fog), and instanced particle effects of 200 or more.',
    low: 'A hero of about 10 parts, plain materials, a slow orbit.',
    medium:
      'A hero of 30 or more parts, two or three materials, one cutaway or opening, labels that animate in.',
    xhigh:
      'A hero of 150 or more parts, down to screws, seams and cables, with curves smooth enough to hold up close (64 or more segments). Instanced particle systems (`THREE.InstancedMesh`) of 1,000-5,000 grains, bubbles, sparks or fragments. Scene changes where the hero shatters into instanced fragments and re-forms, and light that sweeps across it.',
  },
  '8bit': {
    high: 'The pixel grid at `res={360}` (3×3 screen pixels each, 360 across): dithered shading, parallax layers, 4-6 frames per sprite move.',
    low: 'The pixel grid at `res={180}` (6×6 screen pixels each, 180 across): chunky, few colours, simple shapes, 2 frames per sprite move.',
    medium:
      'The pixel grid at `res={270}` (4×4 screen pixels each, 270 across, the default): clear shapes, a few dithered shadows, 3-4 frames per sprite move.',
    xhigh:
      'The pixel grid at `res={540}` (2×2 screen pixels each, 540 across): fine pixel art with dithered gradients, layered parallax, 8 or more frames per sprite move and hundreds of pixel particles. It stays 8-bit (a small palette, hard pixel edges, posterized light); only the grid is finer.',
  },
  avatar: {
    high: 'A set with depth (2-3 layers), props on the board built from several parts, the host gesturing and walking with follow-through, particle accents on the key words.',
    low: 'A plain set, one picture at a time on the board.',
    medium:
      'A set that drifts, pictures that pop in on their words with a settle, a scene change between sections.',
    xhigh:
      'Each section its own designed set (patterns, props, lighting), boards built from many parts that animate one by one, the host always moving (walking, pointing, leaning in), particle bursts and sound on every key word, and scene changes that break apart and re-form.',
  },
}

/** `brief.md`'s Detail section for an animation in this look (an Avatar explainer in Pixel art:
 *  the pixel grid, then the host). */
export function animationDetailBrief(
  lookId: AnimationLookId,
  detail: VideoDetail,
  stage?: AnimationStyleId,
): string {
  const here =
    lookId === 'avatar' && stage === '8bit'
      ? `${FOR_LOOK['8bit'][detail]} The host: ${FOR_LOOK.avatar[detail]}`
      : FOR_LOOK[lookId][detail]
  return detailBrief(detail, here)
}
