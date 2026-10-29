import { VIDEO_DETAIL_LABEL } from '@reelmakeeasy/common/motion-reel/video-detail'
import type { VideoDetail } from '@shared/types/api/agent'

/**
 * The detail level the user picked for a code video, as its `brief.md` tells the agent: who to
 * work as, what the level means for any video, and (from the caller) what it means for this
 * kind of video. The video needn't look like the skill's examples; the level is how far the
 * agent takes the craft.
 */

const DESIGNER =
  'Work as a professional motion graphics designer with a sharp eye for detail and real animation taste: every frame looks designed, every move is eased and lands on a word or a beat, and nothing on screen is there by accident.'

/** What each level means for any code video. */
const LEVEL: Record<VideoDetail, string> = {
  high: 'Rich. Layered depth in every scene (foreground, middle and background moving at different speeds) and 10-20 elements. Everything that moves follows through: it overshoots, settles and trails. Materials have texture and light (soft shadows, a rim light, a glow on what matters). Every big moment gets a particle effect of 100-300 particles (sparks, dust, bubbles). Scenes change with transitions that transform them (the picture breaks apart, morphs or flies through), not plain cuts.',
  low: 'Clean and simple. A few bold elements per scene (3-5), flat colours, one clear move per scene, simple cuts or fades between scenes. Readable at a glance: spend the effort on the story.',
  medium:
    'Polished. 6-10 elements per scene, each entering on its word with an eased move and a little overshoot. The background drifts, so no frame is frozen. One or two secondary motions per scene (a wobble, a settle, a glow). Transitions that move (a slide, a push, a zoom), and small accents of 10-30 particles.',
  xhigh:
    'Film grade: the most detail you can build. Nothing is ever still: every element has micro-motion (breathing, drifting, flickering light). The hero is built from many fine parts (seams, bevels, screws, cables, panel lines). Effects use 1,000 or more particles that move with physics (gravity, drag, turbulence, bouncing off the ground): sand that pours and settles, bubbles that rise and pop, sparks with trails, dust in the light. Scene changes break the picture into those particles and re-form the next one. Light changes over time; fast moves get motion blur; every hit has a sound and a flash. Look at your stills at full size and add detail wherever a frame looks plain. This takes more time and tokens: take them.',
}

/** `brief.md`'s Detail section: the level, who to work as, what it means in general and `here`
 *  (for this look or kind of reel). */
export function detailBrief(detail: VideoDetail, here: string): string {
  const label = VIDEO_DETAIL_LABEL[detail]
  return [
    `## Detail: ${label}`,
    '',
    DESIGNER,
    '',
    `- **${label}:** ${LEVEL[detail]}`,
    `- **Here:** ${here}`,
    '- The examples in the skill show the technique, not the ceiling: match this level, even where it means going well past them. Particles and anything else that moves are set from t alone (seeded, closed-form), never from the previous frame.',
  ].join('\n')
}
