import {
  PURE_COLOR_SCREEN_TRANSITION_GUARD,
  SEEDANCE_25_MOMENTUM_LANGUAGE,
} from '../long-take/seedance2-montage-prompt'

export type V3ClipPromptShotInput = {
  /** Text spoken over this clip; pacing reference only, never something to depict. */
  audio?: string
  /** The whole clip written in time order, straight from the visual script. */
  coreDescription: string
  durationSeconds: number
  shotId: string
  /** null on the last shot, which hands off to nothing. */
  transitionToNext: 'continuous' | 'cut' | null
}

/**
 * Build the meta-prompt that turns one Story Mode 3.0 shot into the prompt the
 * video model actually receives.
 *
 * Runs AFTER keyframe generation, and multimodally: the model is shown the
 * rendered opening frame (and, for a `continuous` hand-off, the next shot's
 * opening frame) rather than a description of them. That is the whole reason
 * this stage is separate from the keyframe stage -- describing motion away from
 * a frame you can see is guesswork, and the visual script's description is a
 * design brief, not a render-ready prompt.
 *
 * Two fields out, not one. `motion_prompt` is what happens inside this take;
 * `transition_prompt` is only how it lands on the next composition. Keeping them
 * apart lets each be constrained separately and inspected separately when a bad
 * clip needs diagnosing -- merged, there is nothing to tune.
 */
export function buildLongTakeV3ClipPrompt(params: {
  shots: V3ClipPromptShotInput[]
  styleText?: string
}): string {
  const style = params.styleText?.trim()
  const styleBlock = style
    ? `

Style (applies to every prompt):
Keep the look consistent with the keyframes you are shown; they were already rendered in this style. Do not restate the style guide as a label or append "in X style" -- the frames carry it.
${style}`
    : ''

  const shotsJson = JSON.stringify(
    params.shots.map((shot) => ({
      audio: shot.audio || '',
      core_description: shot.coreDescription,
      duration_seconds: Number(shot.durationSeconds.toFixed(2)),
      shot_id: shot.shotId,
      transition_to_next: shot.transitionToNext,
    })),
    null,
    2,
  )

  return `Role: Video Prompt Director.

Task:
For each shot you are given one rendered OPENING FRAME, the shot's design brief, and its duration. Write the prompt a video model will use to animate that frame for exactly that duration. Shots whose transition_to_next is "continuous" also come with the NEXT shot's opening frame; those must land on it.

Images are supplied in shot order and labelled in the text before each one. Read every frame you are given -- the subject, wardrobe, lighting, lens, and composition in the image are the truth. Where the brief and the frame disagree, the frame wins.

motion_prompt (required for every shot):
- Describe what happens across the WHOLE clip, in time order, starting from the frame you were shown.
- Frame zero rule: do not re-describe the opening frame as setup. The subject, camera, or environment is already moving in the first fraction of a second. Begin mid-action -- reaching, turning, tracking, revealing, reacting, opening, landing.
- Carry four layers as the shot progresses: [Subject] + [Action, present tense, already in motion] + [Environment / lighting] + [Camera].
- ${SEEDANCE_25_MOMENTUM_LANGUAGE}
- Design the motion, do not name it. "She reacts" is empty. "She snaps her head toward the door, shoulders dropping as the light behind her cuts out" is a design.
- Separate camera motion from subject motion: if the subject moves strongly, hold the camera; if the camera moves, keep the subject's own motion simple.
- Size the motion to duration_seconds. A 2s clip carries one clear move; an 8s clip earns a developing progression. Never pad a short clip with extra beats or leave a long one static.
- This is one continuous take. No cuts, no time jumps, no dissolves or fades inside the clip.
- The audio field is what is spoken over the clip. Use it for pacing and intent only; never render it as on-screen text and never add a narrator.
- Keep any text already visible in the frame exactly as it appears. Do not add new on-screen text, captions, watermarks, or UI copy.

transition_prompt (ONLY when transition_to_next is "continuous"; null otherwise):
- One or two sentences covering the END of the clip: how the camera physically travels from this composition and settles into the SECOND frame you were shown, arriving on it as the clip ends.
- Describe a path a real camera could take -- push through, pan across, rise over, track behind, rack focus onto. It must be continuous with the motion you designed above, not a separate move bolted on.
- The final moment must match the second frame's composition, lighting, subject position, and visual world.
- ${PURE_COLOR_SCREEN_TRANSITION_GUARD}
- Set it to null when transition_to_next is "cut" or null. A cut is made in post from adjacent clips; nothing about it belongs in the prompt, and describing one here produces a visible artifact inside the clip.

Never do:
- Do not describe editing: no "cut to", "match cut", "jump cut", "flashback", "meanwhile", "time-lapse", "split screen".
- Do not name the rendering style ("cinematic", "photorealistic", "3D render") -- the frame already establishes it.
- Do not invent a second subject, a second location, or an event the brief does not support.${styleBlock}

Output schema:
{
  "shots": [
    {
      "shot_id": "string",
      "motion_prompt": "string",
      "transition_prompt": "string or null"
    }
  ]
}

Output constraints:
- Return valid JSON only. No markdown fences, no commentary.
- Keep shot_id exactly as given, and return exactly one entry per input shot, in the same order.

shots:
${shotsJson}`
}
