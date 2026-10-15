export {
  LongTakeWorkflow,
  longTakeWorkflow,
  LongTakeWorkflow as StoryMode,
  V4ScriptPreviewWorkflow,
  v4ScriptPreviewWorkflow,
} from '@reelmakeeasy/story-mode-runtime/workflows'
// TODO: remove after all in-flight longTakeWorkflow-new workflows drain

export { LongTakeWorkflow as 'LongTakeWorkflow-new' } from '@reelmakeeasy/story-mode-runtime/workflows'
export { longTakeWorkflow as 'longTakeWorkflow-new' } from '@reelmakeeasy/story-mode-runtime/workflows'

// UIP (User Intent Planner) workflows
export {
  UipToStoryModeFastWorkflow,
  uipToStoryModeFastWorkflow,
  UipToStoryModeWorkflow,
  uipToStoryModeWorkflow,
} from '@reelmakeeasy/story-mode-runtime/workflows/uip-to-story-mode'
// Story Mode 3.0 render topology. `uip-confirm-orchestration` picks
// between this and UipToStoryModeWorkflow by the pinned
// `spec.meta.story_mode_v3_enabled` snapshot and passes the NAME to
// `workflow.start`, so it has to be exported here regardless of what imports
// it transitively.
export {
  UipToStoryModeV3Workflow,
  uipToStoryModeV3Workflow,
} from '@reelmakeeasy/story-mode-runtime/workflows'
// Story Mode 3.0 playground: started by name from the playground API,
// so it needs an explicit export here like every other by-name caller.
export {
  StoryMode3PlaygroundWorkflow,
  storyMode3PlaygroundWorkflow,
} from '@reelmakeeasy/story-mode-runtime/workflows'
// UIP V2 (Phase 3: real event-driven main loop + background sync loop). The
// only UIP session workflow now that V1 is retired; the tool-runner
// child is started by executeDecision.
export {
  UipSessionV2Workflow,
  uipSessionV2Workflow,
} from '@reelmakeeasy/story-mode-runtime/workflows/uip-v2'
export { UipV2ToolRunnerWorkflow } from '@reelmakeeasy/story-mode-runtime/workflows/uip-v2-tool-runner'

// pre-voiceover child workflow is spawned by the UIP session workflow in audio mode
// and routed to the story-mode workflow task queue (where its audio
// activities are registered). Exported explicitly: the engine registers only
// the workflows exported here, by name.
// MusicPreAnalysisWorkflow is the detached grandchild PreVoiceoverWorkflow
// Stage 4 starts for gated music uploads; it runs on this same
// task queue, so it must be exported here or the child fails with
// "Workflow type ... is not registered".
export {
  MusicPreAnalysisWorkflow,
  musicPreAnalysisWorkflow,
  PreVoiceoverWorkflow,
  preVoiceoverWorkflow,
} from '@reelmakeeasy/story-mode-runtime/workflows/pre-voiceover'

// brand-extraction child workflow is spawned by uipSessionWorkflow when the
// planner classifies brand intent. Routes to its own task
// queue (`TASK_QUEUES.BRAND_EXTRACTION`) so Chromium concurrency is bounded
// per pod. Exported explicitly per the same rationale as PreVoiceoverWorkflow.
export {
  BrandExtractionWorkflow,
  brandExtractionWorkflow,
} from '@reelmakeeasy/story-mode-runtime/workflows/brand-extraction'

// BGM settings re-mux + on-demand bed regeneration, started by the
// API on music panel edits and routed to this task queue. Exported explicitly
// per the same rationale as PreVoiceoverWorkflow above.
export {
  LongTakeBgmRegenerateWorkflow,
  longTakeBgmRegenerateWorkflow,
  LongTakeBgmRemuxWorkflow,
  longTakeBgmRemuxWorkflow,
} from '@reelmakeeasy/story-mode-runtime/workflows'

// Editor export: re-render a delivered project from its current editor state,
// started by the API's POST /long-take-videos/:projectId/render.
export {
  LongTakeEditRenderWorkflow,
  longTakeEditRenderWorkflow,
} from '@reelmakeeasy/story-mode-runtime/workflows'

// Editor "Regenerate shot" and agent edit mode's regenerate_clip: redo clips of a
// finished video in place. Started by the API with the workflow type the removed
// upstream editor service used, so its start call is unchanged.
export {
  RegenerateTransitionWorkflow,
  regenerateTransitionWorkflow,
} from '@reelmakeeasy/story-mode-runtime/workflows'

// Regenerate a finished long-take into a NEW project on a different transition
// video model (started by the API through the standard admission path).
// Exported explicitly per the same rationale as PreVoiceoverWorkflow above.
export {
  LongTakeRegenerateWorkflow,
  longTakeRegenerateWorkflow,
} from '@reelmakeeasy/story-mode-runtime/workflows'

// Regenerate a finished long-take into a NEW project under a different
// visual style (started by the API through the standard admission path, by name
// string only). Sibling of the regenerate workflow above, exported explicitly
// per the same rationale.
export {
  LongTakeRestyleWorkflow,
  longTakeRestyleWorkflow,
} from '@reelmakeeasy/story-mode-runtime/workflows'

// Loop shorts (the beat-loop skill): started by name from the API's BeatLoopService through
// the standard admission path. Exported explicitly per the same rationale as
// PreVoiceoverWorkflow above.
export { BeatLoopWorkflow, beatLoopWorkflow } from '@reelmakeeasy/story-mode-runtime/workflows'
