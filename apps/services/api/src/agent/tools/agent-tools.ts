import { type AgentHarnessName, type AgentMode, isRankingMode } from '@shared/types/api/agent'

import { avatarVoiceList } from '../animation/avatar-voice-list'
import { MAKE_LOOP_LABEL } from '../craft/beat-loop-skill'

export type AgentToolName =
  | 'animation_music'
  | 'animation_render'
  | 'animation_review'
  | 'animation_setup'
  | 'animation_still'
  | 'animation_voice'
  | 'avatar_check'
  | 'avatar_save'
  | 'generate_image'
  | 'make_beat_loop'
  | 'make_video'
  | 'motion_music'
  | 'motion_render'
  | 'motion_review'
  | 'motion_setup'
  | 'motion_still'
  | 'ranking_add_clip'
  | 'ranking_add_sound'
  | 'ranking_add_sticker_image'
  | 'ranking_analyze_reference'
  | 'ranking_apply_style'
  | 'ranking_create'
  | 'ranking_export'
  | 'ranking_find_moments'
  | 'ranking_generate_clips'
  | 'ranking_get'
  | 'ranking_list'
  | 'ranking_style_get'
  | 'ranking_style_list'
  | 'ranking_style_save'
  | 'ranking_update'
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
  /** The call was refused before it ran (another call or setup running, a reel that doesn't
   *  type-check): it says nothing about the tool's own work. */
  refused?: 'busy' | 'type-check'
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
  animation_music: {
    description:
      'Put the animation\'s music under the voice, made the way the user picked: engine "composer" (free) takes the score you composed in animation/music/ (the reelmakeeasy-music-composer skill; run the composer first, no prompt needed), "eleven-music" (ElevenLabs Music, $0.60 a minute) or "ace-step" (about $0.01) make a track from your prompt. ReelMakeEasy fits it to the length (public/music.wav; the kit lowers it while anyone speaks). Use it only when the user chose to have you make the music, or asks for different music: a music model is a paid generation each time.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        engine: {
          description: 'The music model (default: the one the user picked).',
          enum: ['composer', 'eleven-music', 'ace-step'],
          type: 'string',
        },
        prompt: {
          description:
            'With a music model: the music as it reads it (genre, mood, instruments and energy for the look and story: "gentle ukulele and glockenspiel, warm and curious, light"). Instrumental, and calm enough to talk over. Not for the composer.',
          type: 'string',
        },
      },
      required: [],
      type: 'object',
    },
    name: 'animation_music',
  },
  animation_render: {
    description:
      'Render the animation in animation/ to a video (free, a few minutes): type-checks it, renders it with its voice and music, evens out the loudness and shows it to the user in the chat. Call it when the stills look right, and again after each change the user asks for.',
    inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
    name: 'animation_render',
  },
  animation_review: {
    description:
      'Review the last render of the animation (free, a few seconds; render with animation_render first): lays it out as contact sheets, a frame every 0.5 s (or 1 s), 8 to a row, and shows them to you and the user, with where nothing moves for 0.5 s or more and the scenes held over 10 s. Call it after every render, open every sheet, write what is wrong by time in animation/review.md with its fix, fix it, render and review again (up to 3 rounds).',
    inputSchema: {
      additionalProperties: false,
      properties: {
        every: {
          description: 'Seconds between frames: 0.5 (default) or 1.',
          enum: [0.5, 1],
          type: 'number',
        },
        from: {
          description: 'Optional: start here (seconds; default 0).',
          minimum: 0,
          type: 'number',
        },
        to: {
          description: 'Optional: stop here (seconds; default the end).',
          minimum: 0,
          type: 'number',
        },
      },
      type: 'object',
    },
    name: 'animation_review',
  },
  animation_setup: {
    description:
      "Set up an Advanced Claude Animation (free, quick; the first time it also installs Remotion, a few minutes): readies animation/ with the look card, the brief, the look's library and the music, exactly as the setup card does in Easy. Call it with no arguments to get the looks, their lengths and the library tracks. Call it with everything once the user has settled it, and again only when they change the look, length or music (scenes and voices are kept). The reply says what to read next.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        lengthSec: {
          description:
            'About how long, in seconds: any whole number from 10 to 90 (15, 30, 45, 60 or 90 suggested).',
          maximum: 90,
          minimum: 10,
          type: 'integer',
        },
        avatarDescription: {
          description:
            "Avatar video with a new avatar: how it looks, in the user's words (with or instead of a photo).",
          type: 'string',
        },
        avatarId: {
          description: 'Avatar video with a saved avatar: its id (from the options).',
          type: 'string',
        },
        avatarName: {
          description: "Avatar video with a new avatar: its name (the person's first name, say).",
          type: 'string',
        },
        avatarPhoto: {
          description:
            'Avatar video with a new avatar: the photo to draw it from, an image the user attached (its path, e.g. attachments/me.jpg). Optional with a description.',
          type: 'string',
        },
        avatarStyle: {
          description:
            'Avatar video with a new avatar: drawn in 2D, 3D or pixel art (pixel). Unset: as its description says (3D or pixel art when it says so), else 2D.',
          enum: ['2d', '3d', 'pixel'],
          type: 'string',
        },
        detail: {
          description:
            'How much detail to build in, as the user picked: low, medium, high or xhigh (Extra high, the default and recommended: the most detail, more time and tokens).',
          enum: ['low', 'medium', 'high', 'xhigh'],
          type: 'string',
        },
        lookId: {
          description:
            "The look: a style ('2d', '3d', '8bit' is Pixel art), or 'avatar' for an Avatar explainer (with avatarId or a new avatar, and its stage).",
          enum: ['2d', '3d', '8bit', 'avatar'],
          type: 'string',
        },
        music: {
          description:
            "library: a library track (musicId: its id); upload: the user's own file (musicId: its path, e.g. attachments/song.mp3); agent: you make it with animation_music right after (musicEngine); none: the voice alone.",
          enum: ['library', 'upload', 'agent', 'none'],
          type: 'string',
        },
        musicEngine: {
          description:
            'With music "agent": how, as the user picked: composer (you compose it yourself, free; recommended), eleven-music (ElevenLabs Music, $0.60 a minute) or ace-step (about $0.01).',
          enum: ['composer', 'eleven-music', 'ace-step'],
          type: 'string',
        },
        musicId: {
          description: "The library track's id, or the user's file's path.",
          type: 'string',
        },
        stage: {
          description:
            "An Avatar explainer's style, the world the host is drawn in: '2d' (a 2D avatar), '3d' (a 3D avatar) or '8bit' (Pixel art, a 2D or 3D avatar). Default: the avatar's own style.",
          enum: ['2d', '3d', '8bit'],
          type: 'string',
        },
        subject: {
          description:
            'What it is about (up to 600 characters). Leave it out to pick a true fun fact yourself.',
          type: 'string',
        },
      },
      type: 'object',
    },
    name: 'animation_setup',
  },
  animation_still: {
    description:
      'Render single frames of the animation in animation/ (free, a few seconds) and get them back as pictures to look at. Pass the moments in seconds from the start (e.g. "0, 4.5, 12"; lineStart(i) / 30 is line i\'s start). Look at each one and fix what is cut off, too small, crowded, off-palette or off-look before rendering. The user sees them too.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        seconds: {
          description: 'Comma-separated seconds (fractions allowed), at most 6.',
          type: 'string',
        },
      },
      required: ['seconds'],
      type: 'object',
    },
    name: 'animation_still',
  },
  animation_voice: {
    description:
      "Record the animation's voices (free on this computer; when the voices aren't installed it says so first, as they would run on fal, paid). Each line gets up to 3 takes; the kept one says the script's words and matches its speaker's pitch. The reply gives the total length and any line to listen to; public/voice.wav and public/voice/lines.json (each line's start, end, words and loudness) are rewritten, so scenes timed with lineStart() and wordAt() follow. Record again only when the script changes.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        confirmPaid: {
          description: 'true only after you told the user the voices run on fal, paid.',
          type: 'boolean',
        },
        lines: {
          description:
            'Every line, in order, one per row: "Who: the words, as said" (numbers as digits: "3000 years"; no stage directions). A narrator is "Narrator: …".',
          type: 'string',
        },
        pauseMs: {
          description: 'Silence between lines, in ms (default 250).',
          maximum: 2000,
          minimum: 0,
          type: 'integer',
        },
        voices: {
          description:
            'Each speaker\'s voice, one per row: "Who: a vivid description" (age, energy, pace, attitude: "Bee: a cheerful young bee, quick and bright"), or a preset id starting kokoro-. An Avatar video\'s host is "Host: avatar": the saved avatar\'s own voice.',
          type: 'string',
        },
      },
      required: ['lines', 'voices'],
      type: 'object',
    },
    name: 'animation_voice',
  },
  avatar_check: {
    description:
      "Render the Avatar video's avatar check sheet (free, a few seconds): src/avatar/avatar.ts in 16 poses (neutral, smile, the mouth shapes, a blink, surprise, a head turn and every gesture), each named, shown to you and the user. Compare it with the photo in animation/public/avatar/ and fix the rig until it looks like the person and every pose reads.",
    inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
    name: 'avatar_check',
  },
  avatar_save: {
    description:
      'Save the Avatar video\'s avatar to the user\'s avatars: its rig, its picture, the photo and its fixed voice (`voiceId`), so every later Avatar video uses the same avatar and the same voice. Call it once the user keeps the avatar, and again after changing it. Then record its lines with voices "Host: avatar".',
    inputSchema: {
      additionalProperties: false,
      properties: {
        confirmPaid: {
          description: 'true only after you told the user the voice sample runs on fal, paid.',
          type: 'boolean',
        },
        name: {
          description: "The avatar's name (default: the one the user gave).",
          type: 'string',
        },
        voice: {
          description:
            'How the avatar sounds, in words (age, warmth, energy, pace: "a bright, friendly woman in her 30s, quick and warm"), kept with it. Default: the one it was saved with.',
          type: 'string',
        },
        voiceId: {
          description: `The avatar's fixed voice, the same in every video: required for a new avatar. Pick the one that best fits the person in the photo (age, gender, energy) from these free voices: ${avatarVoiceList()}. Or the id of a voice the user named (from their voice library). Default: the voice it has; change it only when the user asks.`,
          type: 'string',
        },
      },
      type: 'object',
    },
    name: 'avatar_save',
  },
  motion_music: {
    description:
      'Put the Motion Reel\'s own music under it, made the way the user picked (engine). "composer" (free, recommended): music you composed note by note with the reelmakeeasy-music-composer skill; first write reel/music/music.mjs and set bpm in reel/music/reel.config.mjs, run `cd reel/music && node tools/score.mjs --no-cues` in your shell and fix its QC, then call this with engine "composer" and no prompt: ReelMakeEasy takes audio/score.wav with its exact grid and events from build/music.json. "eleven-music" (ElevenLabs Music, $0.60 a minute) or "ace-step" (about $0.01): a music model composes it from your prompt, about a minute; ReelMakeEasy measures its beat and keeps the most energetic whole bars. Either way reel/public/music.wav and reel/public/reel.json are rewritten, so scenes timed with beat() and bar() follow the new music. Use it when the user asks for different or original music, or chose to have you make it. The reply gives the new length, tempo and strongest hits.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        bpm: {
          description:
            'For a music model, optional: the tempo to ask for (the grid follows what the model actually plays). The composer takes its tempo from your music.mjs.',
          maximum: 180,
          minimum: 60,
          type: 'integer',
        },
        engine: {
          description: 'How the music was made (default: the way the user picked).',
          enum: ['composer', 'eleven-music', 'ace-step'],
          type: 'string',
        },
        prompt: {
          description:
            'For a music model (not the composer): the music as it reads it: genre, mood, instruments, energy, and its shape in bars (e.g. "4-bar intro with a riser, big drop at bar 5, hits on the downbeats"). Instrumental.',
          type: 'string',
        },
      },
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
  motion_review: {
    description:
      'Review the last render of the Motion Reel (free, a few seconds; render with motion_render first): lays it out as contact sheets, a frame every 0.5 s (or 1 s), 8 frames to a row, a few rows to a sheet, and shows them to you and the user, with a pace report: every shot with its length (one idea is at most 4 s, a shot over 8 s fails) and every stall (0.5 s or more in which nothing visibly moves, the end card aside). Call it after every render, open every sheet, write what is wrong by time in reel/review.md with the change of strategy for each, fix, render and review again.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        every: {
          description: 'Seconds between frames: 0.5 (default) or 1.',
          enum: [0.5, 1],
          type: 'number',
        },
        from: {
          description: 'Optional: start here (seconds; default 0).',
          minimum: 0,
          type: 'number',
        },
        to: {
          description: 'Optional: stop here (seconds; default the end of the reel).',
          minimum: 0,
          type: 'number',
        },
      },
      type: 'object',
    },
    name: 'motion_review',
  },
  motion_setup: {
    description:
      'Set up an Advanced Motion Reel (free, quick; the first time it also installs Remotion, a few minutes): readies reel/ with the brief, the music trimmed to whole bars and its beat grid, exactly as the setup card does in Easy. Call it with no arguments to get the reel types, lengths, frames and library tracks. Call it with everything once the user has settled it, and again only when they change the type, length, frame, music or reference (the scenes and plan are kept). The reply says what to read next.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        detail: {
          description:
            'How much detail to build in, as the user picked: low, medium, high or xhigh (Extra high, the default and recommended: the most detail, more time and tokens).',
          enum: ['low', 'medium', 'high', 'xhigh'],
          type: 'string',
        },
        lengthSec: {
          description: 'About how long, in seconds (the reel is whole bars of its music).',
          enum: [10, 15, 30, 60],
          type: 'integer',
        },
        music: {
          description:
            "library: a library track (musicId: its id); upload: the user's own file (musicId: its path, e.g. attachments/song.mp3); agent: you make it with motion_music right after, the way the user picked (musicEngine); none: no music.",
          enum: ['library', 'upload', 'agent', 'none'],
          type: 'string',
        },
        musicEngine: {
          description:
            'With music "agent": how you make it, as the user picked: composer (you compose it note by note with the reelmakeeasy-music-composer skill; free, recommended), eleven-music (ElevenLabs Music, $0.60 a minute) or ace-step (about $0.01).',
          enum: ['composer', 'eleven-music', 'ace-step'],
          type: 'string',
        },
        musicId: {
          description: "The library track's id, or the user's file's path.",
          type: 'string',
        },
        ratio: { description: 'The frame.', enum: ['16:9', '9:16', '1:1'], type: 'string' },
        referenceUrl: {
          description:
            'Optional: a YouTube video or a website the user pasted in this chat, to take the look from.',
          type: 'string',
        },
        subject: {
          description:
            'What the reel is about: the words, names and facts it may show (up to 600 characters).',
          type: 'string',
        },
        type: {
          description:
            'The kind of reel: launch (a product launch: make one product memorable by showing it working) or showreel (a motion reel: pure show-off motion that looks super cool).',
          enum: ['launch', 'showreel'],
          type: 'string',
        },
      },
      type: 'object',
    },
    name: 'motion_setup',
  },
  motion_still: {
    description:
      'Render single frames of the Motion Reel in reel/ (free, a few seconds) and get them back as pictures to look at. Pass the moments as beats (e.g. "0, 4, 8.5, 16": beat numbers from the reel\'s first beat, as grid.ts counts them). Look at each one and fix what is cut off, too small or crowded before rendering. The user sees them too.',
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
  ranking_add_clip: {
    description:
      "Put a video or a photo from your working folder (the user's attachments are in attachments/) under a rank of a ranking short. A photo (jpg, png, webp) becomes a 5 s clip with a slow zoom. It plays its first 4.5 s until you trim it (items[].clip.trimStartSec/trimEndSec with ranking_update).",
    inputSchema: {
      additionalProperties: false,
      properties: {
        id: { description: 'The ranking id.', type: 'string' },
        path: {
          description: 'The file, relative to your working folder, e.g. attachments/cat.mp4.',
          type: 'string',
        },
        rank: {
          description: 'The rank it goes under (1 is the top).',
          minimum: 1,
          type: 'integer',
        },
      },
      required: ['id', 'rank', 'path'],
      type: 'object',
    },
    name: 'ranking_add_clip',
  },
  ranking_add_sound: {
    description:
      'Add a sound file the user dropped into the chat (or one in your working folder) to their sound library: mp3, wav, m4a, ogg, flac or aac, under 10 minutes. Answers its soundId, ready to use as the reveal sound, the music bed or an action sound.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        name: {
          description: 'A short name for the library, e.g. Vine boom (default: the file name).',
          type: 'string',
        },
        path: {
          description: 'The file, relative to your working folder, e.g. attachments/boom.mp3.',
          type: 'string',
        },
      },
      required: ['path'],
      type: 'object',
    },
    name: 'ranking_add_sound',
  },
  ranking_add_sticker_image: {
    description:
      'Make a picture (png, jpg, webp or gif) in your working folder usable as a sticker on a ranking short. Answers its imageUrl: put it in a stickers entry with kind "image" (size is its width as a share of the frame, e.g. 0.3) with ranking_update.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        id: { description: 'The ranking id.', type: 'string' },
        path: {
          description: 'The picture, relative to your working folder, e.g. attachments/logo.png.',
          type: 'string',
        },
      },
      required: ['id', 'path'],
      type: 'object',
    },
    name: 'ranking_add_sticker_image',
  },
  ranking_analyze_reference: {
    description:
      "Learn a ranking short's pattern from a reference: a YouTube link the user pasted (downloaded for analysis only, never used in a video), or a video file in your working folder. Takes about a minute. Answers its shots, its sound effects (when each fires, what it is like, and the user's library sound it matches, or 'not in the library'), and frames to look at (title frame, contact sheet, a frame per shot and per sound). Look at the frames before describing the style.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        path: {
          description: 'Or: a video in your working folder, e.g. attachments/ref.mp4.',
          type: 'string',
        },
        url: {
          description:
            'A YouTube link (youtube.com, youtu.be or a Shorts link). TikTok is not supported.',
          type: 'string',
        },
      },
      type: 'object',
    },
    name: 'ranking_analyze_reference',
  },
  ranking_apply_style: {
    description:
      "Give a ranking a saved style's look and sound: title colours (and its title, if the ranking still has the default one), overlay colours, reveal order, transition and the reveal/music sounds; a ranking without clips also takes its number of ranks. Then place the labels, trims, action sounds and stickers per clip yourself.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        id: { description: 'The ranking id.', type: 'string' },
        styleId: { description: 'The style id (ranking_style_list).', type: 'string' },
      },
      required: ['id', 'styleId'],
      type: 'object',
    },
    name: 'ranking_apply_style',
  },
  ranking_find_moments: {
    description:
      "Find a clip's action moments: its strongest sound onsets (with what they sound like) and its shot changes, in seconds from the file's start. Give a video in your working folder (path), or a ranking and rank to read the clip already under it. Use it to trim to the action and to time the action sound.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        id: { description: 'Or: the ranking id (with rank).', type: 'string' },
        path: {
          description: 'A video in your working folder, e.g. attachments/cat.mp4.',
          type: 'string',
        },
        rank: { description: 'With id: the rank whose clip to read.', minimum: 1, type: 'integer' },
      },
      type: 'object',
    },
    name: 'ranking_find_moments',
  },
  ranking_style_get: {
    description:
      'Read a saved ranking style in full, with the sounds it plans that are not in the library yet.',
    inputSchema: {
      additionalProperties: false,
      properties: { id: { description: 'The style id.', type: 'string' } },
      required: ['id'],
      type: 'object',
    },
    name: 'ranking_style_get',
  },
  ranking_style_list: {
    description:
      "The user's saved ranking styles (patterns learned from references), with their ids.",
    inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
    name: 'ranking_style_list',
  },
  ranking_style_save: {
    description:
      'Save a ranking style (new), or change one (with id: whole fields to replace). style is a JSON object; the reelmakeeasy-ranking skill lists its fields. Sounds are { description, soundId }: soundId from the library, or null for one the user still has to download.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        id: {
          description: 'To change a saved style: its id. Leave out to save a new one.',
          type: 'string',
        },
        style: { description: 'The style as a JSON object (see the skill).', type: 'string' },
      },
      required: ['style'],
      type: 'object',
    },
    name: 'ranking_style_save',
  },
  ranking_create: {
    description:
      'Start a new ranking short (empty ranks, a default title). Answers the project to fill in.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        name: {
          description: 'A name for the user’s list, e.g. Funniest cat fails.',
          type: 'string',
        },
        ranks: {
          description: 'How many ranks (2-10, default 5).',
          maximum: 10,
          minimum: 2,
          type: 'integer',
        },
      },
      required: ['name'],
      type: 'object',
    },
    name: 'ranking_create',
  },
  ranking_export: {
    description:
      'Render a ranking short to a 1080x1920 MP4 (free; about a minute) without the studio open, and wait for it. Only once it has every clip, label and title; the reply says where the video is.',
    inputSchema: {
      additionalProperties: false,
      properties: { id: { description: 'The ranking id.', type: 'string' } },
      required: ['id'],
      type: 'object',
    },
    name: 'ranking_export',
  },
  ranking_generate_clips: {
    description:
      "Make AI video clips for a ranking short from text, one per rank, and put each under its rank (paid; all made at once, about 2-3 minutes). Each prompt is one short continuous scene with one clear funny action and its payoff (who, where, what happens, how it ends). Avoid water and fast motion (splashes, pouring, spins, sprints): AI smears them; prefer slow, readable actions and a still camera. ReelMakeEasy adds the vertical phone-video look. Before calling it, show the user the prompts and ask which resolution (each with its cost; 1080p recommended). Called without a resolution it makes nothing and answers the choices with their prices. The reply gives each clip's contact sheet to look at.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        clips: {
          description:
            'JSON list: [{ "rank": 1, "prompt": "A fluffy orange cat misjudges a jump onto the kitchen counter and slides into the laundry basket below." }, ...] (1-6).',
          type: 'string',
        },
        id: { description: 'The ranking id.', type: 'string' },
        resolution: {
          description:
            'The resolution the user picked. Hailuo (fal) makes "480p" (cheapest, softest), "768p" or "1080p" (recommended: sharpest, smears least), about $0.13, $0.20 or $0.40 per 5 s clip; Gemini makes "720p" only.',
          enum: ['480p', '720p', '768p', '1080p'],
          type: 'string',
        },
        seconds: {
          description: "Each clip's length, 4-8 s (default 5).",
          maximum: 8,
          minimum: 4,
          type: 'integer',
        },
      },
      required: ['id', 'clips'],
      type: 'object',
    },
    name: 'ranking_generate_clips',
  },
  ranking_get: {
    description:
      'Read a ranking short: every field you can change, what still stops its export, and tips.',
    inputSchema: {
      additionalProperties: false,
      properties: { id: { description: 'The ranking id.', type: 'string' } },
      required: ['id'],
      type: 'object',
    },
    name: 'ranking_get',
  },
  ranking_list: {
    description:
      "List the user's ranking shorts and their sound library (sound ids, names, lengths; starred first).",
    inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
    name: 'ranking_list',
  },
  ranking_update: {
    description:
      'Change a ranking short: patch is a JSON object with any of title, items, reveal, sounds, stickers, transition, style, name (whole fields, as ranking_get shows them). The reelmakeeasy-ranking skill explains each field. ranks changes how many ranks it has (empty ones added at the bottom, or the last ones dropped with their clips).',
    inputSchema: {
      additionalProperties: false,
      properties: {
        id: { description: 'The ranking id.', type: 'string' },
        patch: { description: 'A JSON object of the fields to replace.', type: 'string' },
        ranks: { description: 'How many ranks (2-10).', maximum: 10, minimum: 2, type: 'integer' },
      },
      required: ['id'],
      type: 'object',
    },
    name: 'ranking_update',
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

/** The Ranking Builder, for ranking shorts (a Ranking chat's only tools; Free chat has them too). */
const RANKING_TOOLS: AgentToolName[] = [
  'ranking_list',
  'ranking_create',
  'ranking_get',
  'ranking_update',
  'ranking_add_clip',
  'ranking_add_sound',
  'ranking_add_sticker_image',
  'ranking_export',
  'ranking_analyze_reference',
  'ranking_find_moments',
  'ranking_generate_clips',
  'ranking_style_list',
  'ranking_style_get',
  'ranking_style_save',
  'ranking_apply_style',
]

/** A Claude Animation chat's tools (an Advanced one also has animation_setup). */
const ANIMATION_TOOLS: AgentToolName[] = [
  'animation_voice',
  'animation_music',
  'animation_still',
  'animation_render',
  'animation_review',
  // An Avatar video's avatar (the others refuse them).
  'avatar_check',
  'avatar_save',
]

const EDIT_TOOLS: AgentToolName[] = [
  'regenerate_clip',
  'render_video',
  'set_music',
  'use_image_as_keyframe',
]

/** Easy sessions get the edit tools only once editing; Free chat declares make_video,
 *  make_beat_loop and the edit tools; a Motion Reel chat, its music, render and review tools (and an
 *  Advanced one, motion_setup). Claude (which has no image tool of its own) gets generate_image
 *  wherever it chats with the user, editing included: it fixes a keyframe. */
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
    return [
      AGENT_TOOLS.motion_music,
      AGENT_TOOLS.motion_still,
      AGENT_TOOLS.motion_render,
      AGENT_TOOLS.motion_review,
    ]
  if (session.mode === 'motion_free')
    return [
      AGENT_TOOLS.motion_setup,
      AGENT_TOOLS.motion_music,
      AGENT_TOOLS.motion_still,
      AGENT_TOOLS.motion_render,
      AGENT_TOOLS.motion_review,
    ]
  if (session.mode === 'animation') return ANIMATION_TOOLS.map((n) => AGENT_TOOLS[n])
  if (session.mode === 'animation_free')
    return ['animation_setup' as const, ...ANIMATION_TOOLS].map((n) => AGENT_TOOLS[n])
  if (isRankingMode(session.mode)) return RANKING_TOOLS.map((n) => AGENT_TOOLS[n])
  if (session.mode !== 'free') return []
  return withImage(['make_video', 'make_beat_loop', ...EDIT_TOOLS, ...RANKING_TOOLS])
}

/** The chat pill's text for calls whose text doesn't depend on their arguments. */
const FIXED_SUMMARIES: Record<string, string> = {
  animation_music: 'Making the music',
  animation_render: 'Rendering the animation',
  animation_review: 'Reviewing the render (contact sheets)',
  animation_still: 'Looking at frames of the animation',
  animation_voice: 'Recording the voices',
  avatar_check: 'Checking the avatar (pose sheet)',
  avatar_save: 'Saving the avatar',
  generate_image: 'Making a preview image',
  motion_music: 'Composing the music',
  motion_render: 'Rendering the reel',
  motion_review: 'Reviewing the render (contact sheets)',
  motion_still: 'Looking at frames of the reel',
  ranking_add_sticker_image: 'Adding a picture sticker',
  ranking_analyze_reference: 'Watching the reference video',
  ranking_apply_style: 'Applying the ranking style',
  ranking_export: 'Exporting the ranking short',
  ranking_find_moments: 'Finding the action in a clip',
  ranking_generate_clips: 'Making the clips with AI',
  ranking_get: 'Reading the ranking',
  ranking_list: 'Looking at your rankings and sounds',
  ranking_style_get: 'Reading ranking styles',
  ranking_style_list: 'Reading ranking styles',
  ranking_style_save: 'Saving the ranking style',
  ranking_update: 'Changing the ranking',
  render_video: 'Rebuilding the video',
  set_music: 'Changing the music',
}

/** The chat pill's text for a call. */
export function toolSummary(tool: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>
  const fixed = Object.hasOwn(FIXED_SUMMARIES, tool) ? FIXED_SUMMARIES[tool] : undefined
  if (fixed) return fixed
  if (tool === 'regenerate_clip') {
    const clip = `Redoing clip ${String(a.transitionId ?? '')}`.trim()
    return a.redoFollowing === true ? `${clip} and the clips after it` : clip
  }
  if (tool === 'use_image_as_keyframe')
    return `Putting the new picture in as keyframe ${String(a.keyframe ?? '')}`.trim()
  if (tool === 'motion_setup')
    return typeof a.type === 'string' && a.type.trim()
      ? 'Setting up the reel'
      : 'Looking at the reel types and music'
  if (tool === 'animation_setup')
    return typeof a.lookId === 'string' && a.lookId.trim()
      ? 'Setting up the animation'
      : 'Looking at the looks and music'
  if (tool === 'ranking_create') return `Starting a ranking: ${String(a.name ?? '')}`.trim()
  if (tool === 'ranking_add_clip') return `Adding a clip to rank ${String(a.rank ?? '')}`.trim()
  if (tool === 'make_video')
    return `Starting the video: ${String(a.title ?? '')}`.trim().replace(/:$/, '')
  if (tool === 'make_beat_loop')
    return `Starting the loop: ${String(a.title ?? '')}`.trim().replace(/:$/, '')
  return tool
}
