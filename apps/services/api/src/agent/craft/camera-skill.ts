import {
  CAMERA_MOVES,
  CAMERA_STYLE_OPTIONS,
  DYNAMIC_MOVEMENT_RULES,
  preferredShotRhythm,
} from '@reelmakeeasy/common/long-take/camera-craft'

export const CAMERA_SKILL_NAME = 'reelmakeeasy-camera'

/**
 * The `reelmakeeasy-camera` Codex skill: the same camera rules the pipeline's Dynamic clip
 * prompts use, as a reference for planning and chat. ReelMakeEasy writes it into agent mode's
 * Codex home at every session start; `skills/reelmakeeasy-camera/SKILL.md` is the checked-in copy.
 */
export function renderCameraSkill(): string {
  return [
    '---',
    `name: ${CAMERA_SKILL_NAME}`,
    'description: Camera movement rules for ReelMakeEasy videos. Use when planning shots, storyboards, transitions or camera moves, or when the user asks for a more dynamic or calmer video.',
    '---',
    '',
    '# ReelMakeEasy camera rules',
    '',
    'ReelMakeEasy videos are made of keyframes joined by short generated clips. Each clip goes from one keyframe to the next, and its prompt decides how the camera and everything in the frame move.',
    '',
    '## The two camera styles',
    '',
    `- **Calm**: ${CAMERA_STYLE_OPTIONS.calm.description} Shots are usually ${preferredShotRhythm('calm')}. Suits reflective, explanatory or premium-feeling videos.`,
    `- **Dynamic**: ${CAMERA_STYLE_OPTIONS.dynamic.description} Shots are usually ${preferredShotRhythm('dynamic')}. Suits short social videos, news, facts and anything that must hold attention.`,
    '',
    'When the user asks for a livelier video, suggest Dynamic; when they find it too busy, suggest Calm.',
    '',
    '## Dynamic: how each clip is written',
    '',
    '- Each clip is two or three timed beats (`[m:ss.sss-m:ss.sss] text`), three when it is longer than 8 seconds.',
    '- When the narration moves to its next idea inside a clip, that moment is a beat edge: the outgoing scene keeps its energy until then and the incoming subject lands after it.',
    '- Each clip leads with one named camera move, and neighbouring clips never use the same one.',
    '',
    'Camera moves to rotate through:',
    ...CAMERA_MOVES.map((move) => `- ${move}`),
    '',
    DYNAMIC_MOVEMENT_RULES,
    '',
  ].join('\n')
}
