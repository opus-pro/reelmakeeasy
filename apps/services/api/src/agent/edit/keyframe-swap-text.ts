// The words of `use_image_as_keyframe`: its card, its answer to the agent, and the notes the
// chat and the agent get when the change is done or didn't finish. The user reads the card and
// the chat's notices; the agent reads the rest and tells the user in its own plain words.

import type { AgentQuestion } from '@shared/types/api/agent'

import {
  keyframePicturePath,
  type KeyframeSwapClip,
  type KeyframeSwapPlan,
} from '../../long-take/long-take-keyframe-swap.util'
import { KEEP_LOOP_LABEL, MAKE_LOOP_LABEL } from '../craft/beat-loop-skill'

import type { FittedPicture } from './keyframe-picture'

/** The card's buttons: the same words as the loop's "Make it?" card. */
export const USE_PICTURE_LABEL = MAKE_LOOP_LABEL
export const KEEP_PICTURE_LABEL = KEEP_LOOP_LABEL
/** The card's one question id: its answer is `answers[USE_PICTURE_ANSWER]`. */
export const USE_PICTURE_ANSWER = 'use'

/** Where the keyframe change stopped, when it didn't finish. */
export type KeyframeSwapStage = 'clips' | 'loop' | 'picture' | 'render'

const TELL_FAILURE =
  'Tell the user in one or two plain sentences what went wrong (no file paths, tool names or notes to yourself) and offer a fix. Ask before making anything.'

/** The card: what the picture becomes, the clips made again (when, on which model) and the
 *  cost; "Make it" or "Not now". */
export function keyframeCardQuestion(plan: KeyframeSwapPlan): AgentQuestion {
  const { clips } = plan
  const many = clips.length > 1
  const after = plan.loop
    ? 'each from the clip before, then the loop is rebuilt'
    : 'then the video is rebuilt'
  return {
    header: 'New picture',
    id: USE_PICTURE_ANSWER,
    isOther: false,
    isSecret: false,
    options: [
      {
        description: `${pictureRole(plan)} ${clipsPhrase(clips)} (${span(clips)}) ${many ? 'are' : 'is'} made again from it on ${plan.modelLabel}, with the same moves, ${after}.`,
        label: USE_PICTURE_LABEL,
      },
      { description: 'Nothing is changed or spent.', label: KEEP_PICTURE_LABEL },
    ],
    question: `Put the new picture in the video? About ${usd(plan.totalUsd)}`,
  }
}

/** The tool's answer while the card waits: the clips, the cost, how the picture was fitted, and
 *  what the user does next, by the card's real buttons. */
export function keyframeToolAnswer(plan: KeyframeSwapPlan, fitted: FittedPicture): string {
  return JSON.stringify({
    clips: plan.clips.map((clip) => ({
      clip: clip.number,
      id: clip.id,
      seconds: `${seconds(clip.startMs)}-${seconds(clip.endMs)}`,
      usd: clip.usd,
    })),
    estimatedCostUsd: plan.totalUsd,
    keyframe: plan.shotId,
    model: plan.modelLabel,
    next: `A card in the chat now shows the user which clips are made again and the cost, with two buttons: "${USE_PICTURE_LABEL}" and "${KEEP_PICTURE_LABEL}". Nothing is changed or spent until the user clicks "${USE_PICTURE_LABEL}" there (typing "${USE_PICTURE_LABEL}" in the chat does the same). Tell them that, in one or two plain sentences, calling the button by that name. Never answer the card for them. When the change is done (a few minutes), you get a note saying how it went.`,
    picture: FITTED[fitted.changed](plan.frame),
    status: 'waiting_for_make_it',
  })
}

/**
 * The agent's note when the change is done; `extra` names what the run flagged. It says where
 * to look at the change: the new picture under the keyframe's own name, and on a story video
 * the new clips' files (`clipFiles`, made under new names), so a check or a second fix starts
 * from them and not from the files they replaced.
 */
export function keyframeDoneNote(
  plan: KeyframeSwapPlan,
  extra = '',
  clipFiles: string[] = [],
): string {
  const { clips } = plan
  const made = plan.loop
    ? `${clipsPhrase(clips)} of the loop ${clips.length > 1 ? 'were' : 'was'} made again from it, each from the clip before (about ${usd(plan.totalUsd)}), and the loop was rebuilt`
    : `${clipsPhrase(clips)} (${span(clips)}) ${clips.length > 1 ? 'were' : 'was'} made again from it (about ${usd(plan.totalUsd)}) and the video was rebuilt`
  const picture = `project/${keyframePicturePath(plan.shotId)}`
  const newClips = clipFiles.length
    ? `, the new ${clipFiles.length > 1 ? 'clips are' : 'clip is'} ${listed(clipFiles)}`
    : ''
  const look = `To look at it: the new picture is ${picture} (the one it replaced is in project/long_take/keyframes/replaced/)${newClips}, and the video is project/final_video.mp4. Start any check or further fix from these files, not from earlier copies.`
  const done = [
    `ReelMakeEasy note, not shown to the user: the new picture is ${keyframeName(plan)} now. ${made}; it plays in the chat.`,
    extra,
    look,
  ]
  return [
    done.filter(Boolean).join(' '),
    `Tell the user in one or two plain sentences, and ask them to check that part (${span(clips)}).`,
  ].join('\n\n')
}

/**
 * The chat's notice and the agent's note when the change didn't finish: `outcome` is the run's
 * 'Stopped.' or 'Failed: <reason>' (or a reason of its own). A stop before anything changed
 * tells only the chat: the user stopped it.
 */
export function keyframeFailure(
  plan: KeyframeSwapPlan,
  stage: KeyframeSwapStage,
  outcome: string,
): { note?: string; notice: string } {
  const stopped = outcome === 'Stopped.'
  const reason = outcome.replace(/^Failed: /, '')
  const name = keyframeName(plan)
  const first = plan.clips[0]
  const clips = clipsPhrase(plan.clips).toLowerCase()
  const one = plan.clips.length === 1
  const why = stopped ? 'The user pressed Stop.' : `ReelMakeEasy's reason: ${reason}`
  const ask = stopped
    ? 'Say in one plain sentence where things stand, and offer to finish it.'
    : TELL_FAILURE
  const note = (what: string, fix: string) =>
    `ReelMakeEasy note, not shown to the user: ${what} ${why}\n\n${ask} ${fix}`
  const tryAgain =
    'To try again, call use_image_as_keyframe again with the same picture: a new card asks the user first.'
  if (stage === 'clips') {
    return stopped
      ? { notice: "Stopped: the video wasn't changed." }
      : {
          note: note(
            `putting the new picture in as ${name} failed while making ${clips} again, so the video wasn't changed (a clip made before the failure may still have been paid for).`,
            tryAgain,
          ),
          notice: `Couldn't put the new picture in the video: ${reason}. The video wasn't changed.`,
        }
  }
  if (stage === 'picture') {
    return {
      note: note(
        `${clips} ${one ? 'was' : 'were'} made again from the new picture, but it couldn't be saved as ${name}, so the video wasn't rebuilt.`,
        `render_video rebuilds the video with the new clips (free, about a minute); ${tryAgain}`,
      ),
      notice: `The new clips are made, but the picture couldn't be saved as ${name}: ${reason}`,
    }
  }
  if (stage === 'render') {
    return {
      note: note(
        `the new picture is ${name} now and ${clips} ${one ? 'was' : 'were'} made again from it, but the video wasn't rebuilt.`,
        'Offer to rebuild it: render_video (free, about a minute).',
      ),
      notice: stopped
        ? "Stopped: the new picture and clips are in, but the video wasn't rebuilt."
        : `The new picture and clips are in, but the video couldn't be rebuilt: ${reason}`,
    }
  }
  const ids = plan.clips.map((clip) => clip.id).join(', ')
  return {
    note: note(
      `the new picture is ${name} now and ${clips} ${one ? 'starts' : 'start'} over (${ids}), but the loop's run stopped before it was finished, so the loop wasn't rebuilt.`,
      `To finish it, call regenerate_clip with no changes on the first of ${ids} the run didn't make (ReelMakeEasy's reason usually names it; ${first?.id ?? 'the first'} when unsure): the loop runs again from there and makes the clips still missing, about ${first ? usd(first.usd) : 'one clip'} each.`,
    ),
    notice: stopped
      ? "Stopped: the new picture is in, but the loop wasn't rebuilt."
      : `Couldn't finish the loop with the new picture: ${reason}`,
  }
}

const FITTED: Record<FittedPicture['changed'], (frame: KeyframeSwapPlan['frame']) => string> = {
  cropped: (frame) =>
    `Fitted to the keyframe's ${frame.width}x${frame.height}: a sliver was cropped off two edges.`,
  none: () => "Already the keyframe's size.",
  resized: (frame) => `Fitted to the keyframe's ${frame.width}x${frame.height}.`,
}

/** What the picture becomes, for the user: where it sits between the clips. */
function pictureRole(plan: KeyframeSwapPlan): string {
  if (plan.loop) {
    // The loop's first clip leaves its opening picture; any other frame is where one lands.
    return plan.clips[0] && !plan.clips[0].lands
      ? "It becomes the loop's first picture, which it begins and ends on."
      : `It becomes the picture clip ${plan.clips[0]?.number} lands on.`
  }
  const landing = plan.clips.find((clip) => clip.lands)
  const leaving = plan.clips.find((clip) => !clip.lands)
  const where =
    landing && leaving
      ? `where clip ${landing.number} ends and clip ${leaving.number} begins`
      : landing
        ? `where clip ${landing.number} ends`
        : `where clip ${leaving?.number ?? 1} begins`
  return `It becomes keyframe ${plan.shotId}, ${where}.`
}

/** "keyframe 2", or a loop's "keyframe f3". */
function keyframeName(plan: KeyframeSwapPlan): string {
  return `keyframe ${plan.shotId}`
}

/** "a", "a and b", "a, b and c". */
function listed(items: string[]): string {
  return items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
    : (items[0] ?? '')
}

/** "Clip 3", "Clips 1 and 2", "Clips 3 to 6". */
function clipsPhrase(clips: KeyframeSwapClip[]): string {
  const numbers = clips.map((clip) => clip.number)
  if (numbers.length === 1) return `Clip ${numbers[0]}`
  if (numbers.length === 2) return `Clips ${numbers[0]} and ${numbers[1]}`
  return `Clips ${numbers[0]} to ${numbers[numbers.length - 1]}`
}

/** The time the clips cover, "0-8.7 s". */
function seconds(ms: number): string {
  return String(Math.round(ms / 100) / 10)
}

function span(clips: KeyframeSwapClip[]): string {
  const first = clips[0]
  const last = clips[clips.length - 1]
  return first && last ? `${seconds(first.startMs)}-${seconds(last.endMs)} s` : ''
}

function usd(amount: number): string {
  return `$${(Math.round(amount * 100) / 100).toFixed(2)}`
}
