// Optional model ids carried on the long-take workflow args; each is dropped
// when unset so the workflow falls back to its configured default.
export function buildImageModelWorkflowArgs(params: {
  keyframeImageModel?: string
  orgId?: string
  transitionVideoModel?: string
}) {
  const { keyframeImageModel, orgId, transitionVideoModel } = params
  return {
    ...(keyframeImageModel ? { keyframeImageModel } : {}),
    ...(orgId ? { orgId } : {}),
    ...(transitionVideoModel ? { transitionVideoModel } : {}),
  }
}
