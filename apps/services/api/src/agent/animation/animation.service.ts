import fs from 'node:fs'
import path from 'node:path'

import {
  ANIMATION_DEFAULT_SEC,
  ANIMATION_LENGTHS,
  ANIMATION_LOOKS,
  ANIMATION_MAX_SEC,
  ANIMATION_MIN_SEC,
  animationLook,
} from '@reelmakeeasy/common/animation/looks'
import { Logger } from '@reelmakeeasy/common/logger'
import { motionReelTrack, motionReelTracks } from '@reelmakeeasy/common/motion-reel/music'
import { VIDEO_DETAIL_LABEL, VIDEO_DETAILS } from '@reelmakeeasy/common/motion-reel/video-detail'
import {
  isMotionMusicEngine,
  MOTION_MUSIC_ENGINE_INFO,
  MOTION_MUSIC_ENGINES,
  type MotionMusicEngine,
  motionMusicEngineOf,
} from '@reelmakeeasy/common/motion-reel/reel-config'
import { storeUri } from '@reelmakeeasy/common/storage/address'
import { uploadToStore } from '@reelmakeeasy/common/storage/stored-files'
import { presetPath, presetUrl } from '@reelmakeeasy/common/storage/presets'
import {
  DEFAULT_ASR_MODEL_ID,
  generateForcedAlignment,
  speechToText,
} from '@reelmakeeasy/common/asr/elevenlabs'
import {
  KOKORO_VOICE_PREFIX,
  kokoroTextToSpeech,
  qwen3DesignVoiceSample,
  qwen3TextToSpeech,
  toReferenceWav,
} from '@reelmakeeasy/common/tts/fal-tts'
import { qwen3VoiceReference } from '@reelmakeeasy/common/tts/qwen3-voice'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  type AgentAnimationOptions,
  type AgentAnimationSetup,
  type AgentAnimationSetupView,
  type AgentSession,
  isAnimationMode,
} from '@shared/types/api/agent'
import { AVATAR_NAME_MAX } from '@reelmakeeasy/common/animation/looks'

import { resolveAttachment } from '../agent-attachments'
import { animationKickoff, animationNextSteps } from '../agent-brief'
import {
  ensureComposer,
  keptComposerScore,
  readComposedMusic,
} from '../motion-reel/motion-composer'
import { MotionSetupError } from '../motion-reel/motion-setup'
import { composeMusic, parseComposeRequest } from '../motion-reel/motion-music'
import { MAX_STILLS, renderReel, renderStills, typeCheck } from '../motion-reel/motion-render'
import type { ReelMusicSource } from '../motion-reel/motion-project'
import { ensureMotionReelRuntime } from '../motion-reel/motion-runtime'
import type { ToolCallResult } from '../tools/agent-tools'

import { animationReviewBlocker, reviewAnimation } from './animation-review'
import {
  ANIMATION_DIR,
  AVATAR_RIG,
  avatarPhoto,
  composerSettings,
  markAvatarSaved,
  prepareAnimationProject,
  type ProjectAvatar,
  readAnimationJson,
  writeAnimationJson,
} from './animation-project'
import {
  animationSetupFromTool,
  AnimationSetupError,
  parseAnimationSetup,
  voiceReadiness,
} from './animation-setup'
import { parseVoiceArgs, recordVoices, VoiceArgsError, type VoiceDeps } from './animation-voice'
import {
  AVATAR_FOLDER,
  avatarDir,
  avatarVoice,
  listAvatars,
  newAvatarId,
  readAvatar,
  saveAvatar,
} from './avatar-library'
import { fixedVoiceEngine, fixedVoiceSpeech, isKnownVoice } from './avatar-voice'
import { voiceName } from './avatar-voice-list'

const logger = new Logger('AnimationService')

/** Why the 2D look can't be picked: its characters need designed voices. */
export const NO_DESIGNED_VOICES = 'Needs Qwen3 voices on this computer or a fal key.'

/** How the card names music Claude writes itself (Motion Reel's says "the agent"). */
const COMPOSED_BY_CLAUDE = {
  description:
    'Written note by note by Claude with its composer skill: its own tune for this story, calm under the voice.',
  label: 'Composed by Claude',
}

/** Where rendered animations are stored (served at /api/files/agent-animation/...). */
const STORE_FOLDER = 'agent-animation'
/** The project's one composition (presets/animation/template/src/Root.tsx). */
const COMPOSITION = 'Animation'

/** A narrator's voice when designed voices can't be made here: a calm, clear Kokoro preset. */
const NARRATOR_PRESET = 'kokoro-am_michael'

/** A voice that speaks as a saved avatar (`avatar:<id>`): its fixed voice, else cloned from its
 *  voice sample. */
const AVATAR_VOICE_PREFIX = 'avatar:'

/** What an avatar's voice sample says: about 10 s of clear, varied speech to clone from. */
export const AVATAR_SAMPLE_TEXT =
  "Hi, it's me! Today I'll show you something surprising, step by step. Ready? Let's go, it only takes a minute, and you'll see it everywhere after this."

/** An avatar's voice: its fixed voice, else cloned from its saved sample, else designed from its
 *  description. */
async function avatarSpeech(id: string, text: string) {
  const fixed = readAvatar(id)?.voiceId
  if (fixed) return fixedVoiceSpeech(fixed, text)
  const sample = avatarVoice(id)
  if (sample)
    return qwen3TextToSpeech({
      languageCode: 'en',
      speaker: {
        reference: qwen3VoiceReference({
          referenceText: sample.text,
          speakerEmbeddingPath: storeUri(`${AVATAR_FOLDER}/${id}/voice.safetensors`),
        }),
      },
      text,
    })
  const description = readAvatar(id)?.voice || 'a warm, clear, friendly voice'
  return qwen3DesignVoiceSample({ description, languageCode: 'en', sampleText: text })
}

/** The app's own voices and aligner: Qwen3 voice design for a description, Kokoro for a preset id
 *  (each on this computer first, else fal), timed by the app's forced aligner. */
const APP_VOICES: VoiceDeps = {
  align: async (file, text) =>
    (await generateForcedAlignment(file, text)).words.map((w) => ({
      end: w.end,
      start: w.start,
      text: w.text,
    })),
  transcribe: async (file) =>
    (
      await speechToText({
        file: new Blob([fs.readFileSync(file)]),
        languageCode: 'en',
        modelId: DEFAULT_ASR_MODEL_ID,
      })
    ).words
      .filter((w) => w.type === 'word')
      .map((w) => w.text),
  speak: async ({ text, voice }) => {
    const result = voice.startsWith(KOKORO_VOICE_PREFIX)
      ? await kokoroTextToSpeech({ text, voiceId: voice })
      : voice.startsWith(AVATAR_VOICE_PREFIX)
        ? await avatarSpeech(voice.slice(AVATAR_VOICE_PREFIX.length), text)
        : await qwen3DesignVoiceSample({ description: voice, languageCode: 'en', sampleText: text })
    return { audio: result.audioBuffer, ranOn: result.ranOn }
  },
}

/** What the Claude Animation service needs from the session service. */
export interface AnimationSessions {
  attachmentsDir(id: string): string
  emitAutonomousEvent(
    id: string,
    event:
      | {
          itemId: string
          posterUrl?: string
          report?: string
          type: 'motion_video'
          videoUrl: string
        }
      | { type: 'animation_setup_request' },
  ): void
  emitImage(id: string, file: string): void
  emitMessage(id: string, text: string): void
  emitNotice(id: string, text: string): void
  getSession(id: string): AgentSession
  setFlowWorking(id: string, working: boolean): void
  startAnimation(id: string, setup: AgentAnimationSetupView, prompt: string): void
  updateAnimation(id: string, setup: AgentAnimationSetupView): void
  workingDir(id: string): string
}

/** The setup was already sent (or is being set up): the card is answered once. */
export class AnimationSetupTakenError extends Error {
  constructor() {
    super('This animation is already set up.')
  }
}

/**
 * Claude Animation chats: the setup card (`setup`), which readies the animation's Remotion project
 * and then starts Claude; an Advanced chat's `animation_setup`, the same from Claude; and the tools
 * Claude records, looks and renders with. Everything that touches the network (installing
 * Remotion, the voices, the music) happens here, on the server; Claude only has its sandboxed shell
 * inside the chat's folder.
 */
export class AnimationService {
  protected readonly busy = new Set<string>()
  protected readonly preparing = new Set<string>()
  private renders = 0

  private readonly voice: VoiceDeps

  constructor(
    protected readonly sessions: AnimationSessions,
    deps: { voice?: VoiceDeps } = {},
  ) {
    this.voice = deps.voice ?? APP_VOICES
  }

  /** Claude called one of the animation tools. */
  async callTool(id: string, tool: string, args: unknown): Promise<ToolCallResult> {
    if (this.busy.has(id) || this.preparing.has(id))
      return { success: false, text: 'A render or setup is already running; wait for it.' }
    const session = this.sessions.getSession(id)
    if (tool === 'animation_setup') return await this.setupFromChat(id, session, args)
    if (!isAnimationMode(session.mode) || !session.animation)
      return {
        success: false,
        text:
          session.mode === 'animation_free'
            ? 'Set the animation up first: call animation_setup.'
            : 'This chat has no animation set up.',
      }
    const projectDir = path.join(this.sessions.workingDir(id), ANIMATION_DIR)
    this.busy.add(id)
    try {
      if (tool === 'avatar_check' || tool === 'avatar_save') {
        if (session.animation.lookId !== 'avatar' || !session.animation.avatar)
          return { success: false, text: 'Only an Avatar video has an avatar.' }
        const errors = await typeCheck(projectDir)
        if (errors)
          return {
            success: false,
            text: `The avatar doesn't type-check; fix these first:\n${errors}`,
          }
        return tool === 'avatar_check'
          ? await this.checkAvatar(id, projectDir)
          : await this.saveAvatar(id, session.animation, projectDir, args)
      }
      if (tool === 'animation_voice')
        return await this.recordVoice(session.animation, projectDir, args)
      if (tool === 'animation_music') return await this.compose(id, session.animation, args)
      if (tool === 'animation_review') return await this.review(id, projectDir, args)
      if (tool !== 'animation_still' && tool !== 'animation_render')
        return { success: false, text: `Unknown tool ${tool}.` }
      const errors = await typeCheck(projectDir)
      if (errors)
        return {
          success: false,
          text: `The animation doesn't type-check; fix these first:\n${errors}`,
        }
      return tool === 'animation_still'
        ? await this.stills(id, projectDir, args)
        : await this.render(id, projectDir)
    } catch (error) {
      if (error instanceof VoiceArgsError || error instanceof AnimationSetupError)
        return { success: false, text: error.message }
      return { success: false, text: `It failed:\n${ensureError(error).message.slice(-3000)}` }
    } finally {
      this.busy.delete(id)
    }
  }

  /** animation_music: Claude composes the music with the model the user picked (else the one
   *  it names), then it is fitted to the length and put under the voice. */
  private async compose(
    id: string,
    setup: AgentAnimationSetupView,
    args: unknown,
  ): Promise<ToolCallResult> {
    const asked = (args as null | Record<string, unknown>)?.['engine']
    if (asked !== undefined && !isMotionMusicEngine(asked))
      return { success: false, text: `engine is ${MOTION_MUSIC_ENGINES.join(' or ')}.` }
    const engine: MotionMusicEngine =
      asked ?? motionMusicEngineOf(setup.music.source === 'agent' ? setup.music.engine : undefined)
    const workspace = this.sessions.workingDir(id)
    if (engine === 'composer') return this.composed(id, setup, workspace)
    const request = parseComposeRequest(args)
    if (typeof request === 'string') return { success: false, text: request }
    const composed = await composeMusic(
      request,
      setup.lengthSec,
      path.join(workspace, ANIMATION_DIR, 'music'),
      engine,
    )
    const title = `${MOTION_MUSIC_ENGINE_INFO[engine].label}: ${request.prompt.replace(/\s+/g, ' ').slice(0, 40)}`
    await prepareAnimationProject({
      music: { file: composed.file, title },
      musicOnly: true,
      setup: setupFrom(setup),
      workspace,
    })
    this.sessions.updateAnimation(id, { ...setup, musicTitle: title })
    return {
      success: true,
      text: `Made the music (${composed.model}) and put it under the voice: public/music.wav, ${setup.lengthSec} s, fading out at the end (the kit ducks it while anyone speaks). Make it again only if the user wants different music: each one is a paid generation.`,
    }
  }

  /** The music Claude composed in its own shell (`animation/music/`, the composer): read as data,
   *  never run, and put under the voice. */
  private async composed(
    id: string,
    setup: AgentAnimationSetupView,
    workspace: string,
  ): Promise<ToolCallResult> {
    const projectDir = path.join(workspace, ANIMATION_DIR)
    // Set up with other music, or before the composer: install it now.
    const installed = ensureComposer(projectDir, composerSettings(setup))
    const score = readComposedMusic(projectDir, setup.lengthSec)
    // The composer names its paths for a Motion Reel's folder.
    const ours = (text: string) => text.replaceAll('reel/', `${ANIMATION_DIR}/`)
    if (typeof score === 'string')
      return {
        success: false,
        text: ours(
          installed
            ? `The composer was not here yet: it is now in reel/music/tools/ with reel/music/reel.config.mjs (set its bpm). ${score}`
            : score,
        ),
      }
    await prepareAnimationProject({
      music: { file: score.file, grid: score.grid, title: score.title },
      musicOnly: true,
      setup: setupFrom(setup),
      workspace,
    })
    this.sessions.updateAnimation(id, { ...setup, musicTitle: score.title })
    return {
      success: true,
      text: [
        `${score.title}. Put under the voice: public/music.wav, ${setup.lengthSec} s, fading out at the end (the kit lowers it while anyone speaks).`,
        ...score.qc.map(ours),
        'Checked by measurement only: tell the user what the QC measured, never how it sounds; they hear it in the next render. Compose again freely (it is free) when the user asks.',
      ].join(' '),
    }
  }

  private async render(id: string, projectDir: string): Promise<ToolCallResult> {
    const result = await renderReel(projectDir, {
      composition: COMPOSITION,
      name: 'animation',
      sync: false,
    })
    const stamp = `${Date.now()}-${++this.renders}`
    const videoKey = `${STORE_FOLDER}/${id}/animation-${stamp}.mp4`
    const posterKey = `${STORE_FOLDER}/${id}/animation-${stamp}.jpg`
    await uploadToStore(result.file, storeUri(videoKey))
    await uploadToStore(result.poster, storeUri(posterKey))
    this.sessions.emitAutonomousEvent(id, {
      itemId: `animation-${stamp}`,
      posterUrl: storeUri(posterKey),
      type: 'motion_video',
      videoUrl: storeUri(videoKey),
    })
    return {
      success: true,
      text: `Rendered the animation and showed it to the user. The file is ${ANIMATION_DIR}/out/animation.mp4. Now call animation_review, open every sheet and write ${ANIMATION_DIR}/review.md; fix what it finds and render again (at most 3 renders, one per review round), or tell the user what is still off. Never say it is done after one render. You can't hear it: say so, and ask the user to listen to the voices.`,
    }
  }

  /** An Advanced chat's animation_setup: with no look, the options to choose from; otherwise
   *  the setup checked like the card's, the project readied, the chat's card shown as chosen,
   *  and what to read next. Again later: readied anew around Claude's scenes and voices. */
  private async setupFromChat(
    id: string,
    session: AgentSession,
    args: unknown,
  ): Promise<ToolCallResult> {
    if (session.mode !== 'animation_free')
      return {
        success: false,
        text: "This chat's animation is set up with its setup card, not animation_setup.",
      }
    let setup: AgentAnimationSetup | null
    let music: null | ReelMusicSource
    let avatar: ProjectAvatar | undefined
    try {
      setup = animationSetupFromTool(args)
      if (!setup) return { success: true, text: await this.optionsText() }
      music = this.musicFor(id, setup)
      avatar = this.avatarFor(id, setup)
    } catch (error) {
      if (error instanceof AnimationSetupError) return { success: false, text: error.message }
      throw error
    }
    const again = !!session.animation
    // Music Claude already made stays through a new setup made the same way (a new length or
    // look needs no new paid track): its newest take, fitted to the length asked for now.
    const before = session.animation
    const sameWay =
      setup.music.source === 'agent' &&
      before?.music.source === 'agent' &&
      before.music.engine === setup.music.engine
    const made = sameWay
      ? newestComposed(path.join(this.sessions.workingDir(id), ANIMATION_DIR, 'music'))
      : null
    const keptGrid = made ? keptComposerScore(made)?.grid : undefined
    const kept =
      made && before?.musicTitle
        ? { file: made, title: before.musicTitle, ...(keptGrid ? { grid: keptGrid } : {}) }
        : null
    if (kept) music = kept
    this.preparing.add(id)
    try {
      const view = await this.ready(id, setup, music, avatar)
      this.sessions.updateAnimation(id, view)
      const musicNote = view.musicTitle
        ? `music: ${view.musicTitle}`
        : setup.music.source === 'agent'
          ? `music: yours to make (${MOTION_MUSIC_ENGINE_INFO[setup.music.engine].label})`
          : 'no music'
      return {
        success: true,
        text: [
          `\`${ANIMATION_DIR}/\` is ${again ? 'set up again' : 'ready'}: ${view.lookLabel}, about ${view.lengthSec} s, ${musicNote}. The user sees the setup in the chat.`,
          ...(kept
            ? [
                'The music you made is kept: make it again only if the user asks for different music.',
              ]
            : []),
          animationNextSteps(setup, !again, setup.music.source === 'agent' && !kept),
          ...(again
            ? [
                'Your scenes were kept, and so were the voices: record again only if the script changed.',
              ]
            : []),
        ].join(' '),
      }
    } catch (error) {
      logger.warn(`Claude Animation setup for ${id} failed: ${ensureError(error).message}`)
      return {
        success: false,
        text: `Couldn't set up the animation: ${ensureError(error).message.split('\n')[0]?.slice(0, 300)}`,
      }
    } finally {
      this.preparing.delete(id)
    }
  }

  /** The choices animation_setup takes, for Claude to offer. */
  private async optionsText(): Promise<string> {
    const options = await this.options()
    return [
      'Looks (lookId: label, then what it is):',
      ...options.looks.map(
        (l) =>
          `- ${l.id}: ${l.label}. ${l.description}${l.disabledReason ? ` Not available here: ${l.disabledReason}` : ''}`,
      ),
      ...(options.avatars.length
        ? [
            'Saved avatars for an Avatar video (avatarId: name, style):',
            ...options.avatars.map((a) => `- ${a.id}: ${a.name}, ${a.style.toUpperCase()}`),
          ]
        : [
            'No saved avatars yet: an Avatar video needs a new one (avatarName, avatarStyle 2d or 3d, and avatarPhoto: a photo the user attaches with the paperclip).',
          ]),
      `Length (lengthSec): any whole number of seconds from ${options.minLengthSec} to ${options.maxLengthSec} (${ANIMATION_LENGTHS.slice(0, -1).join(', ')} or ${ANIMATION_LENGTHS.at(-1)} suggested; default ${ANIMATION_DEFAULT_SEC}).`,
      `Detail (detail): how much detail to build in: ${VIDEO_DETAILS.map((d) => `${d} (${VIDEO_DETAIL_LABEL[d]})`).join(', ')}. Default and recommended: xhigh, the most detail (more time and tokens). Ask the user which they want.`,
      'Library tracks (music "library", musicId):',
      ...options.tracks.map((t) => `- ${t.id}: ${t.title}`),
      'Or music "upload" (the user\'s own file through the paperclip; musicId: its path), "none", or "agent": you make it with animation_music right after the setup, with the music model the user picks (musicEngine):',
      ...MOTION_MUSIC_ENGINES.map(
        (e) =>
          `- ${e}: ${MOTION_MUSIC_ENGINE_INFO[e].label} (${MOTION_MUSIC_ENGINE_INFO[e].cost}). ${MOTION_MUSIC_ENGINE_INFO[e].description}`,
      ),
    ].join('\n')
  }

  /** avatar_check: the avatar in 16 poses on one sheet, shown to Claude and the user. */
  private async checkAvatar(id: string, projectDir: string): Promise<ToolCallResult> {
    const outDir = path.join(projectDir, 'out', 'avatar', String(Date.now()))
    const [sheet] = await renderStills(projectDir, [0], outDir, 'AvatarSheet')
    if (!sheet) return { success: false, text: 'The sheet did not render.' }
    this.sessions.emitImage(id, sheet)
    const photo = avatarPhoto(projectDir)
    return {
      success: true,
      text: [
        `Rendered the avatar's check sheet (the user sees it too): ${ANIMATION_DIR}/${path.relative(projectDir, sheet)}. Open it${photo ? ` next to the photo, ${ANIMATION_DIR}/${path.relative(projectDir, photo)},` : ''} and check: does it look like the person (face shape, skin tone, hair style and colour, eyes, glasses, beard, clothes)? Does every mouth shape read, does the blink close both eyes, do the hands land where each gesture says, is nothing cut off or detached?`,
        'Fix what is off in src/avatar/avatar.ts and check again. When it looks right, show the user and ask with a card whether to keep it ("Keep this avatar (Recommended)" or "Change something"), then save it with avatar_save.',
      ].join(' '),
    }
  }

  /** avatar_save: keeps the avatar in the library (its rig, picture, photo and voice sample) and
   *  makes it this chat's avatar, so "Host: avatar" speaks with its voice. */
  private async saveAvatar(
    id: string,
    setup: AgentAnimationSetupView,
    projectDir: string,
    args: unknown,
  ): Promise<ToolCallResult> {
    const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
    const chosen = setup.avatar
    if (!chosen) return { success: false, text: 'Only an Avatar video has an avatar.' }
    const before = 'id' in chosen ? readAvatar(chosen.id) : null
    const name =
      (typeof a['name'] === 'string' && a['name'].trim()) ||
      ('name' in chosen ? chosen.name : (before?.name ?? setup.avatarName ?? 'My avatar'))
    if (name.length > AVATAR_NAME_MAX)
      return { success: false, text: `Keep the name under ${AVATAR_NAME_MAX} characters.` }
    const voiceIdArg = typeof a['voiceId'] === 'string' ? a['voiceId'].trim() : ''
    if (voiceIdArg && !(await isKnownVoice(voiceIdArg)))
      return {
        success: false,
        text: `There is no voice "${voiceIdArg}": pass a voiceId from the list in its description, or the id of the voice the user picked.`,
      }
    // Its fixed voice: the one passed, else the one it has (the user may have picked it).
    const voiceId = voiceIdArg || before?.voiceId || ''
    if (!before && !voiceId)
      return {
        success: false,
        text: 'Pass voiceId: the fixed voice this avatar keeps in every video, the one from the list that best fits the person in the photo (or the voice the user asked for).',
      }
    const voice = (typeof a['voice'] === 'string' && a['voice'].trim()) || before?.voice || ''
    if (!voiceId && voice.length < 8)
      return {
        success: false,
        text: 'Pass voice: a vivid description of how the avatar sounds (age, warmth, energy, pace: "a bright, friendly woman in her 30s, quick and warm").',
      }
    const style = 'style' in chosen ? chosen.style : (before?.style ?? '2d')
    const avatarId = 'id' in chosen ? chosen.id : newAvatarId()
    // A voice sample only for a voice made from its description, and only when that voice is
    // new: the same voice keeps its sample. A fixed voice needs none.
    let voiceSample: undefined | { text: string; wav: string }
    let voiceNote = ''
    if (!voiceId && (!before || before.voice !== voice || !avatarVoice(avatarId))) {
      const ready = await voiceReadiness()
      if (!ready.designed)
        voiceNote =
          " Its voice couldn't be made here (no Qwen3 voices or fal key): lines will use a preset voice."
      else if (ready.designed === 'fal' && a['confirmPaid'] !== true)
        return {
          success: false,
          text: "The avatar's voice sample would be made on fal, paid (a few cents): this computer doesn't have Qwen3 voices installed. Tell the user in one line, then call avatar_save again with confirmPaid: true.",
        }
      else {
        const sample = await qwen3DesignVoiceSample({
          description: voice,
          languageCode: 'en',
          sampleText: AVATAR_SAMPLE_TEXT,
        })
        const wav = path.join(projectDir, 'out', 'avatar', 'voice.wav')
        fs.mkdirSync(path.dirname(wav), { recursive: true })
        fs.writeFileSync(wav, await toReferenceWav(sample.audioBuffer, 'sample.wav'))
        voiceSample = { text: AVATAR_SAMPLE_TEXT, wav }
      }
    }
    const previewDir = path.join(projectDir, 'out', 'avatar', `preview-${Date.now()}`)
    const [preview] = await renderStills(projectDir, [0], previewDir, 'AvatarPreview')
    if (!preview) return { success: false, text: "The avatar's picture did not render." }
    const photo = avatarPhoto(projectDir)
    saveAvatar({
      id: avatarId,
      name,
      ...(photo && !('id' in chosen) ? { photo } : {}),
      preview,
      rig: path.join(projectDir, AVATAR_RIG),
      style,
      voice,
      ...(voiceId ? { voiceId } : {}),
      ...(voiceSample ? { voiceSample } : {}),
    })
    markAvatarSaved(projectDir, avatarId)
    const spec = readAnimationJson(projectDir)
    writeAnimationJson(projectDir, { ...spec, avatar: { id: avatarId, name, style } })
    this.sessions.updateAnimation(id, { ...setup, avatar: { id: avatarId }, avatarName: name })
    this.sessions.emitImage(id, preview)
    return {
      success: true,
      text: `Saved the avatar "${name}" (${style.toUpperCase()}) to the user's avatars: every later Avatar video can use it.${voiceId ? ` Its voice is ${voiceName(voiceId)}, fixed: every video with ${name} speaks in it (the user can change it on the setup card). Record its lines with voices "Host: avatar".` : voiceSample ? ' Its voice sample is made: record its lines with voices "Host: avatar" and they are cloned from it.' : ' Record its lines with voices "Host: avatar".'}${voiceNote} Save again after changing it.`,
    }
  }

  /** animation_review: the last render as contact sheets with its stalls and long scenes, shown
   *  to Claude and the user. */
  private async review(id: string, projectDir: string, args: unknown): Promise<ToolCallResult> {
    const blocker = animationReviewBlocker(projectDir)
    if (blocker) return { success: false, text: blocker }
    try {
      const result = await reviewAnimation(projectDir, args)
      for (const file of result.sheets) this.sessions.emitImage(id, file)
      return { success: true, text: result.text }
    } catch (error) {
      if (error instanceof MotionSetupError) return { success: false, text: error.message }
      throw error
    }
  }

  /** animation_still: frames at the seconds asked, shown to Claude and the user. */
  private async stills(id: string, projectDir: string, args: unknown): Promise<ToolCallResult> {
    const seconds = parseStillSeconds(args)
    const spec = readAnimationJson(projectDir)
    const lastFrame = Math.round(videoSeconds(projectDir, spec) * spec.fps) - 1
    const frames = seconds.map((t) => Math.min(lastFrame, Math.round(t * spec.fps)))
    // A folder per call: the chat keeps showing earlier stills after the next look.
    const outDir = path.join(projectDir, 'out', 'stills', String(Date.now()))
    const files = await renderStills(projectDir, frames, outDir, COMPOSITION)
    for (const file of files) this.sessions.emitImage(id, file)
    const lines = seconds.map(
      (t, i) =>
        `- ${t} s (frame ${frames[i]}): ${ANIMATION_DIR}/${path.relative(projectDir, files[i] as string)}`,
    )
    return {
      success: true,
      text: `Rendered ${files.length} stills (the user sees them too). Open each file and look at it:\n${lines.join('\n')}`,
    }
  }

  /** animation_voice: records the lines with the voices this computer (or fal) can make. */
  private async recordVoice(
    setup: AgentAnimationSetupView,
    projectDir: string,
    args: unknown,
  ): Promise<ToolCallResult> {
    const parsed = parseVoiceArgs(args)
    const ready = await voiceReadiness()
    const look = animationLook(setup.lookId)
    // "Host: avatar": the saved avatar's own voice.
    const avatarId = setup.avatar && 'id' in setup.avatar ? setup.avatar.id : null
    if (parsed.lines.some((l) => l.voice.trim().toLowerCase() === 'avatar') && !avatarId)
      return {
        success: false,
        text: 'The avatar has no voice yet: save it with avatar_save (with its voice) first, then record with "Host: avatar".',
      }
    let lines = parsed.lines.map((l) =>
      l.voice.trim().toLowerCase() === 'avatar'
        ? { ...l, voice: `${AVATAR_VOICE_PREFIX}${avatarId}` }
        : l,
    )
    // Where each line speaks: a Kokoro preset, Qwen3 (a designed voice, an avatar's sample, a
    // Qwen3 preset or user voice), or a paid service (an avatar's ElevenLabs or Gemini voice).
    const fixed = avatarId ? readAvatar(avatarId)?.voiceId : undefined
    const avatarEngine = fixed ? await fixedVoiceEngine(fixed) : 'qwen3'
    const engineOf = (voice: string) =>
      voice.startsWith(KOKORO_VOICE_PREFIX)
        ? 'kokoro'
        : voice.startsWith(AVATAR_VOICE_PREFIX)
          ? avatarEngine
          : 'qwen3'
    let note = ''
    if (lines.some((l) => engineOf(l.voice) === 'qwen3') && !ready.designed) {
      if (look?.cast === 'duo' || !ready.preset)
        return {
          success: false,
          text: 'No designed voices here: install Qwen3 voices (run setup again) or add a fal key.',
        }
      lines = lines.map((l) =>
        engineOf(l.voice) === 'qwen3' ? { ...l, voice: NARRATOR_PRESET } : l,
      )
      note = ` Designed voices can't be made here, so the narrator uses a preset voice (${NARRATOR_PRESET}).`
    }
    const engines = new Set(lines.map((l) => engineOf(l.voice)))
    const cloud = engines.has('cloud')
    const paid =
      cloud ||
      (engines.has('qwen3') && ready.designed === 'fal') ||
      (engines.has('kokoro') && ready.preset === 'fal')
    if (paid && !parsed.confirmPaid) {
      const chars = lines.reduce((n, l) => n + l.text.length, 0)
      return {
        success: false,
        text: cloud
          ? `The avatar's voice (${voiceName(fixed ?? '')}) is a paid voice (about ${chars} characters, a few takes may be needed). Tell the user in one line, then call animation_voice again with the same lines and confirmPaid: true.`
          : `These voices would run on fal, paid (about ${chars} characters, a few takes may be needed): this computer doesn't have the voices installed. Tell the user in one line, then call animation_voice again with the same lines and confirmPaid: true.`,
      }
    }
    const spec = readAnimationJson(projectDir)
    const recorded = await recordVoices({
      deps: this.voice,
      fps: spec.fps,
      lines,
      pauseMs: parsed.pauseMs,
      projectDir,
    })
    writeAnimationJson(projectDir, { ...spec, voiceFile: 'voice.wav' })
    const who = [...new Set(recorded.lines.map((l) => l.who))].join(', ')
    const long =
      recorded.totalSec > setup.lengthSec + 3
        ? ` That is longer than the ${setup.lengthSec} s asked for: shorten or cut lines, then record again.`
        : ''
    return {
      success: true,
      text: [
        `Recorded ${recorded.lines.length} lines (${who}): ${recorded.totalSec} s in all, saved as public/voice.wav, with each line's start, end, words and loudness in public/voice/lines.json.${long}${note}`,
        recorded.ranOnFal ? 'Some takes ran on fal (paid).' : '',
        ...recorded.warnings,
        'Time the scenes to the lines with lineStart(i), lineEnd(i) and wordAt(i, w) from src/clock.ts; record again only when the script changes.',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  }

  /** What the setup card offers. */
  async options(): Promise<AgentAnimationOptions> {
    const voices = await voiceReadiness()
    return {
      avatars: listAvatars(),
      composers: MOTION_MUSIC_ENGINES.map((id) => ({
        id,
        ...MOTION_MUSIC_ENGINE_INFO[id],
        ...(id === 'composer' ? COMPOSED_BY_CLAUDE : {}),
      })),
      looks: ANIMATION_LOOKS.map((look) => ({
        defaultLengthSec: ANIMATION_DEFAULT_SEC,
        defaultTrackId: look.defaultTrackId,
        description: look.description,
        ...(look.cast === 'duo' && !voices.designed ? { disabledReason: NO_DESIGNED_VOICES } : {}),
        id: look.id,
        label: look.label,
        lengths: [...look.lengths],
        previewUrl: previewUrl(look.id),
        ...(look.withAvatar
          ? {
              withAvatar: {
                avatarStyles: [...look.withAvatar.avatarStyles],
                description: look.withAvatar.description,
                // The 2D one is the Avatar look's own clip until it has its own.
                previewUrl:
                  previewUrl(`avatar-${look.id}`) ??
                  (look.id === '2d' ? previewUrl('avatar') : null),
              },
            }
          : {}),
      })),
      maxLengthSec: ANIMATION_MAX_SEC,
      minLengthSec: ANIMATION_MIN_SEC,
      tracks: motionReelTracks().map((track) => ({
        bpm: track.bpm,
        id: track.id,
        previewUrl: presetUrl(track.file),
        title: track.title,
      })),
    }
  }

  /**
   * Takes the setup card: checks it (`AnimationSetupError`), then readies the project in the
   * background (installing Remotion the first time) and starts Claude. A failure is said in the
   * chat and the card opens again.
   */
  setup(id: string, body: unknown): void {
    const session = this.sessions.getSession(id)
    if (session.mode !== 'animation')
      throw new AnimationSetupError('This chat is not a Claude Animation.')
    if (session.animation || this.preparing.has(id)) throw new AnimationSetupTakenError()
    const setup = parseAnimationSetup(body)
    const music = this.musicFor(id, setup)
    const avatar = this.avatarFor(id, setup)
    this.preparing.add(id)
    void this.prepare(id, setup, music, avatar).finally(() => this.preparing.delete(id))
  }

  /** The music the card picked, as a file on this computer (null: none, or Claude makes it). */
  protected musicFor(id: string, setup: AgentAnimationSetup): null | ReelMusicSource {
    if (setup.music.source === 'none' || setup.music.source === 'agent') return null
    if (setup.music.source === 'library') {
      const track = motionReelTrack(setup.music.id)
      if (!track) throw new AnimationSetupError("That music isn't available.")
      return { bpm: track.bpm, file: presetPath(track.file), title: track.title }
    }
    const found = resolveAttachment(this.sessions.attachmentsDir(id), setup.music.id)
    if (!found || (found.kind !== 'audio' && found.kind !== 'video'))
      throw new AnimationSetupError('Upload the music again: that file is gone or is not audio.')
    return { file: found.path, title: found.name }
  }

  /** The Avatar video's avatar as a project gets it: a saved one's rig, or a new one's photo (an
   *  image the user attached). Undefined for the other looks. */
  protected avatarFor(id: string, setup: AgentAnimationSetup): ProjectAvatar | undefined {
    const choice = setup.avatar
    if (setup.lookId !== 'avatar' || !choice) return undefined
    if ('id' in choice) {
      const saved = readAvatar(choice.id)
      if (!saved)
        throw new AnimationSetupError('That avatar is gone: pick another or make a new one.')
      const styles = setup.stage ? animationLook(setup.stage)?.withAvatar?.avatarStyles : undefined
      if (styles && !styles.includes(saved.style))
        throw new AnimationSetupError(
          `${saved.name} is drawn ${saved.style.toUpperCase()}: pick a ${styles.join(' or ').toUpperCase()} avatar for this style.`,
        )
      return {
        id: saved.id,
        name: saved.name,
        rig: path.join(avatarDir(saved.id), 'avatar.ts'),
        style: saved.style,
      }
    }
    const photo = resolveAttachment(this.sessions.attachmentsDir(id), choice.photo)
    if (!photo || photo.kind !== 'image')
      throw new AnimationSetupError('Add the photo again: that file is gone or is not a picture.')
    return { id: null, name: choice.name, photo: photo.path, style: choice.style }
  }

  private async prepare(
    id: string,
    setup: AgentAnimationSetup,
    music: null | ReelMusicSource,
    avatar: ProjectAvatar | undefined,
  ): Promise<void> {
    this.sessions.setFlowWorking(id, true)
    try {
      const view = await this.ready(id, setup, music, avatar)
      this.sessions.setFlowWorking(id, false)
      this.sessions.startAnimation(id, view, animationKickoff(view))
    } catch (error) {
      logger.warn(`Claude Animation setup for ${id} failed: ${ensureError(error).message}`)
      this.sessions.setFlowWorking(id, false)
      this.sessions.emitNotice(
        id,
        `Couldn't set up the animation: ${ensureError(error).message.split('\n')[0]?.slice(0, 300)}`,
      )
      this.sessions.emitAutonomousEvent(id, { type: 'animation_setup_request' })
    }
  }

  /** Readies the project in the chat's folder (installing Remotion the first time): what the
   *  setup card and an Advanced chat's animation_setup both do. */
  protected async ready(
    id: string,
    setup: AgentAnimationSetup,
    music: null | ReelMusicSource,
    avatar?: ProjectAvatar,
  ): Promise<AgentAnimationSetupView> {
    await ensureMotionReelRuntime((line) => this.sessions.emitMessage(id, line))
    await prepareAnimationProject({
      ...(avatar ? { avatar } : {}),
      music,
      setup,
      workspace: this.sessions.workingDir(id),
    })
    return {
      ...setup,
      ...(avatar ? { avatarName: avatar.name } : {}),
      lookLabel: `${animationLook(setup.lookId)?.label ?? setup.lookId}${setup.stage ? `, in ${animationLook(setup.stage)?.label ?? setup.stage}` : ''}`,
      musicTitle: music?.title ?? null,
    }
  }
}

/** The newest track Claude made (`composed-<time>.mp3` from a music model, `composer-<time>.wav`
 *  from the composer), if any. */
function newestComposed(dir: string): null | string {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  const newest = names
    .map((name) => {
      const m = /^(?:composed-(\d+)\.mp3|composer-(\d+)\.wav)$/.exec(name)
      return { name, time: Number(m?.[1] ?? m?.[2]) }
    })
    .filter((m) => Number.isFinite(m.time))
    .sort((a, b) => a.time - b.time)
    .at(-1)
  return newest ? path.join(dir, newest.name) : null
}

/** The seconds an animation_still call asks for: up to 6 distinct, non-negative numbers. */
export function parseStillSeconds(raw: unknown): number[] {
  const text =
    raw &&
    typeof raw === 'object' &&
    typeof (raw as Record<string, unknown>)['seconds'] === 'string'
      ? ((raw as Record<string, unknown>)['seconds'] as string)
      : ''
  const seconds = [
    ...new Set(
      text
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 0),
    ),
  ]
  if (!seconds.length)
    throw new AnimationSetupError('Pass the moments to look at, in seconds, e.g. "0, 4.5, 12".')
  return seconds.slice(0, MAX_STILLS)
}

/** How long the video is: its length, or the voice plus a second, whichever is longer (as the
 *  project's clock counts it). */
function videoSeconds(projectDir: string, spec: { lengthSec: number }): number {
  let lastEnd = 0
  try {
    const lines = JSON.parse(
      fs.readFileSync(path.join(projectDir, 'public', 'voice', 'lines.json'), 'utf8'),
    ) as { end: number }[]
    lastEnd = lines.at(-1)?.end ?? 0
  } catch {
    lastEnd = 0
  }
  return Math.max(spec.lengthSec, lastEnd + 1)
}

/** The setup card's choices back out of the chat's saved setup. */
function setupFrom(view: AgentAnimationSetupView): AgentAnimationSetup {
  return {
    ...(view.avatar ? { avatar: view.avatar } : {}),
    ...(view.detail ? { detail: view.detail } : {}),
    lengthSec: view.lengthSec,
    lookId: view.lookId,
    music: view.music,
    ...(view.stage ? { stage: view.stage } : {}),
    subject: view.subject,
  }
}

/** A look's preview clip in the presets, when there is one. The link carries the file's version
 *  (its change time): the server lets browsers keep a preset for an hour, so a re-rendered clip
 *  needs a new link or the card keeps playing the old one. */
function previewUrl(lookId: string): null | string {
  const key = `animation/looks/${lookId}.mp4`
  try {
    const file = presetPath(key)
    if (!fs.existsSync(file)) return null
    return `${presetUrl(key)}?v=${Math.round(fs.statSync(file).mtimeMs)}`
  } catch {
    return null
  }
}
