import type { AgentHarnessName, AgentMode } from '@shared/types/api/agent'

import { MAKE_LOOP_LABEL } from '../craft/beat-loop-skill'

export type AgentToolName =
  | 'generate_image'
  | 'make_beat_loop'
  | 'make_video'
  | 'motion_music'
  | 'motion_render'
  | 'motion_still'
  | 'regenerate_clip'
  | 'render_video'
  | 'set_music'
  | 'use_image_as_keyframe'

/** A Codex dynamic tool, as `thread/start` declares it. */
export interface DynamicToolSpec {
  description: string
  inputSchema: Record<string, unknown>
  name: AgentToolName
}

/** What a tool call answers: `text` goes back to Codex as the tool's output. */
export interface ToolCallResult {
  success: boolean
  text: string
}

export const AGENT_TOOLS: Record<AgentToolName, DynamicToolSpec> = {
  generate_image: {
    description:
      'Make or change one picture (a few cents). It appears in the chat. Before the video: a style preview, when the user wants to see the look, never to try things; pass reference_image (a path an earlier generate_image returned) to change that preview. Once the video exists: to fix a keyframe (a wrong hand, a stray object), pass it as reference_image (e.g. project/long_take/keyframes/2.png) and say only what to change, keeping everything else; show the user the result, and use_image_as_keyframe puts it in the video when they want it.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        aspect_ratio: {
          description: 'Default 9:16 (the video is vertical).',
          enum: ['9:16', '1:1', '16:9', '4:5', '3:4'],
          type: 'string',
        },
        prompt: { description: 'What the picture shows and its look.', type: 'string' },
        reference_image: {
          description:
            'The picture to change: an earlier one, by the path generate_image returned, or once the video exists one of its keyframes (project/long_take/keyframes/<shotId>.png) or a frame you pulled.',
          type: 'string',
        },
      },
      required: ['prompt'],
      type: 'object',
    },
    name: 'generate_image',
  },
  make_beat_loop: {
    description: `Start a loop short from the storyboard the user approved: 4 s clips that each hit, freeze and cut into the next, the last back into the first. Checks the storyboard and lists every issue to fix, then says every narration line in the voice and lists each line too long for its clip even at 1.3x (how long it took, the speed it would need, what to aim for). When it all passes, a card in the chat shows the user the cost, and the loop is made in that voice when they click its "${MAKE_LOOP_LABEL}" button (or, when the storyboard has no style, when they pick a look in the style picker). The reply names the voice and whether it's free. Call it once, after the user says to go ahead. Never call it to try something.`,
    inputSchema: {
      additionalProperties: false,
      properties: {
        storyboard: {
          description:
            "The whole storyboard as one JSON string, in the loop skill's schema (title, duration_s, style, accent, sources, keyframes, clips).",
          type: 'string',
        },
        title: { description: 'A short title for the loop.', type: 'string' },
        voice: {
          description:
            "Optional: a voice by name or id. Default: a free voice on this computer when one is installed (Kokoro Heart), else ReelMakeEasy's default voice.",
          type: 'string',
        },
      },
      required: ['title', 'storyboard'],
      type: 'object',
    },
    name: 'make_beat_loop',
  },
  make_video: {
    description:
      "Start making the video from the script the user approved. Shows the user ReelMakeEasy's style picker; the video starts when they pick a style (about $2 per 30 s of narration). Call it once, after the user says to go ahead. Never call it to try something.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        cameraStyle: {
          description:
            'calm (steady camera, longer shots) or dynamic (bold moves, quicker shots). Ask the user if they have not said; default calm.',
          enum: ['calm', 'dynamic'],
          type: 'string',
        },
        music: {
          description:
            '"auto" (the library\'s track for the camera style: Warm Lo-fi for calm, Groovy Lo-fi for dynamic), "off", a track by title from the music library or the user\'s own tracks (e.g. "Dreamy Keys", "my Brand theme"), or a short description of the music the user wants (e.g. "upbeat lo-fi"), which makes a new bed. Default auto; ask only if the user mentioned music. A new bed costs about $0.01; a track is free.',
          type: 'string',
        },
        script: {
          description: 'The full voice-over script, word for word, 25-250 words.',
          type: 'string',
        },
        title: { description: 'A short title for the video.', type: 'string' },
      },
      required: ['title', 'script'],
      type: 'object',
    },
    name: 'make_video',
  },
  motion_music: {
    description:
      "Compose the Motion Reel's own music with the music model the user set up (a paid generation, about a minute), instead of the library track. ReelMakeEasy measures its beat, keeps the most energetic whole bars, and rewrites reel/public/music.wav and reel/public/reel.json, so scenes timed with beat() and bar() follow it. Use it when the user asks for different or original music, or chose to have you compose it. The reply gives the new length, tempo and strongest hits.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        bpm: {
          description:
            'Optional: the tempo to ask for (the grid follows what the model actually plays).',
          maximum: 180,
          minimum: 60,
          type: 'integer',
        },
        prompt: {
          description:
            'The music, as the music model reads it: genre, mood, instruments, energy, and its shape in bars (e.g. "4-bar intro with a riser, big drop at bar 5, hits on the downbeats"). Instrumental.',
          type: 'string',
        },
      },
      required: ['prompt'],
      type: 'object',
    },
    name: 'motion_music',
  },
  motion_render: {
    description:
      'Render the Motion Reel in reel/ to a video (free, about a minute): type-checks it, renders it with its music, evens out the loudness, shows it to the user in the chat and reports how many cuts land on the beat grid. Call it when the stills look right, and again after each change the user asks for.',
    inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
    name: 'motion_render',
  },
  motion_still: {
    description:
      'Render single frames of the Motion Reel in reel/ (free, a few seconds) and get them back as pictures to look at. Pass the moments as beats (e.g. "0, 4, 8.5, 16": beat numbers from the reel\'s first beat, as grid.ts counts them). Look at each one and fix what is cut off, too small, crowded or off-style before rendering. The user sees them too.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        beats: {
          description: 'Comma-separated beat numbers (fractions allowed), at most 6.',
          type: 'string',
        },
      },
      required: ['beats'],
      type: 'object',
    },
    name: 'motion_still',
  },
  regenerate_clip: {
    description:
      'Redo one clip of the finished video. A story video: give a new prompt (about $0.25 per 6 s clip); the clip keeps its first and last frames and its length, then call render_video. A loop short: leave out prompt; the clip is made again from its storyboard slots (change them with changes) and the video is rebuilt for you; changes to its narration, caption or stamp alone keep the clip and only redo the words (no clip cost). The reply says what was made and what it cost.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        changes: {
          description:
            'Loop shorts only, optional: the clip\'s new slots as one JSON object string, e.g. {"hit": "...", "hit_camera": "Shake"}. It can set hit, hit_camera, freeze, cut, cut_camera, narration, caption and stamp. Changing only narration, caption or stamp keeps the clip as it is (no clip cost, redoFollowing ignored); any other slot makes the clip again.',
          type: 'string',
        },
        prompt: {
          description:
            'Story videos only: the full clip prompt, in the Calm or Dynamic form the brief describes.',
          type: 'string',
        },
        redoFollowing: {
          description:
            "Loop shorts only: also make every clip after it again, so each starts where the one before ends (one clip's cost each). Default false: they stay as they are.",
          type: 'boolean',
        },
        transitionId: {
          description:
            "The clip id: a story video's from project/long_take/transition_videos.json (e.g. transition_2), a loop short's from its storyboard (e.g. s3).",
          type: 'string',
        },
      },
      required: ['transitionId'],
      type: 'object',
    },
    name: 'regenerate_clip',
  },
  render_video: {
    description:
      'Rebuild the final video from the current clips (captions and music kept). Free, about a minute. Call it after regenerate_clip so the user sees the change.',
    inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
    name: 'render_video',
  },
  set_music: {
    description:
      "Change the finished video's background music: turn it off, turn it back on, put a track under it by title (`track`: one from the music library or one of the user's own; free, no generation), make a new bed from a description (`prompt`, about $0.01; a minute or two), or set how loud it is under the narration (`volume`). The delivered video is rewritten in place, so no render_video is needed. `prompt` is used word for word by the music model: write it as a music description (genre, mood, tempo, instruments), not as instructions.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        enabled: {
          description: 'false removes the music; true keeps or adds it.',
          type: 'boolean',
        },
        prompt: {
          description: 'Optional: a new description of the music (makes a new bed).',
          type: 'string',
        },
        track: {
          description:
            "Optional: a track by title, from the music library (e.g. 'Dreamy Keys') or the user's own tracks ('my Brand theme'). Fitted to the video, no generation; wins over prompt.",
          type: 'string',
        },
        volume: {
          description:
            'Optional: an exact music volume as a percentage of the narration, 0-100, when the user names one ("make it 60%"). 100 is as loud as the narration; the default is 60. Say it to the user as a percentage, never in decibels.',
          maximum: 100,
          minimum: 0,
          type: 'integer',
        },
        volume_change: {
          description:
            'Optional: a change in percentage points from the current volume, for "quieter" (about -15), "a bit quieter" (-5 to -10) or "louder" (+15). Use this rather than volume when the user names no number.',
          maximum: 100,
          minimum: -100,
          type: 'integer',
        },
      },
      required: ['enabled'],
      type: 'object',
    },
    name: 'set_music',
  },
  use_image_as_keyframe: {
    description: `Put a picture into the finished video as one of its keyframes, then make again the clips that start or end on that keyframe, with their own moves and model, and rebuild the video. Use it when a keyframe itself is wrong (a clip follows its keyframes, so redoing the clip alone brings the mistake back): fix the picture first with your image tool, show it to the user, and call this when they want it in the video. A story video: the clip before and the clip after that keyframe (one clip for the first or last keyframe). A loop short: the clip landing on that frame and every clip after it, each from the one before (all of them for f0, which the loop begins and ends on). The picture is fitted to the keyframe's size; a picture of another shape is refused. A card in the chat shows the user the clips and the cost: nothing is changed or spent until they click its "${MAKE_LOOP_LABEL}" button. You get a note when it is done.`,
    inputSchema: {
      additionalProperties: false,
      properties: {
        image: {
          description:
            'The picture: the path your image tool saved it to (or generate_image returned), a frame in your working folder (e.g. frames/fixed.png), or a picture in project/. Pass its own path; never copy it into project/.',
          type: 'string',
        },
        keyframe: {
          description:
            "The keyframe it replaces: its shotId in project/long_take/keyframes.json (a story video's 1, 2...; a loop short's f0, f1...). A clip's fromShotId and toShotId name the keyframes it starts and ends on.",
          type: 'string',
        },
      },
      required: ['image', 'keyframe'],
      type: 'object',
    },
    name: 'use_image_as_keyframe',
  },
}

const EDIT_TOOLS: AgentToolName[] = [
  'regenerate_clip',
  'render_video',
  'set_music',
  'use_image_as_keyframe',
]

/** Easy sessions get the edit tools only once editing; Free chat declares make_video,
 *  make_beat_loop and the edit tools; a Motion Reel chat, its two render tools. Claude (which has no image tool of its own) gets
 *  generate_image wherever it chats with the user, editing included: it fixes a keyframe. */
export function toolsForSession(
  session: { editing?: boolean; mode?: AgentMode },
  harness: AgentHarnessName = 'codex',
): DynamicToolSpec[] {
  const withImage = (names: AgentToolName[]) =>
    (harness === 'claude' ? [...names, 'generate_image' as const] : names).map(
      (n) => AGENT_TOOLS[n],
    )
  if (session.mode === 'autonomous') return session.editing ? withImage(EDIT_TOOLS) : []
  if (session.mode === 'motion')
    return [AGENT_TOOLS.motion_music, AGENT_TOOLS.motion_still, AGENT_TOOLS.motion_render]
  if (session.mode !== 'free') return []
  return withImage(['make_video', 'make_beat_loop', ...EDIT_TOOLS])
}

/** The chat pill's text for a call. */
export function toolSummary(tool: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>
  if (tool === 'regenerate_clip') {
    const clip = `Redoing clip ${String(a.transitionId ?? '')}`.trim()
    return a.redoFollowing === true ? `${clip} and the clips after it` : clip
  }
  if (tool === 'render_video') return 'Rebuilding the video'
  if (tool === 'set_music') return 'Changing the music'
  if (tool === 'use_image_as_keyframe')
    return `Putting the new picture in as keyframe ${String(a.keyframe ?? '')}`.trim()
  if (tool === 'generate_image') return 'Making a preview image'
  if (tool === 'motion_music') return 'Composing the music'
  if (tool === 'motion_still') return 'Looking at frames of the reel'
  if (tool === 'motion_render') return 'Rendering the reel'
  if (tool === 'make_video')
    return `Starting the video: ${String(a.title ?? '')}`.trim().replace(/:$/, '')
  if (tool === 'make_beat_loop')
    return `Starting the loop: ${String(a.title ?? '')}`.trim().replace(/:$/, '')
  return tool
}
