// Loop-short activities (the beat-loop skill): the voiceover, the keyframes, one take of one
// clip with its QA, and the QA record the workflow keeps takes in. The workflow owns the order
// and the re-roll policy.
export { renderBeatLoopClip, type RenderBeatLoopClipParams } from './clip'
export type {
  BeatLoopClipMeta,
  BeatLoopReportedSpend,
  BeatLoopTransitionOptions,
} from './clip-video'
export {
  BEAT_LOOP_KEYFRAMES_PATH,
  type BeatLoopKeyframeResult,
  type BeatLoopKeyframeTextCheck,
  generateBeatLoopKeyframes,
  type GenerateBeatLoopKeyframesParams,
  type GenerateBeatLoopKeyframesResult,
} from './keyframes'
export { type BeatLoopClipModel, beatLoopClipModels } from './providers'
export {
  BEAT_LOOP_QA_PATH,
  type BeatLoopClipQaReadings,
  type BeatLoopClipSpend,
  type BeatLoopFallback,
  type BeatLoopQaClip,
  type BeatLoopQaFile,
  type BeatLoopTake,
  type BeatLoopTakeCheck,
  keepBeatLoopTake,
  type KeepBeatLoopTakeResult,
  pickBeatLoopTake,
  readBeatLoopQa,
} from './qa-store'
export {
  type BeatLoopVoiceLine,
  fitBeatLoopLine,
  generateBeatLoopVoiceover,
  type GenerateBeatLoopVoiceoverParams,
  type GenerateBeatLoopVoiceoverResult,
} from './voiceover'
