// Do NOT import from workflow.ts
//
// UIP V2 -- describe_uploaded_images TOOL ACTIVITY (Task 2.6).
//
// Path: V1 `runDescribeUploadedImagesTool` wrapper. The wrapper runs the raw
// describe tool, merges with any persisted descriptions, persists, and writes
// the merged AssetDescriptionsArtifact onto `session._loaded_asset_descriptions`.
// We read that slot back off the (mutated) session and return it as `output`.
//
// Output shape: AssetDescriptionsArtifact ({ generated_at, items }). This is
// exactly what foldSession.applyToolOutput stages into
// `session._loaded_asset_descriptions` for describe_uploaded_images. No
// auto_apply mapper exists for this tool, so the activity only produces the
// descriptions artifact (no spec ops).

import type { AssetDescriptionsArtifact } from '@reelmakeeasy/uip-planner-runtime'
import { runDescribeUploadedImagesTool } from '@reelmakeeasy/uip-planner-runtime'

import { prepareToolRuntime, toToolOutcome } from './runtime'
import type { ToolActivityInput, ToolActivityResult } from './types'

export async function describeUploadedImagesActivity(
  input: ToolActivityInput,
): Promise<ToolActivityResult> {
  const { runtime, session } = await prepareToolRuntime(input)

  const result = await runDescribeUploadedImagesTool(runtime, session)

  // The wrapper writes the merged descriptions onto _loaded_asset_descriptions.
  // Default to an empty artifact when nothing was described (e.g. all assets
  // already described, or no uploads) so the output is always well-shaped.
  const output: AssetDescriptionsArtifact = session._loaded_asset_descriptions ?? {
    generated_at: new Date().toISOString(),
    items: [],
  }
  return { output, toolResult: toToolOutcome(result) }
}
