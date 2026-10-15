import type { UipSessionWorkflowParams } from '@reelmakeeasy/uip-planner-runtime'
import { ParentClosePolicy, startChild, workflowInfo } from '@reelmakeeasy/workflow-engine/workflow'

import { PreVoiceoverWorkflow } from '../pre-voiceover/workflow'

/**
 * Start the pre-voiceover child (audio sessions). ABANDON child on the
 * story-mode task queue (its audio activities live there). It signals
 * pre_voiceover_script_ready (unblocks bootstrap_script) then
 * pre_voiceover_artifacts_ready (canonical voiceOverPath). Failure is observed
 * via the idle timeout (the child sends no failure signal; V1 races an ASR
 * deadline -- a tighter audio deadline is a follow-up).
 */
export async function startPreVoiceoverChild(params: UipSessionWorkflowParams): Promise<void> {
  await startChild(PreVoiceoverWorkflow, {
    args: [
      {
        audioPath: params.audioPath as string,
        // V1 parity: forward the music gate snapshot and the
        // song-to-video is_music preset so the pre-voiceover stage-4 music
        // pre-analysis runs for V2 audio sessions too.
        isMusic: params.isMusic,
        musicVideoImprovementEnabled: params.musicVideoImprovementEnabled,
        // Note: `runContentDetection` / the vendor tag are
        // deliberately NOT passed -- V2's artifacts reducer has no
        // audio_is_music fold yet, so running the YAMNet/LLM tiers here would
        // burn detection cost and emit telemetry for a verdict with zero
        // product effect. V2 keeps only the tier-1 ID3 pin from
        // buildInitialSpec; full parity is tracked with the other V2 music
        // gaps.
        parentWorkflowId: workflowInfo().workflowId,
        projectId: params.projectId,
        source: 'user_audio',
        userEmail: params.userEmail,
        userId: params.userId,
      },
    ],
    parentClosePolicy: ParentClosePolicy.ABANDON,
    workflowId: `ao:${params.projectId}:pre-voiceover`,
    ...(params.storyModeTaskQueue ? { taskQueue: params.storyModeTaskQueue } : {}),
  })
}
