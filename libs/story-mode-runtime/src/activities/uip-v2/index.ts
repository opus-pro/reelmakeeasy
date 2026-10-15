// Do NOT import from workflow.ts
//
// UIP V2 -- activity (Node) barrel (Task 2.7). Re-exports the core session
// activities, the short orchestration activities and the 6 tool activities.
// Activity side only; keep it out of workflow files (it pulls in the
// activities' Node deps). The workflow-side proxy config lives in
// ../../workflows/uip-v2/activity-proxies.ts and imports this module with
// `import type` only.
//
// session-state.ts (foldSession) is an internal helper used by these
// activities, NOT an activity -- intentionally not re-exported here.

export { applyPatchActivity } from './apply-patch'
export { applyBrandPatchActivity } from './brand'
export { sessionControlActivity } from './session-control'
// Pasted-URL router (article vs brand door, ask-below-confidence).
export { classifyPastedUrlActivity } from './url-router'

// Short orchestration activities relocated from activities/uip in the v1 cleanup:
// the V2 workflow proxies and runs these (see uip-v2 activity-proxies).
// Registered raw (no withToolHeartbeat -- they are short, unlike the 6 tools).
export { checkDeadlineExpiredActivity } from './check-deadline-expired'
export { claimNextActionActivity } from './claim-next-action'
export { cleanupPlannerChainActivity } from './cleanup-planner-chain'
export type {
  AnchorVsBatchInput,
  AnchorVsBatchOutput,
  AnchorVsBatchToolOutcome,
} from './tools/anchor-vs-batch'
export { triggerNextActionActivity } from './trigger-next-action'

// The 6 tool activities are wrapped with `withToolHeartbeat` so they emit a
// periodic heartbeat for their whole run. They are proxied with
// `heartbeatTimeout: 5 minutes` (createToolActivitiesProxy) but never
// heartbeated, so any generation exceeding 5 min (notably anchor_vs_batch's
// ~5-6 min anchor-image generation) was treated as a dead worker and retried --
// duplicating expensive work and surfacing a spurious "timed out" UX. Wrapping
// at the barrel preserves each export's name (the registered activity
// name) and its (ToolActivityInput) => Promise<ToolActivityResult> type, so the
// workflow-side proxies are unaffected.
import { anchorAndVisualScriptBatchActivity as anchorAndVisualScriptBatchActivityRaw } from './tools/anchor-vs-batch'
import { describeUploadedImagesActivity as describeUploadedImagesActivityRaw } from './tools/describe-uploaded-images'
import { generateAnchorAssetsActivity as generateAnchorAssetsActivityRaw } from './tools/generate-anchor-assets'
import { generateIntentContextActivity as generateIntentContextActivityRaw } from './tools/generate-intent-context'
import { generateScriptActivity as generateScriptActivityRaw } from './tools/generate-script'
import { generateVisualScriptActivity as generateVisualScriptActivityRaw } from './tools/generate-visual-script'
import { planAssetAssignmentActivity as planAssetAssignmentActivityRaw } from './tools/plan-asset-assignment'
import { withToolHeartbeat } from './tools/runtime'
import { runSelectAutoStyleTool as runSelectAutoStyleToolRaw } from './tools/select-auto-style'
import { plannerStepActivity as plannerStepActivityRaw } from './planner-step'
import { projectAndPersistActivity as projectAndPersistActivityRaw } from './project-and-persist'

export const anchorAndVisualScriptBatchActivity = withToolHeartbeat(
  anchorAndVisualScriptBatchActivityRaw,
)

// Pumps the heartbeat that createPersistProxy's heartbeatTimeout relies on
// (see activity-proxies.ts for the full rationale + the timeout
// numbers this 5s cadence must stay well under). Same name-preserving
// barrel-wrap pattern as the tools above.
const PERSIST_HEARTBEAT_INTERVAL_MS = 5_000

export const projectAndPersistActivity = withToolHeartbeat(
  projectAndPersistActivityRaw,
  PERSIST_HEARTBEAT_INTERVAL_MS,
)

// plannerStepActivity heartbeats every 5s so createPlannerStepProxy's 30s
// heartbeatTimeout trips only on a genuinely dead worker (fast pod-churn
// detection) rather than capping a healthy call. It has no natural heartbeat and
// a single invocation can run tens of seconds (the callPlanner retry ladder plus
// up to the 60s PLANNER_CALL_TIMEOUT_MS per LLM call), so without a pump a 30s
// timeout would kill live calls. Cadence must stay well under 30s (see persist).
const PLANNER_HEARTBEAT_INTERVAL_MS = 5_000

export const plannerStepActivity = withToolHeartbeat(
  plannerStepActivityRaw,
  PLANNER_HEARTBEAT_INTERVAL_MS,
)

export const describeUploadedImagesActivity = withToolHeartbeat(describeUploadedImagesActivityRaw)
export const generateAnchorAssetsActivity = withToolHeartbeat(generateAnchorAssetsActivityRaw)
export const generateIntentContextActivity = withToolHeartbeat(generateIntentContextActivityRaw)
export const generateScriptActivity = withToolHeartbeat(generateScriptActivityRaw)
export const generateVisualScriptActivity = withToolHeartbeat(generateVisualScriptActivityRaw)
export const planAssetAssignmentActivity = withToolHeartbeat(planAssetAssignmentActivityRaw)
export const runSelectAutoStyleTool = withToolHeartbeat(runSelectAutoStyleToolRaw)
