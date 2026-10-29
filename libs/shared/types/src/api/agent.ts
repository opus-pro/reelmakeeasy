/** Question id -> the chosen option labels and/or typed text. */
export type AgentAnswers = Record<string, string[]>

/** How a session's chat is driven, per tool: a short video's autonomous run (Easy) or free chat
 *  (Advanced); a ranking short's guided chat (Easy: one question at a time, then the agent builds
 *  it) or free chat (Advanced), both in the Ranking Builder; a Motion Reel's setup card, then a
 *  chat that builds it in Remotion (Easy, `motion`), or a free chat in which the agent sets it up
 *  itself (Advanced, `motion_free`); a Claude Animation's setup card, then a chat in which Claude
 *  builds it in Remotion (Easy, `animation`), or a free chat in which Claude sets it up itself
 *  (Advanced, `animation_free`). Chosen once, right after the session is created. A former
 *  mode, 'guided', was removed: chats saved with it load as 'free' (`agentModeFromStored`). */
export type AgentMode =
  | 'animation'
  | 'animation_free'
  | 'autonomous'
  | 'free'
  | 'motion'
  | 'motion_free'
  | 'ranking'
  | 'ranking_easy'

/** A Claude Animation's look: the visual style it is drawn in. `avatar`: a talking head, the
 *  user's own avatar (2D or 3D) talking to the camera. */
export type AnimationLookId = '2d' | '3d' | '8bit' | 'avatar'

/** A style the card offers (`8bit` is Pixel art); an Avatar explainer is drawn in one of them. */
export type AnimationStyleId = Exclude<AnimationLookId, 'avatar'>

/** How much detail goes into a code video (Motion Reel, Claude Animation), the user's pick on the
 *  setup card: `xhigh` is Extra high. */
export type VideoDetail = 'high' | 'low' | 'medium' | 'xhigh'

/** How an avatar is drawn. */
export type AvatarStyle = '2d' | '3d' | 'pixel'

/** A saved avatar (`GET /api/agent/avatars`). */
export type AgentAvatar = {
  createdAt: string
  id: string
  /** How the user described it in the avatar creator ('' when they didn't). */
  look: string
  name: string
  /** Its picture (head and shoulders), or null before it has one. */
  previewUrl: null | string
  style: AvatarStyle
  /** How it sounds, in words (the voice made from it when it has no fixed voice). */
  voiceDescription: string
  /** Its fixed voice, every video the same: a voice library id (a preset or one of the user's
   *  own voices). Null: it speaks with the voice made from its description. */
  voiceId: null | string
  /** The voice made from its description, to listen to; null when it has none. */
  voiceSampleUrl: null | string
}

/** The Avatar video's avatar: a saved one, or a new one Claude draws from a photo (an attachment
 *  of the chat, by its name), a description of how it looks, or both. */
export type AgentAnimationAvatar =
  | { id: string }
  | { description?: string; name: string; photo?: string; style: AvatarStyle }

/** What the Claude Animation setup card sends (`POST /api/agent/sessions/:id/animation`). */
export type AgentAnimationSetup = {
  /** The Avatar video look's avatar (only with lookId `avatar`). */
  avatar?: AgentAnimationAvatar
  /** The avatar creator: draw, check and save the new avatar only, no video. */
  avatarOnly?: boolean
  /** A new avatar's fixed voice, picked in the creator (a voice library id). */
  avatarVoiceId?: string
  /** An Avatar explainer's style, the world the host is drawn in: `2d` or `3d` (the avatar's own
   *  style), or `8bit` (Pixel art, with a 2D or 3D avatar). Unset: the avatar's own style. */
  stage?: AnimationStyleId
  /** How much detail to build in; unset (a chat set up before it existed): Extra high. */
  detail?: VideoDetail
  /** About this long, in seconds: a whole number from 10 to 90. */
  lengthSec: number
  lookId: AnimationLookId
  /** Motion Reel's music choices. */
  music: AgentMotionSetup['music']
  /** What it is about; null: Claude picks a fun fact itself (Surprise me). */
  subject: null | string
}

/** `GET /api/agent/animation/options`: what the Claude Animation setup card offers. */
export type AgentAnimationOptions = {
  /** The saved avatars, newest first (the Avatar video look). */
  avatars: AgentAvatar[]
  composers: AgentMotionOptions['composers']
  /** Any whole number of seconds in this range can be typed in. */
  maxLengthSec: number
  minLengthSec: number
  looks: {
    defaultLengthSec: number
    /** The track the card picks with this look. */
    defaultTrackId: null | string
    description: string
    /** Why the look can't be picked here (no way to make its voices), when it can't. */
    disabledReason?: string
    id: AnimationLookId
    label: string
    lengths: number[]
    /** A short silent clip of the look (null until the preset pack has one). */
    previewUrl: null | string
    /** A style's Avatar explainer version (your avatar hosts it): what it is and its clip;
     *  absent for the avatar look itself. */
    withAvatar?: { avatarStyles: AvatarStyle[]; description: string; previewUrl: null | string }
  }[]
  tracks: AgentMotionOptions['tracks']
}

/** The setup a Claude Animation chat settled on, as its card shows it once chosen. */
export type AgentAnimationSetupView = AgentAnimationSetup & {
  /** The Avatar video's avatar's name. */
  avatarName?: string
  lookLabel: string
  musicTitle: null | string
}

/** What the Motion Reel setup card sends (`POST /api/agent/sessions/:id/motion-reel`). */
export type AgentMotionSetup = {
  /** How much detail to build in; unset (a chat set up before it existed): Extra high. */
  detail?: VideoDetail
  /** About this long, in seconds; the reel is whole bars of its music. */
  lengthSec: number
  /** A library track's id, an attachment's name (`upload`), no music, or made by the agent
   *  (`agent`): composed by the agent itself, or with a music model (`engine`). */
  music:
    | { engine: 'ace-step' | 'composer' | 'eleven-music'; source: 'agent' }
    | { id: string; source: 'library' | 'upload' }
    | { source: 'none' }
  ratio: '1:1' | '9:16' | '16:9'
  /** A video or web page to take the look from (never the content). */
  reference?: { kind: 'website' | 'youtube'; url: string }
  /** What the reel is about: the words and facts it may use. */
  subject: string
  /** The kind of reel: a product launch (one product, shown working) or a motion reel (pure
   *  show-off motion). The agent decides the look. */
  type: 'launch' | 'showreel'
}

/** `GET /api/agent/motion-reel/options`: what the Motion Reel setup card offers. */
export type AgentMotionOptions = {
  /** The ways the agent can make the music itself, the recommended first. */
  composers: {
    cost: string
    description: string
    id: 'ace-step' | 'composer' | 'eleven-music'
    label: string
  }[]
  defaultLengthSec: number
  defaultRatio: AgentMotionSetup['ratio']
  lengths: number[]
  ratios: AgentMotionSetup['ratio'][]
  /** The library tracks, the card's default first. */
  tracks: { bpm: number; id: string; previewUrl: string; title: string }[]
  /** The kinds of reel, the card's default first. */
  types: { description: string; id: AgentMotionSetup['type']; label: string }[]
}

/** The setup a Motion Reel chat settled on, as its card shows it once chosen. */
export type AgentMotionSetupView = AgentMotionSetup & {
  /** The reel's real length (whole bars), its tempo and the music's title. */
  bars: number
  bpm: number
  musicTitle: null | string
  reelSec: number
  /** The type's label (e.g. "Product launch"). */
  typeLabel: string
}

export type AgentPlanStep = { status: 'completed' | 'inProgress' | 'pending'; step: string }

/** One phase of a Motion Reel, as its Tasks panel shows it: worked out by ReelMakeEasy from the
 *  reel's folder and the chat's Motion Reel tool calls, never from what the agent says. */
export interface AgentMotionTask {
  /** More to show when the row is opened (the stills taken, the sync report's lines). */
  details?: string[]
  id: AgentMotionTaskId
  label: string
  /** One line on how it went (e.g. "Render 2 of 3", "Sync: passes."); null: nothing yet. */
  result: null | string
  state: AgentMotionTaskState
}

/** A Motion Reel's plan (`reel/plan.md`) as the agent wrote it, for its Tasks panel: the agent's
 *  own text, so shown as markdown with no raw HTML. */
export interface AgentMotionPlan {
  /** When the file last changed (ms). */
  changedAt: number
  text: string
  /** The file is longer than ReelMakeEasy reads: `text` is its start. */
  truncated: boolean
}

export type AgentMotionTaskId =
  | 'avatar'
  | 'build'
  | 'voice'
  | 'look'
  | 'music'
  | 'plan'
  | 'render'
  | 'review'
  | 'setup'
  | 'sync'

export type AgentMotionTaskState = 'done' | 'failed' | 'running' | 'waiting'

/** What a chat makes: a tool, each with an Easy and an Advanced mode. */
export type AgentTool = 'animation' | 'motion' | 'ranking' | 'short'

/** A short silent clip that shows what an option looks like (ReelMakeEasy's own cards only). The
 *  chat's transcript keeps their addresses; the browser gets the URLs. */
export type AgentOptionSample = {
  /** URL of a still of the clip's first frame. */
  posterUrl: string
  /** URL of the clip (vertical, muted, loops). */
  videoUrl: string
}

/** One choice on a question card. */
export type AgentQuestionOption = {
  description: string
  label: string
  /** A sample clip the card shows beside the option, e.g. each camera style on Easy's card. */
  sample?: AgentOptionSample
}

/** One question Codex asks the user (from `item/tool/requestUserInput`). */
export type AgentQuestion = {
  header: string
  id: string
  /** A short explanation the card shows behind an info icon (ReelMakeEasy's own cards only). */
  info?: string
  isOther: boolean
  isSecret: boolean
  options: AgentQuestionOption[]
  question: string
}

/** The brief an autonomous session settled on, kept for the video start. */
export interface AgentAutonomousBrief {
  brief: string
  /** The camera style picked on the Easy flow's card. */
  cameraStyle?: 'calm' | 'dynamic'
  durationSeconds: number
  /** What the video is: a story video (long-take), or a beat-loop short made from `storyboard`.
   *  Missing = a story video (every brief from before loop shorts). */
  format?: AgentVideoFormat
  /** The music choice (the Easy card or `make_video`): a preset, off, the user's own words,
   *  or a track (a library track or one of their own). */
  music?: {
    choice?: 'auto' | 'calm' | 'off' | 'upbeat'
    note?: string
    track?: { id: string; source: 'library' | 'upload' }
  }
  /** The first sentence the user chose for the voice-over (the opening hook). */
  opening?: string
  /** A script to use word for word (`make_video`); without it the brief is turned into one. */
  script?: string
  /** A loop short's storyboard (`format: 'beat_loop'`), already validated. */
  storyboard?: BeatLoopStoryboard
  title: string
  /** The voice an Easy loop's lines were said in (and will be in the video). */
  voice?: AgentLoopVoice
}

/** A voice a loop's lines were said in. */
export interface AgentLoopVoice {
  /** It runs free on this computer (a local voice). */
  free: boolean
  id: string
  name: string
}

/** One idea Easy's idea search found (its card shows the title and hook only). */
export interface AgentEasyIdea {
  hook: string
  source: 'famous_figure' | 'fun_fact' | 'recent_news'
  sourceUrl: string
  title: string
  /** When it happened or was found: for the brief's fact check, never shown. */
  when: string
}

/** One opener Easy drafted for its attention-hook card. */
export interface AgentEasyOpening {
  line: string
  style: string
  why: string
}

/**
 * What "Pick up where you left off" does for an interrupted Easy chat (`AgentSession.resume`),
 * so its line and button can say so before the click:
 * - `carry_on`: its open card (or the next one) is asked again; nothing is spent until the
 *   user answers a card.
 * - `make_loop`: the loop its "Make this loop?" card was answered "Make it" for, before
 *   ReelMakeEasy stopped, is made at once, at the price that card showed (`costUsd`; missing when
 *   the card didn't say).
 * - `start_video`: the story video whose style was picked starts at once.
 */
export type AgentResumeAction =
  | { costUsd?: number; kind: 'make_loop' }
  | { kind: 'carry_on' }
  | { kind: 'start_video' }

/**
 * What Easy's flow made that neither its cards nor its brief keep, so a flow cut off by a
 * restart can pick up where it left off without making it again: the ideas and openers its
 * cards offered, and the project its video start made.
 */
export interface AgentEasyProgress {
  ideas?: AgentEasyIdea[]
  openings?: AgentEasyOpening[]
  projectId?: string
}

/**
 * `Project.createUseCase` of a loop short (a brief with `format: 'beat_loop'`): the project is
 * what tells the API and the web it holds one.
 */
export const BEAT_LOOP_USE_CASE = 'beat-loop'

export type AgentHarnessName = 'claude' | 'codex'
export const AGENT_HARNESSES: readonly AgentHarnessName[] = ['codex', 'claude']

/** Why a harness can't be picked, in a few words: the Agent dialog's greyed-out rows and the
 *  AI options in Setup. */
export const HARNESS_UNAVAILABLE_REASON: Record<
  AgentHarnessName,
  Record<CodexUnavailableReason, string>
> = {
  claude: {
    'no-sandbox': 'Needs bubblewrap and socat on this machine',
    'not-found': 'Not installed',
    'not-logged-in': 'Sign in: run claude login in a terminal',
    'probe-failed': "Didn't respond. Set CLAUDE_BIN in .env",
  },
  codex: {
    'no-sandbox': 'Its sandbox is missing on this machine',
    'not-found': 'Not installed',
    'not-logged-in': 'Sign in: open ChatGPT and sign in to Codex',
    'probe-failed': "Didn't respond. Set CODEX_BIN in .env",
  },
}

/** What kind of file an attachment is: pictures go to the model too, the rest by path only. */
export type AgentAttachmentKind = 'audio' | 'file' | 'image' | 'video'

/** A file sent with a chat message, saved in the chat's `attachments/` folder on this computer. */
export interface AgentAttachment {
  kind: AgentAttachmentKind
  /** The saved file's name in `attachments/` (what a message refers to it by). */
  name: string
  /** The file's absolute path: the agent opens it from there. */
  path: string
  size: number
}

/** A model for agent chats, and how hard it thinks (`effort`; unset = the model's own). */
export interface ChatModelChoice {
  effort?: string
  model: string
}

/** One model a harness offers this user (from Codex's `model/list`, Claude Code's models). */
export interface ChatModelOption {
  /** The model's own thinking level when none is picked. */
  defaultEffort?: string
  /** Thinking levels it takes, lowest first (empty: it takes none). */
  efforts: string[]
  id: string
  label: string
}

/**
 * `GET /api/agent/sessions/:id/model`: the model a chat runs on and what it could run on.
 * `source` says where `current` comes from: picked for this chat, the saved default, or the
 * recommended one (newest Opus; GPT-6-Astra, or the newest Sol on a free, Go or Plus plan).
 */
export interface ChatModelState {
  current: ChatModelChoice | null
  /** The saved default for this harness, if any. */
  default: ChatModelChoice | null
  harness: AgentHarnessName
  models: ChatModelOption[]
  /** The account's plan as the harness says it (`plus`, `team`, `Claude Max`...). */
  plan?: string
  recommended: ChatModelChoice | null
  source: 'chat' | 'default' | 'recommended' | 'unknown'
}

export interface AgentSession {
  /** Set once an autonomous session has polished its brief. */
  autonomous?: AgentAutonomousBrief
  /** The model (and thinking level) the user picked for this chat; unset = the default. */
  chatModel?: ChatModelChoice
  createdAt: string
  /** What Easy's flow made so far that its chat doesn't keep (to pick up after a restart). */
  easyProgress?: AgentEasyProgress
  /** The user is editing the finished video in this chat (Easy: after the Edit card). */
  editing?: boolean
  /** An autonomous flow is under way: chat messages are refused until it starts the video or
   *  ends (Stop, a failure, a restart). */
  flowActive?: boolean
  /** Which agent runs this chat; fixed once the mode is chosen. Missing = codex (every chat
   *  from before Claude Code). */
  harness?: AgentHarnessName
  id: string
  /** Easy's flow was cut off by ReelMakeEasy stopping (a restart, a shutdown or a crash), not by
   *  the user, before its video started: the chat offers "Pick up where you left off"
   *  (`POST /api/agent/sessions/:id/resume`). False once it picks up, or when it can't (the
   *  user stopped it, its video started, it failed). */
  interrupted?: boolean
  mode?: AgentMode
  /** A Claude Animation chat's setup, once its card was sent (the chat opens then). */
  animation?: AgentAnimationSetupView
  /** A Motion Reel chat's setup, once its card was sent (the chat opens then). */
  motionReel?: AgentMotionSetupView
  /** The project an autonomous session started its video in. */
  projectId: null | string
  /** A Ranking chat's ranking (the one its tools last read or changed, or the one it was opened
   *  from in the studio). */
  rankingId?: string
  /** The poster (its address) of the newest video a Motion Reel or Claude Animation chat
   *  rendered: the chat's thumbnail in the list. */
  videoPoster?: string
  /** Only in the API's view of a chat that can pick up where it left off
   *  (`GET /api/agent/sessions/:id`), never saved: what picking up does. */
  resume?: AgentResumeAction
  status: AgentSessionStatus
  /** The user pressed Stop on Easy's flow: kept at once, so a restart before the flow has
   *  ended doesn't take it for one ReelMakeEasy cut off (`interrupted`). */
  stoppedByUser?: boolean
  threadId: null | string
  title: string
  /** The ReelMakeEasy tools the Codex thread was started with; a thread missing tools the
   *  session now needs is replaced on the next start. */
  tools?: string[]
  /** Last persisted activity (ISO). Missing on sessions saved before it existed: use `createdAt`. */
  updatedAt?: string
}

export type AgentSessionStatus = 'idle' | 'running' | 'stopped'

/** `GET /api/agent/status`: both harnesses. The top-level fields are Codex's, kept for one
 *  release so an open page from before still works. */
export interface AgentStatusResponse extends CodexStatus {
  claude: HarnessStatus
  codex: HarnessStatus
  /** The harness the mode card preselects (`AGENT_HARNESS`, default codex). */
  defaultHarness: AgentHarnessName
}

export interface CodexStatus {
  available: boolean
  binary: null | string
  loggedIn: boolean
  reason?: CodexUnavailableReason
  version: null | string
}

/** Why a harness can't run a chat. `no-sandbox`: Claude Code's shell sandbox is missing
 *  (bubblewrap and socat on Linux). */
export type CodexUnavailableReason = 'no-sandbox' | 'not-found' | 'not-logged-in' | 'probe-failed'

/** A harness's install/sign-in state (the same fields for Codex and Claude Code). */
export type HarnessStatus = CodexStatus

/** Events the browser receives. `id` increases per session. */
export type AgentUiEvent = { id?: number } & (
  | { answers: AgentAnswers; questionId: string; type: 'question_answered' }
  /** The brief an autonomous session settled on (the same text as the message that shows it),
   *  for the storyboard panel. A loop short's (`make_beat_loop`) has its `lines` too. Easy's
   *  first brief has no `durationSeconds`: the user picks the length after the camera, and the
   *  brief comes again with it. */
  | {
      brief: string
      durationSeconds?: number
      lines?: AgentLoopLine[]
      title: string
      type: 'brief'
    }
  | {
      command: string
      exitCode?: null | number
      itemId: string
      status: 'completed' | 'failed' | 'started'
      type: 'command'
    }
  | { error?: string; status: 'completed' | 'failed' | 'interrupted' | 'started'; type: 'turn' }
  | { itemId: string; path: string; type: 'image' }
  | { itemId: string; status: 'completed' | 'started'; text: string; type: 'thinking' }
  | { itemId: string; status: 'failed' | 'started'; type: 'image_progress' }
  | { itemId: string; text: string; type: 'message' }
  | { itemId: string; text: string; type: 'text_delta' }
  | { itemId: string; text: string; type: 'thinking_delta' }
  | {
      itemId: string
      status: 'completed' | 'failed' | 'started'
      summary: string
      tool: string
      type: 'tool'
    }
  | { mode: AgentMode; type: 'mode' }
  /** An edit tool rebuilt the project's video: the page re-reads it. */
  | { projectId: string; type: 'video_rendered' }
  | { projectId: string; type: 'video_started' }
  /** `server`: ReelMakeEasy asked it itself (`askServerQuestion`, e.g. the "Make this loop?" card),
   *  not the agent. It outlives the agent's turn: it stays open until ReelMakeEasy answers or
   *  expires it. */
  | { questionId: string; questions: AgentQuestion[]; server?: true; type: 'question' }
  | { questionId: string; type: 'question_expired' }
  /** A Ranking chat follows this ranking now, and it just changed (the preview reloads it). */
  | { rankingId: string; type: 'ranking' }
  | { reason?: string; status: AgentSessionStatus; type: 'session' }
  | { steps: AgentPlanStep[]; type: 'plan' }
  | { styleId: string; styleName: string; thumbnailUrl?: string; type: 'style_chosen' }
  /** A ReelMakeEasy-authored notice (not from Codex), e.g. a failed autonomous step. */
  | { text: string; type: 'notice' }
  /** `attachments`: files sent with the message (saved in the chat's `attachments/` folder). */
  | { attachments?: AgentAttachment[]; text: string; type: 'user_message' }
  /** The session entered edit mode: the composer unlocks and takes focus. */
  | { type: 'editing' }
  /** The user stopped an autonomous flow (Stop on a card, during a step, or in a cold start):
   *  emitted once, when the flow ends. An open style card expires. */
  | { type: 'flow_cancelled' }
  /** Autonomous mode wants the user to pick a style (the inline style picker). */
  | { type: 'style_request' }
  /** A Claude Animation chat wants its setup (the inline setup card). */
  | { type: 'animation_setup_request' }
  /** The Claude Animation setup was sent and its project is ready. */
  | { setup: AgentAnimationSetupView; type: 'animation_setup' }
  /** A Motion Reel chat wants its setup (the inline setup card). */
  | { type: 'motion_setup_request' }
  /** The Motion Reel setup was sent and its project is ready. */
  | { setup: AgentMotionSetupView; type: 'motion_setup' }
  /** A rendered Motion Reel. `report`: how its cuts sit on the beat grid, in one line. */
  | { itemId: string; posterUrl?: string; report?: string; type: 'motion_video'; videoUrl: string }
  /** A Motion Reel's phases now (the Tasks panel): sent after each Motion Reel tool call starts
   *  and ends, while a turn runs, before the agent's question card and when its turn ends.
   *  `plan`: its plan, sent when it changed (null: no plan); absent, the plan is as last sent. */
  | { plan?: AgentMotionPlan | null; tasks: AgentMotionTask[]; type: 'motion_tasks' }
)

/** One line of a loop short, as the storyboard panel lists it: what is said, and the fact stamp
 *  shown with it (null: none). */
export interface AgentLoopLine {
  narration: string
  stamp: null | string
}

/** A chat's project, as the agent sidebar shows it. */
export interface AgentSessionProject {
  /** ISO string; null when the project row no longer exists (`deleted: true` with no data).
   *  Feeds `isStaleInProgressProject` so an orphaned in-progress project ages into "failed"
   *  instead of generating forever. */
  createdAt: null | string
  /** `isDeleted`, or the project row no longer exists. */
  deleted: boolean
  hasResultVideo: boolean
  id: string
  name: string
  stage: null | string
  /** previewThumbnail || resultVideoThumbnail || styleThumbnailUrl (empty strings skip). */
  thumbnail: null | string
}

/** One row of `GET /api/agent/sessions`. */
export interface AgentSessionListItem {
  createdAt: string
  flowActive: boolean
  id: string
  mode: AgentMode | null
  /** The poster of the newest video a Motion Reel or Claude Animation chat rendered. */
  posterUrl: null | string
  project: AgentSessionProject | null
  /** The cover of the ranking a Ranking chat works on, when it has one. */
  rankingCoverUrl: null | string
  status: AgentSessionStatus
  /** The live project's name when there is one, else the chat's own title. */
  title: string
  updatedAt: string
}

/** `story`: a long-take story video. `beat_loop`: a loop short of N x 4 s clips, each one
 *  hit, hit, freeze, cut, that replays seamlessly. */
export type AgentVideoFormat = 'beat_loop' | 'story'

/** The caption look an older loop storyboard named. No longer read: captions are styled in the
 *  app. */
export type BeatLoopCaptionStyle = 'explainer' | 'punch'

/** One 4 s clip of a loop short (the beat-loop skill's storyboard, section 10). */
export interface BeatLoopClip {
  /** What is shown on screen when it differs from the narration ("2560 BC"); null shows the
   *  narration. */
  caption: null | string
  /** Beat 4 (3-4 s): one physical camera move that travels into the next keyframe. */
  cut: string
  cut_camera: BeatLoopCutCamera
  /** Beat 3 (2-3 s): the hit's motion freezing, same subject and framing. */
  freeze: string
  /** Beats 1-2 (0-2 s): one big, sudden action on the subject already in frame. */
  hit: string
  hit_camera: BeatLoopHitCamera
  id: string
  /** What is spoken, numbers written as words (6-12 words, 8-10 fit best). */
  narration: string
  /** A short exact fact label shown top-right from 0.3 to 3.0 s ("c. 2560 BC"), or null. */
  stamp: null | string
}

export type BeatLoopCutCamera =
  | 'Pan left'
  | 'Pan right'
  | 'Pull out'
  | 'Push in'
  | 'Tilt down'
  | 'Tilt up'
  | 'Zoom in'

export type BeatLoopHitCamera = 'Push in' | 'Shake' | 'Zoom in'

/** A keyframe: a picture to make from `prompt`, or (last only) `same_as` the first keyframe, which
 *  closes the loop. Exactly one of the two is set. */
export interface BeatLoopKeyframe {
  id: string
  prompt?: string
  same_as?: string
}

/** The video length in seconds: 4 s per clip. */
export type BeatLoopLength = 16 | 20 | 24 | 28 | 32

/** A loop short's storyboard, as the beat-loop skill writes it (section 10). */
export interface BeatLoopStoryboard {
  /** The writer's suggested caption highlight colour, `#RRGGBB`: offered in the app, never
   *  applied on its own. */
  accent?: string
  /** Older storyboards only; ignored (the check drops it). */
  caption_style?: BeatLoopCaptionStyle
  /** duration_s / 4 clips, in order. */
  clips: BeatLoopClip[]
  duration_s: BeatLoopLength
  /** One per clip (f0 opens clip 1), optionally plus a last `{ same_as: 'f0' }`. */
  keyframes: BeatLoopKeyframe[]
  /** Where the facts come from (not shown on screen). */
  sources: string
  /** The look, appended to every keyframe and clip prompt. Missing: the user picks a style. */
  style?: string
  title: string
  /** The voice the writer had in mind; the tool's `voice` argument picks the real one. */
  voice?: string
}

/** Each tool's modes: Easy (guided) first, then Advanced (free chat). */
export const AGENT_TOOL_MODES: Record<AgentTool, { advanced: AgentMode; easy: AgentMode }> = {
  animation: { advanced: 'animation_free', easy: 'animation' },
  motion: { advanced: 'motion_free', easy: 'motion' },
  ranking: { advanced: 'ranking', easy: 'ranking_easy' },
  short: { advanced: 'free', easy: 'autonomous' },
}

/** The tool a mode belongs to. */
export function toolOfMode(mode: AgentMode): AgentTool {
  if (mode === 'animation' || mode === 'animation_free') return 'animation'
  if (mode === 'motion' || mode === 'motion_free') return 'motion'
  return mode === 'ranking' || mode === 'ranking_easy' ? 'ranking' : 'short'
}

/** A Motion Reel chat, Easy (its setup card) or Advanced (the agent sets it up). */
export function isMotionMode(mode: AgentMode | null | undefined): boolean {
  return !!mode && toolOfMode(mode) === 'motion'
}

/** A Claude Animation chat, Easy (its setup card) or Advanced (Claude sets it up). */
export function isAnimationMode(mode: AgentMode | null | undefined): boolean {
  return !!mode && toolOfMode(mode) === 'animation'
}

/** A chat whose agent writes the video as code (Motion Reel or Claude Animation): it runs on the
 *  strongest model only, and is driven by chat after its setup. */
export function isCodeVideoMode(mode: AgentMode | null | undefined): boolean {
  return isMotionMode(mode) || isAnimationMode(mode)
}

/** A Ranking chat, Easy or Advanced: it builds ranking shorts with the ranking tools. */
export function isRankingMode(mode: AgentMode | null | undefined): boolean {
  return !!mode && toolOfMode(mode) === 'ranking'
}

/** The start of the id of an Easy ranking's first card (ReelMakeEasy's own: what it's about). */
export const RANKING_TOPIC_QUESTION_PREFIX = 'ranking-topic'

/** Whether a question id is an Easy ranking's topic card. */
export const isRankingTopicQuestion = (id: string | undefined): boolean =>
  !!id?.startsWith(RANKING_TOPIC_QUESTION_PREFIX)
